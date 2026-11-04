import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createDefaultRegistry } from "@/server/diagnosis/registry";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import {
  createAttemptHistoryHandler,
  createChallengeSessionHandlers,
  createLearnerHandlers,
} from "@/server/session/handlers";
import { MemoryStore } from "@/server/session/memory-store";
import { LearnerSessionService } from "@/server/session/service";
import { hashSessionToken, issueSessionToken, parseSessionToken } from "@/server/session/token";
import { CHALLENGE_ID, CORRECT_ID, RESOLUTION, WRONG_IDS, submission } from "../diagnosis/fixtures";

const START = Date.parse("2026-11-01T10:00:00Z");
const ORIGIN = "http://localhost:3000";
const VERSION = "1+test";

function setup() {
  let now = START;
  let version = VERSION;
  const store = new MemoryStore({ now: () => now });
  const service = new LearnerSessionService({
    learners: store,
    sessions: store,
    attempts: store,
    registry: createDefaultRegistry(),
    challengeVersion: () => version,
    now: () => now,
  });
  return {
    store,
    service,
    learner: createLearnerHandlers({ service }),
    session: createChallengeSessionHandlers({ service }),
    history: createAttemptHistoryHandler({ service }),
    advance(ms: number) {
      now += ms;
    },
    /** Simulates a deploy that changes the challenge's content version. */
    setVersion(next: string) {
      version = next;
    },
  };
}
type Lab = ReturnType<typeof setup>;

interface Options {
  cookie?: string;
  headers?: Record<string, string>;
  body?: string;
  url?: string;
}

function get(path: string, { cookie, headers = {}, url = ORIGIN }: Options = {}) {
  return new Request(`${url}${path}`, {
    method: "GET",
    headers: { host: new URL(url).host, ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}), ...headers },
  });
}

/** A same-origin JSON POST, as the app's own fetch would make it. Override any header to break a rule. */
function post(path: string, { cookie, headers = {}, body = "{}", url = ORIGIN }: Options = {}) {
  return new Request(`${url}${path}`, {
    method: "POST",
    headers: {
      host: new URL(url).host,
      "content-type": "application/json",
      origin: url,
      ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}),
      ...headers,
    },
    body,
  });
}

const context = (challengeId: string) => ({ params: Promise.resolve({ challengeId }) });

async function read(response: Response) {
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, json: JSON.parse(text) as Record<string, unknown> };
}

/** The cookie value a response asks the browser to store, or null. */
function cookieValueFrom(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  if (!header) return null;
  const [pair] = header.split(";");
  assert.ok(pair.startsWith(`${LEARNER_COOKIE}=`));
  return pair.slice(LEARNER_COOKIE.length + 1);
}

async function newLearner(lab: Lab): Promise<string> {
  const response = await lab.learner.POST(post("/api/learner"));
  const value = cookieValueFrom(response);
  assert.ok(value);
  return value;
}

const learnerCount = (lab: Lab) => (lab.store as unknown as { learners: Map<unknown, unknown> }).learners.size;
const sessionCount = (lab: Lab) => (lab.store as unknown as { sessions: Map<unknown, unknown> }).sessions.size;

describe("learner handlers: creating and resuming the identity", () => {
  test("POST creates an anonymous learner, sets a hardened cookie, and says nothing about ids", async () => {
    const lab = setup();

    const response = await lab.learner.POST(post("/api/learner"));
    const { status, json, text } = await read(response.clone());

    assert.equal(status, 201);
    assert.deepEqual(json, { learner: { state: "active", created: true } });
    const header = response.headers.get("set-cookie") ?? "";
    assert.match(header, new RegExp(`^${LEARNER_COOKIE}=[A-Za-z0-9_-]{43};`));
    assert.match(header, /; Path=\/api;/);
    assert.match(header, new RegExp(`; Max-Age=${Math.floor(DEFAULT_EXPIRY_POLICY.idleTtlMs / 1000)};`));
    assert.match(header, /; HttpOnly/);
    assert.match(header, /; SameSite=Strict/);
    assert.doesNotMatch(header, /Secure/, "plain HTTP development keeps working");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const token = cookieValueFrom(response)!;
    assert.ok(!text.includes(token) && !text.includes(hashSessionToken(parseSessionToken(token)!)), "the body never carries the token or its hash");
  });

  test("the cookie is Secure when the request came over HTTPS", async () => {
    const lab = setup();

    const response = await lab.learner.POST(post("/api/learner", { url: "https://buglab.example" }));

    assert.match(response.headers.get("set-cookie") ?? "", /; Secure/);
  });

  test("POST with the cookie resumes the same learner and keeps the same token", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    lab.advance(2 * 24 * 60 * 60_000);

    const response = await lab.learner.POST(post("/api/learner", { cookie }));
    const { status, json } = await read(response.clone());

    assert.equal(status, 200);
    assert.deepEqual(json, { learner: { state: "active", created: false } });
    assert.equal(cookieValueFrom(response), cookie);
    assert.equal(learnerCount(lab), 1);
  });

  test("an unknown or expired cookie gets a new learner, never the old one", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    lab.advance(DEFAULT_EXPIRY_POLICY.idleTtlMs);

    const expired = await lab.learner.POST(post("/api/learner", { cookie }));
    const stranger = await lab.learner.POST(post("/api/learner", { cookie: issueSessionToken().token }));

    for (const response of [expired, stranger]) {
      assert.equal(response.status, 201);
      assert.notEqual(cookieValueFrom(response), cookie);
    }
    assert.equal(learnerCount(lab), 3);
  });

  test("GET reports none, active or expired, and never creates a learner", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    const none = await read(await lab.learner.GET(get("/api/learner")));
    const unknown = await read(await lab.learner.GET(get("/api/learner", { cookie: issueSessionToken().token })));
    const active = await lab.learner.GET(get("/api/learner", { cookie }));
    lab.advance(DEFAULT_EXPIRY_POLICY.idleTtlMs);
    const expired = await read(await lab.learner.GET(get("/api/learner", { cookie })));

    assert.deepEqual(none.json, { learner: { state: "none" } });
    assert.deepEqual(unknown.json, { learner: { state: "none" } });
    assert.deepEqual((await read(active.clone())).json, { learner: { state: "active" } });
    assert.equal(none.headers.get("set-cookie"), null);
    assert.equal(active.headers.get("set-cookie"), null, "no cookie unless the read refreshed the expiry");
    assert.deepEqual(expired.json, { learner: { state: "expired" } });
    assert.equal(expired.headers.get("set-cookie"), null);
    assert.equal(learnerCount(lab), 1);
  });

  test("a GET that refreshes the idle expiry sets the cookie again", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    lab.advance(DEFAULT_EXPIRY_POLICY.touchIntervalMs);

    const response = await lab.learner.GET(get("/api/learner", { cookie }));

    assert.equal(cookieValueFrom(response), cookie);
  });
});

describe("state-changing requests are guarded, and a refusal creates nothing", () => {
  const refusals: Array<[string, Options, number]> = [
    ["a body that is not JSON content", { headers: { "content-type": "text/plain" } }, 415],
    ["a missing content type", { headers: { "content-type": "" } }, 415],
    ["a foreign Origin", { headers: { origin: "https://evil.example" } }, 403],
    ["a malformed Origin", { headers: { origin: "not a url" } }, 403],
    ["no Origin and no same-origin proof", { headers: { origin: "" } }, 403],
    ["a cross-site fetch with no Origin", { headers: { origin: "", "sec-fetch-site": "cross-site" } }, 403],
    ["a prefetch", { headers: { "sec-purpose": "prefetch" } }, 403],
    ["an old-style prefetch header", { headers: { purpose: "prefetch" } }, 403],
    ["a body that is not valid JSON", { body: "{nope" }, 400],
    ["a JSON array body", { body: "[1]" }, 400],
    ["a JSON string body", { body: '"x"' }, 400],
    ["an oversized body", { body: JSON.stringify({ padding: "x".repeat(5_000) }) }, 400],
  ];

  for (const [label, options, expected] of refusals) {
    test(`POST learner refuses ${label}`, async () => {
      const lab = setup();

      const response = await lab.learner.POST(post("/api/learner", options));
      const { json } = await read(response.clone());

      assert.equal(response.status, expected);
      assert.equal(json.status, "error");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(learnerCount(lab), 0, "nothing was created");
    });
  }

  test("a request with no Origin is allowed when the browser says it is same-origin", async () => {
    const lab = setup();

    const response = await lab.learner.POST(post("/api/learner", { headers: { origin: "", "sec-fetch-site": "same-origin" } }));

    assert.equal(response.status, 201);
  });

  test("starting a challenge applies the same guards", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    for (const [, options, expected] of refusals) {
      const response = await lab.session.POST(post(`/api/challenges/${CHALLENGE_ID}/session`, { ...options, cookie }), context(CHALLENGE_ID));
      assert.equal(response.status, expected);
    }
    assert.equal(sessionCount(lab), 0);
  });
});

describe("same-origin validation compares whole origins (scheme, host and port)", () => {
  /** Posts to the learner endpoint and reports the status and whether anything was created. */
  async function attempt(options: Options) {
    const lab = setup();
    const response = await lab.learner.POST(post("/api/learner", options));
    return { status: response.status, created: learnerCount(lab), cookie: response.headers.get("set-cookie") };
  }

  test("a normal same-origin request is accepted", async () => {
    for (const url of ["http://localhost:3000", "https://buglab.example", "https://buglab.example:8443"]) {
      const result = await attempt({ url });
      assert.equal(result.status, 201, url);
      assert.equal(result.created, 1);
    }
  });

  test("the same hostname with a different scheme is refused, in both directions", async () => {
    const cases: Array<[string, string]> = [
      ["https://buglab.example", "http://buglab.example"], // a downgrade
      ["http://localhost:3000", "https://localhost:3000"],
      ["http://buglab.example", "https://buglab.example"],
    ];
    for (const [url, origin] of cases) {
      const result = await attempt({ url, headers: { origin } });
      assert.equal(result.status, 403, `${origin} against ${url}`);
      assert.equal(result.created, 0);
      assert.equal(result.cookie, null);
    }
  });

  test("a different hostname is refused, including subdomains and look-alikes", async () => {
    for (const origin of [
      "http://evil.example:3000",
      "http://sub.localhost:3000",
      "http://localhost.evil.example:3000",
      "http://127.0.0.1:3000",
    ]) {
      const result = await attempt({ headers: { origin } });
      assert.equal(result.status, 403, origin);
      assert.equal(result.created, 0);
    }
  });

  test("a different port is refused", async () => {
    for (const origin of ["http://localhost:3001", "http://localhost", "http://localhost:30000"]) {
      const result = await attempt({ headers: { origin } });
      assert.equal(result.status, 403, origin);
      assert.equal(result.created, 0);
    }
  });

  test("a malformed or opaque Origin is refused", async () => {
    for (const origin of [
      "not a url",
      "null",
      "http://",
      "//localhost:3000",
      "localhost:3000",
      "http://localhost:3000, http://evil.example",
      "http://localhost:3000@evil.example",
    ]) {
      const result = await attempt({ headers: { origin } });
      assert.equal(result.status, 403, origin);
      assert.equal(result.created, 0);
    }
  });

  test("the Host header cannot vouch for the Origin: the request's own origin decides", async () => {
    // A client that sets both Host and Origin to the same foreign value must not pass.
    const result = await attempt({ headers: { host: "evil.example", origin: "http://evil.example" } });

    assert.equal(result.status, 403);
    assert.equal(result.created, 0);
  });

  test("with no Origin, only Sec-Fetch-Site: same-origin is accepted", async () => {
    const accepted = await attempt({ headers: { origin: "", "sec-fetch-site": "same-origin" } });
    assert.equal(accepted.status, 201);

    for (const proof of [undefined, "same-site", "cross-site", "none", "", "Same-Origin-ish"]) {
      const headers: Record<string, string> = { origin: "" };
      if (proof !== undefined) headers["sec-fetch-site"] = proof;
      const refused = await attempt({ headers });
      assert.equal(refused.status, 403, String(proof));
      assert.equal(refused.created, 0);
    }
  });

  test("a matching Origin is still not enough without the JSON content type, and prefetches stay refused", async () => {
    assert.equal((await attempt({ headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal((await attempt({ headers: { "sec-purpose": "prefetch" } })).status, 403);
  });

  test("the challenge session endpoint applies the same rule", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    const path = `/api/challenges/${CHALLENGE_ID}/session`;

    const downgrade = await lab.session.POST(
      post(path, { cookie, url: "https://buglab.example", headers: { origin: "http://buglab.example" } }),
      context(CHALLENGE_ID),
    );
    const normal = await lab.session.POST(post(path, { cookie }), context(CHALLENGE_ID));

    assert.equal(downgrade.status, 403);
    assert.equal(normal.status, 201);
    assert.equal(sessionCount(lab), 1, "only the legitimate request started a session");
  });

  test("a body with no declared length is read only up to the cap, then refused", async () => {
    const lab = setup();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(512));
        if (pulled >= 1000) controller.close();
      },
    });
    const request = new Request(`${ORIGIN}/api/learner`, {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", origin: ORIGIN },
      body: stream,
      duplex: "half",
    } as RequestInit);

    const response = await lab.learner.POST(request);

    assert.equal(response.status, 400);
    assert.ok(pulled < 20, `the whole stream was buffered (${pulled} chunks read)`);
    assert.equal(learnerCount(lab), 0);
  });
});

describe("every response is safe to hand to a browser or a shared cache", () => {
  test("success and failure alike are no-store, vary on the cookie, and grant no cross-origin access", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    const path = `/api/challenges/${CHALLENGE_ID}`;
    const ctx = context(CHALLENGE_ID);
    const brokenStore = new Proxy(lab.store, {
      get(target, property) {
        if (property === "touch") return () => Promise.reject(new Error("storage is down"));
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const broken = createLearnerHandlers({
      service: new LearnerSessionService({ learners: brokenStore, sessions: lab.store, attempts: lab.store, registry: createDefaultRegistry(), challengeVersion: () => VERSION }),
    });

    const responses: Response[] = [
      await lab.learner.POST(post("/api/learner")), // 201
      await lab.learner.POST(post("/api/learner", { cookie })), // 200
      await lab.learner.POST(post("/api/learner", { headers: { origin: "https://evil.example" } })), // 403
      await lab.learner.POST(post("/api/learner", { headers: { "content-type": "text/plain" } })), // 415
      await lab.learner.POST(post("/api/learner", { body: "{" })), // 400
      await lab.learner.GET(get("/api/learner")), // 200, none
      await lab.learner.GET(get("/api/learner", { cookie })), // 200, active
      await lab.session.GET(get(`${path}/session`), ctx), // 401
      await lab.session.GET(get(`${path}/session`, { cookie }), ctx), // 200, none
      await lab.session.POST(post(`${path}/session`, { cookie }), ctx), // 201
      await lab.session.POST(post(`${path}/session`, { cookie }), ctx), // 200
      await lab.session.GET(get("/api/challenges/nope/session", { cookie }), context("nope")), // 404
      await lab.history.GET(get(`${path}/attempts`, { cookie }), ctx), // 200
      await broken.GET(get("/api/learner", { cookie })), // 500
    ];

    const statuses = new Set(responses.map((response) => response.status));
    for (const expected of [200, 201, 400, 401, 403, 404, 415, 500]) assert.ok(statuses.has(expected), `no ${expected} response was checked`);
    for (const response of responses) {
      const label = `${response.status} ${response.url || ""}`;
      assert.equal(response.headers.get("cache-control"), "no-store", label);
      assert.equal(response.headers.get("vary"), "Cookie", label);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff", label);
      assert.ok(![...response.headers.keys()].some((name) => name.startsWith("access-control-")), label);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/, label);
    }
  });

  test("a cookie is only ever set by a response that has just verified or created the learner", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    const path = `/api/challenges/${CHALLENGE_ID}`;
    const refused: Response[] = [
      await lab.learner.POST(post("/api/learner", { headers: { origin: "https://evil.example" } })),
      await lab.learner.POST(post("/api/learner", { body: "[]" })),
      await lab.session.GET(get(`${path}/session`, { cookie: issueSessionToken().token }), context(CHALLENGE_ID)),
      await lab.session.POST(post(`${path}/session`, { cookie: "garbage" }), context(CHALLENGE_ID)),
      await lab.history.GET(get(`${path}/attempts`), context(CHALLENGE_ID)),
      await lab.session.GET(get("/api/challenges/nope/session", { cookie }), context("nope")),
    ];

    for (const response of refused) assert.equal(response.headers.get("set-cookie"), null, String(response.status));
  });
});

describe("challenge session handlers", () => {
  test("POST starts the learner's session, and POST again resumes it", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    const first = await lab.session.POST(post(`/api/challenges/${CHALLENGE_ID}/session`, { cookie }), context(CHALLENGE_ID));
    const second = await lab.session.POST(post(`/api/challenges/${CHALLENGE_ID}/session`, { cookie }), context(CHALLENGE_ID));
    const one = await read(first.clone());
    const two = await read(second.clone());

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    const started = one.json.session as Record<string, unknown>;
    const resumed = two.json.session as Record<string, unknown>;
    assert.equal(started.state, "active");
    assert.equal(started.created, true);
    assert.equal(resumed.created, false);
    assert.equal(started.challengeId, CHALLENGE_ID);
    assert.equal(resumed.startedAt, started.startedAt, "the same session, not a new one");
    assert.equal(cookieValueFrom(first), cookie);
    assert.equal(sessionCount(lab), 1);
  });

  test("GET returns none before the challenge is started, and never starts it", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    const response = await read(await lab.session.GET(get(`/api/challenges/${CHALLENGE_ID}/session`, { cookie }), context(CHALLENGE_ID)));

    assert.equal(response.status, 200);
    assert.deepEqual(response.json, { session: { state: "none" } });
    assert.equal(sessionCount(lab), 0);
  });

  test("GET restores the session with its progress after the learner has attempted it", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    await lab.session.POST(post(`/api/challenges/${CHALLENGE_ID}/session`, { cookie }), context(CHALLENGE_ID));
    await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: WRONG_IDS[0] }));

    const { status, json } = await read(await lab.session.GET(get(`/api/challenges/${CHALLENGE_ID}/session`, { cookie }), context(CHALLENGE_ID)));

    assert.equal(status, 200);
    const session = json.session as { state: string; status: string; attempts: { total: number; wrong: number } };
    assert.equal(session.state, "active");
    assert.equal(session.status, "active");
    assert.equal(session.attempts.total, 1);
    assert.equal(session.attempts.wrong, 1);
  });

  test("without a valid learner every endpoint answers 401, and nothing is created", async () => {
    const lab = setup();
    const expired = await newLearner(lab);
    lab.advance(DEFAULT_EXPIRY_POLICY.idleTtlMs);
    const path = `/api/challenges/${CHALLENGE_ID}/session`;
    const cases: Array<[string | undefined, string]> = [
      [undefined, "learner-missing"],
      ["garbage", "learner-missing"],
      [issueSessionToken().token, "learner-missing"],
      [expired, "learner-expired"],
    ];

    for (const [cookie, code] of cases) {
      const options = cookie === undefined ? {} : { cookie };
      for (const response of [
        await lab.session.GET(get(path, options), context(CHALLENGE_ID)),
        await lab.session.POST(post(path, options), context(CHALLENGE_ID)),
        await lab.history.GET(get(`${path.replace("/session", "/attempts")}`, options), context(CHALLENGE_ID)),
      ]) {
        const { status, json } = await read(response.clone());
        assert.equal(status, 401);
        assert.equal(json.code, code);
        assert.equal(response.headers.get("set-cookie"), null);
      }
    }
    assert.equal(sessionCount(lab), 0);
    assert.equal(learnerCount(lab), 1, "no learner was created either");
  });

  test("an unknown challenge is 404", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    for (const response of [
      await lab.session.GET(get("/api/challenges/nope/session", { cookie }), context("nope")),
      await lab.session.POST(post("/api/challenges/nope/session", { cookie }), context("nope")),
    ]) {
      const { status, json } = await read(response);
      assert.equal(status, 404);
      assert.equal(json.code, "unknown-challenge");
    }
  });

  test("a learner cannot see another learner's session", async () => {
    const lab = setup();
    const alice = await newLearner(lab);
    const bob = await newLearner(lab);
    await lab.session.POST(post(`/api/challenges/${CHALLENGE_ID}/session`, { cookie: alice }), context(CHALLENGE_ID));
    await lab.service.submitDiagnosis(alice, CHALLENGE_ID, submission({ rootCauseId: CORRECT_ID }));

    const view = await read(await lab.session.GET(get(`/api/challenges/${CHALLENGE_ID}/session`, { cookie: bob }), context(CHALLENGE_ID)));
    const history = await read(await lab.history.GET(get(`/api/challenges/${CHALLENGE_ID}/attempts`, { cookie: bob }), context(CHALLENGE_ID)));

    assert.deepEqual(view.json, { session: { state: "none" } });
    assert.equal(history.status, 404);
    assert.equal(history.json.code, "session-missing");
  });
});

describe("attempt history handler", () => {
  test("lists the learner's attempts in order, with allow-listed fields only", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    await lab.session.POST(post(`/api/challenges/${CHALLENGE_ID}/session`, { cookie }), context(CHALLENGE_ID));
    await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: WRONG_IDS[0] }));
    lab.advance(60_000);
    await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: CORRECT_ID }));

    const { status, json } = await read(await lab.history.GET(get(`/api/challenges/${CHALLENGE_ID}/attempts`, { cookie }), context(CHALLENGE_ID)));

    assert.equal(status, 200);
    const attempts = json.attempts as Array<Record<string, unknown>>;
    assert.deepEqual(attempts.map((attempt) => [attempt.seq, attempt.result]), [[1, "incorrect"], [2, "correct"]]);
    for (const attempt of attempts) {
      assert.deepEqual(Object.keys(attempt).sort(), ["evidenceCount", "result", "rootCauseId", "seq", "submittedAt"]);
    }
  });

  test("answers 404 session-missing for a challenge the learner has not started", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    const { status, json } = await read(await lab.history.GET(get(`/api/challenges/${CHALLENGE_ID}/attempts`, { cookie }), context(CHALLENGE_ID)));

    assert.equal(status, 404);
    assert.equal(json.code, "session-missing");
  });
});

describe("what the handlers never reveal", () => {
  test("no response contains the token, a hash, an internal id or answer-key data", async () => {
    const lab = setup();
    const created = await lab.learner.POST(post("/api/learner"));
    const cookie = cookieValueFrom(created)!;
    const texts: string[] = [(await read(created.clone())).text];
    const path = `/api/challenges/${CHALLENGE_ID}/session`;
    texts.push((await read(await lab.session.POST(post(path, { cookie }), context(CHALLENGE_ID)))).text);
    for (const rootCauseId of WRONG_IDS.slice(0, 2)) {
      await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId }));
    }
    texts.push((await read(await lab.session.GET(get(path, { cookie }), context(CHALLENGE_ID)))).text);
    texts.push((await read(await lab.history.GET(get(`/api/challenges/${CHALLENGE_ID}/attempts`, { cookie }), context(CHALLENGE_ID)))).text);
    texts.push((await read(await lab.learner.GET(get("/api/learner", { cookie })))).text);

    const found = await lab.store.findByTokenHash(hashSessionToken(parseSessionToken(cookie)!));
    assert.ok(found.state === "active");
    const session = await lab.store.find({ learnerId: found.learner.id, challengeId: CHALLENGE_ID });
    const attempts = await lab.store.list({ learnerId: found.learner.id, sessionId: session!.id });
    const secrets = [
      cookie,
      hashSessionToken(parseSessionToken(cookie)!),
      found.learner.id,
      session!.id,
      ...attempts.map((attempt) => attempt.id),
      CORRECT_ID,
      RESOLUTION,
      "correctRootCauseId",
      "keyObservations",
      "requestHash",
    ];
    const everything = texts.join("\n");
    for (const secret of secrets) assert.ok(!everything.includes(secret), `leaked: ${secret.slice(0, 40)}`);
  });

  test("an unexpected failure in the service is a plain 500 with no detail", async () => {
    const lab = setup();
    const broken = new LearnerSessionService({
      learners: {
        ...lab.store,
        touch: () => Promise.reject(new Error("secret internal detail")),
      } as never,
      sessions: lab.store,
      attempts: lab.store,
      registry: createDefaultRegistry(),
      challengeVersion: () => VERSION,
    });
    const handlers = createLearnerHandlers({ service: broken });

    const response = await handlers.GET(get("/api/learner", { cookie: issueSessionToken().token }));
    const { status, json, text } = await read(response);

    assert.equal(status, 500);
    assert.equal(json.code, "internal");
    assert.ok(!text.includes("secret internal detail"));
  });

  test("a storage failure behind the session and history handlers is a plain 500 with no detail, and no cookie", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    await lab.session.POST(post(`/api/challenges/${CHALLENGE_ID}/session`, { cookie }), context(CHALLENGE_ID));
    const broken = new Proxy(lab.store, {
      get(target, property) {
        if (property === "find" || property === "list" || property === "start") {
          return () => Promise.reject(new Error("secret internal detail"));
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const service = new LearnerSessionService({ learners: broken, sessions: broken, attempts: broken, registry: createDefaultRegistry(), challengeVersion: () => VERSION });
    const sessionHandlers = createChallengeSessionHandlers({ service });
    const historyHandler = createAttemptHistoryHandler({ service });
    const path = `/api/challenges/${CHALLENGE_ID}`;

    const responses = [
      await sessionHandlers.GET(get(`${path}/session`, { cookie }), context(CHALLENGE_ID)),
      await sessionHandlers.POST(post(`${path}/session`, { cookie }), context(CHALLENGE_ID)),
      await historyHandler.GET(get(`${path}/attempts`, { cookie }), context(CHALLENGE_ID)),
    ];

    for (const response of responses) {
      const { status, json, text } = await read(response.clone());
      assert.equal(status, 500);
      assert.equal(json.code, "internal");
      assert.ok(!text.includes("secret internal detail"));
      assert.equal(response.headers.get("set-cookie"), null);
    }
  });
});

describe("session handlers: restoring a completed challenge and restarting a stale one", () => {
  const path = `/api/challenges/${CHALLENGE_ID}/session`;
  const readSession = async (lab: Lab, cookie: string) => read(await lab.session.GET(get(path, { cookie }), context(CHALLENGE_ID)));

  test("GET after completion carries the server-attested completion and what is needed to restore the workspace", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    await lab.session.POST(post(path, { cookie }), context(CHALLENGE_ID));
    lab.advance(60_000);
    const body = submission({ rootCauseId: CORRECT_ID, evidence: [{ kind: "network", requestId: "req-04" }, { kind: "log", logId: "log-06" }] });
    const solved = await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, body);
    assert.ok(solved.status === "ok" && solved.response.status === "correct");

    const { status, json, headers } = await readSession(lab, cookie);

    assert.equal(status, 200);
    assert.equal(headers.get("cache-control"), "no-store");
    const session = json.session as Record<string, unknown>;
    assert.equal(session.state, "active", "a session exists");
    assert.equal(session.status, "completed");
    assert.equal(session.completedAt, new Date(START + 60_000).toISOString());
    assert.equal(session.restartRequired, false);
    const completion = session.completion as { resolution: { summary: string }; submission: { rootCauseId: string; evidence: unknown[]; attempt: number } };
    assert.equal(completion.resolution.summary, RESOLUTION);
    assert.equal(completion.submission.rootCauseId, CORRECT_ID);
    assert.equal(completion.submission.attempt, 1);
    assert.deepEqual(completion.submission.evidence, body.evidence);
  });

  test("the same wire response comes back after a refresh, and no internal id, hash or answer-key structure is in it", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    await lab.session.POST(post(path, { cookie }), context(CHALLENGE_ID));
    await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: CORRECT_ID }));
    const first = await readSession(lab, cookie);
    lab.advance(30_000);

    const second = await readSession(lab, cookie);

    assert.deepEqual(second.json, first.json);
    const found = await lab.store.findByTokenHash(hashSessionToken(parseSessionToken(cookie)!));
    assert.ok(found.state === "active");
    const session = await lab.store.find({ learnerId: found.learner.id, challengeId: CHALLENGE_ID });
    for (const secret of [found.learner.id, session!.id, cookie, hashSessionToken(parseSessionToken(cookie)!), "keyObservations", "correctRootCauseId", "requestHash", "tokenHash"]) {
      assert.ok(!second.text.includes(secret), `leaked: ${secret.slice(0, 40)}`);
    }
  });

  test("an unfinished session's wire response has no completion at all", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    await lab.session.POST(post(path, { cookie }), context(CHALLENGE_ID));
    await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: WRONG_IDS[0] }));

    const { json, text } = await readSession(lab, cookie);

    const session = json.session as Record<string, unknown>;
    assert.ok(!("completion" in session) && !("completedAt" in session));
    assert.ok(!text.includes(RESOLUTION));
  });

  test("when the challenge changes, GET says restartRequired and POST replaces the session, once", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    const first = await read(await lab.session.POST(post(path, { cookie }), context(CHALLENGE_ID)));
    assert.equal(first.status, 201);
    assert.equal((first.json.session as Record<string, unknown>).restarted, false);
    await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: WRONG_IDS[0] }));

    lab.setVersion("2+changed");
    const stale = await readSession(lab, cookie);
    assert.equal((stale.json.session as Record<string, unknown>).restartRequired, true);
    assert.equal((stale.json.session as Record<string, unknown>).contentVersion, VERSION, "it still says which version it was started at");

    const restarted = await read(await lab.session.POST(post(path, { cookie }), context(CHALLENGE_ID)));
    assert.equal(restarted.status, 201, "a new session was created");
    const body = restarted.json.session as Record<string, unknown> & { attempts: { total: number } };
    assert.equal(body.created, true);
    assert.equal(body.restarted, true);
    assert.equal(body.restartRequired, false);
    assert.equal(body.contentVersion, "2+changed");
    assert.equal(body.attempts.total, 0);

    const again = await read(await lab.session.POST(post(path, { cookie }), context(CHALLENGE_ID)));
    assert.equal(again.status, 200);
    assert.equal((again.json.session as Record<string, unknown>).restarted, false);
    assert.equal(sessionCount(lab), 2, "the old session is kept as history");
  });

  test("a completed session is not restarted by POST when the challenge changes: it is returned as it is", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    await lab.session.POST(post(path, { cookie }), context(CHALLENGE_ID));
    await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: CORRECT_ID }));
    const before = await readSession(lab, cookie);

    lab.setVersion("2+changed");
    const response = await read(await lab.session.POST(post(path, { cookie }), context(CHALLENGE_ID)));

    assert.equal(response.status, 200);
    const session = response.json.session as Record<string, unknown>;
    assert.equal(session.restarted, false);
    assert.equal(session.created, false);
    assert.equal(session.status, "completed");
    assert.equal(session.contentVersion, VERSION);
    assert.deepEqual(session.completion, (before.json.session as Record<string, unknown>).completion);
    assert.equal(sessionCount(lab), 1);
  });

  test("an outdated-session rejection is a 409 with a plain message and no detail", async () => {
    const service = {
      getChallengeSession: async () => ({ status: "rejected", code: "session-outdated" }),
    } as unknown as LearnerSessionService;
    const handlers = createChallengeSessionHandlers({ service });

    const { status, json, text } = await read(await handlers.GET(get(path), context(CHALLENGE_ID)));

    assert.equal(status, 409);
    assert.deepEqual(json, { status: "error", code: "session-outdated", message: "This challenge has changed since you started it. Start it again to continue." });
    assert.doesNotMatch(text, /version|revision|hash|fingerprint/i, "no hint of what changed");
  });
});

describe("a configured application origin (BUGLAB_APP_ORIGIN) on the learner and challenge-session writes", () => {
  const APP = "https://buglab.example";
  /** Behind a TLS-terminating proxy: the app sees the upstream URL and Host, the browser sent the real Origin. */
  const upstream = "http://127.0.0.1:3000";
  const configured = (lab: Lab) => ({
    learner: createLearnerHandlers({ service: lab.service, appOrigin: APP }),
    session: createChallengeSessionHandlers({ service: lab.service, appOrigin: APP }),
  });
  const sessionPath = `/api/challenges/${CHALLENGE_ID}/session`;

  test("the real origin is accepted behind a proxy, and the learner cookie is Secure by configuration", async () => {
    const lab = setup();
    const { learner, session } = configured(lab);

    const started = await learner.POST(post("/api/learner", { url: upstream, headers: { origin: APP, "sec-fetch-site": "same-origin" } }));
    assert.equal(started.status, 201);
    const setCookie = started.headers.getSetCookie()[0];
    assert.match(setCookie, /; HttpOnly; SameSite=Strict; Secure$/, "Secure although the request URL is http and no X-Forwarded-Proto was sent");
    assert.match(setCookie, /Path=\/api;/);

    const cookie = parseSessionToken(setCookie.split(";")[0].split("=")[1]) as string;
    const begun = await session.POST(post(sessionPath, { url: upstream, cookie, headers: { origin: APP } }), context(CHALLENGE_ID));
    assert.equal(begun.status, 201);
  });

  test("the same request is refused when nothing is configured: the request's own URL is not the browser's origin", async () => {
    const lab = setup();
    const response = await lab.learner.POST(post("/api/learner", { url: upstream, headers: { origin: APP } }));

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
  });

  test("a client cannot add or strip Secure with X-Forwarded-Proto", async () => {
    const lab = setup();
    const https = configured(lab).learner;
    const http = createLearnerHandlers({ service: lab.service, appOrigin: "http://localhost:3000" });

    for (const forwarded of [undefined, "http"]) {
      const headers: Record<string, string> = { origin: APP };
      if (forwarded) headers["x-forwarded-proto"] = forwarded;
      const response = await https.POST(post("/api/learner", { url: upstream, headers }));
      assert.match(response.headers.getSetCookie()[0], /; Secure$/, String(forwarded));
    }
    const plain = await http.POST(post("/api/learner", { url: "https://localhost:3000", headers: { origin: "http://localhost:3000", "x-forwarded-proto": "https" } }));
    assert.equal(plain.status, 201);
    assert.doesNotMatch(plain.headers.getSetCookie()[0], /Secure/);
  });

  test("every refusal is 403 and creates nothing: other origins, credentials (empty too), an invalid Origin even with proof, a contradicting Sec-Fetch-Site", async () => {
    const lab = setup();
    const { learner } = configured(lab);
    const refusals: Array<Record<string, string>> = [
      { origin: "https://evil.example" },
      { origin: "http://127.0.0.1:3000" },
      { origin: "http://buglab.example" },
      { origin: "https://evil.example@buglab.example" },
      { origin: "https://@buglab.example" },
      { origin: "https://:@buglab.example", "sec-fetch-site": "same-origin" },
      { origin: "null", "sec-fetch-site": "same-origin" },
      { origin: "garbage", "sec-fetch-site": "same-origin" },
      { origin: APP, "sec-fetch-site": "cross-site" },
      { origin: "", "sec-fetch-site": "cross-site" },
      { origin: "" }, // no Origin and no proof
    ];
    for (const headers of refusals) {
      const response = await learner.POST(post("/api/learner", { url: upstream, headers }));
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.equal(response.headers.get("set-cookie"), null);
    }
    assert.equal(learnerCount(lab), 0, "nothing was created");
  });

  test("a headerless learner write is refused with a configured origin too; only Sec-Fetch-Site: same-origin stands in for Origin", async () => {
    const lab = setup();
    const { learner } = configured(lab);

    assert.equal((await learner.POST(post("/api/learner", { url: upstream, headers: { origin: "" } }))).status, 403);
    assert.equal((await learner.POST(post("/api/learner", { url: upstream, headers: { origin: "", "sec-fetch-site": "same-origin" } }))).status, 201);
  });
});
