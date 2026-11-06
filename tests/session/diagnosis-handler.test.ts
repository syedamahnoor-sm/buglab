/*
 * The diagnosis submission handler, driven the way a browser would: real Requests in, real Responses
 * out, over the real session service and the in-memory store. Only the clock is controlled.
 *
 * The live diagnosis handler is used in one place, read-only: the parity tests compare what it says
 * with what this handler says for the same submissions, so "the existing response shapes are
 * preserved" is checked against the thing that defines them and not against a copy.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deterministicDiagnosisEvaluator, type DiagnosisEvaluator } from "@/server/diagnosis/evaluator";
import { createDiagnosisHandler } from "@/server/diagnosis/handler";
import { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { createDefaultRegistry } from "@/server/diagnosis/registry";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import {
  DIAGNOSIS_BODY_LIMIT_BYTES,
  createDiagnosisSubmissionHandler,
  type DiagnosisSubmissionHandlerDeps,
} from "@/server/session/diagnosis-handler";
import { DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import { MemoryStore } from "@/server/session/memory-store";
import { hashSubmission } from "@/server/session/request-hash";
import { LearnerSessionService } from "@/server/session/service";
import { hashSessionToken, issueSessionToken, parseSessionToken } from "@/server/session/token";
import { CHALLENGE_ID, CORRECT_ID, CORRECT_LABEL, EXPLANATION, RESOLUTION, WRONG_IDS, submission } from "../diagnosis/fixtures";

const START = Date.parse("2026-11-01T10:00:00Z");
const ORIGIN = "http://localhost:3000";
const VERSION = "1+test";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const GENERIC_500 = { status: "error", code: "internal", message: "The diagnosis could not be evaluated. Please try again." };

/** A well-formed Idempotency-Key, distinct per `n`. */
const key = (n: number) => `0a0b0c0d-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Service = DiagnosisSubmissionHandlerDeps["service"];

function setup({ trustedProxyHops = 0, evaluator }: { trustedProxyHops?: number; evaluator?: DiagnosisEvaluator } = {}) {
  let now = START;
  let version = VERSION;
  let ids = 0;
  // Internal ids are recognisable, so a leak of one into a response is easy to see.
  const store = new MemoryStore({ now: () => now, newId: () => `internal-${(ids += 1)}` });
  const registry = createDefaultRegistry();
  const service = new LearnerSessionService({
    learners: store,
    sessions: store,
    attempts: store,
    registry,
    challengeVersion: () => version,
    now: () => now,
    evaluator,
  });
  const ipSubmissions = new FixedWindowLimiter({ limit: 10, windowMs: 10 * MINUTE, now: () => now });
  const handler = createDiagnosisSubmissionHandler({ service, registry, ipSubmissions, trustedProxyHops });
  return {
    store,
    service,
    registry,
    ipSubmissions,
    handler,
    trustedProxyHops,
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

interface Send {
  /** The learner cookie's value. */
  cookie?: string;
  /** Any other Cookie header content, sent as it is. */
  rawCookie?: string;
  key?: string;
  /** Several Idempotency-Key header lines, which a server sees joined by commas. */
  keyLines?: string[];
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string | ReadableStream<Uint8Array>;
  url?: string;
  challengeId?: string;
}

function request(options: Send = {}): Request {
  const url = options.url ?? ORIGIN;
  const challengeId = options.challengeId ?? CHALLENGE_ID;
  const headers = new Headers({ host: new URL(url).host, "content-type": "application/json", origin: url });
  const cookies = [options.cookie ? `${LEARNER_COOKIE}=${options.cookie}` : "", options.rawCookie ?? ""].filter(Boolean);
  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
  if (options.key !== undefined) headers.set("idempotency-key", options.key);
  for (const line of options.keyLines ?? []) headers.append("idempotency-key", line);
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
  const body = options.rawBody ?? JSON.stringify(options.body ?? submission());
  return new Request(`${url}/api/challenges/${challengeId}/diagnosis`, {
    method: "POST",
    headers,
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

const context = (challengeId: string) => ({ params: Promise.resolve({ challengeId }) });

async function read(response: Response) {
  const text = await response.text();
  return { response, status: response.status, headers: response.headers, text, json: JSON.parse(text) };
}

async function send(lab: Lab, options: Send = {}) {
  return read(await lab.handler(request(options), context(options.challengeId ?? CHALLENGE_ID)));
}

/** A learner with a started session, as the client bootstrap will have made. Returns the cookie value. */
async function ready(lab: Lab): Promise<string> {
  const { cookie } = await lab.service.startLearner(null);
  const started = await lab.service.startChallenge(cookie.value, CHALLENGE_ID);
  assert.equal(started.status, "ok");
  return cookie.value;
}

/** The learner's own session as the service reports it. */
async function session(lab: Lab, cookie: string) {
  const result = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);
  assert.equal(result.status, "ok");
  assert.ok(result.status === "ok" && result.session, "the session exists");
  return result.status === "ok" && result.session ? result.session : (undefined as never);
}

/** Claims a client address behind one trusted proxy. The left-most entry is whatever the client made up. */
const fromIp = (index = 0): Record<string, string> => ({ "x-forwarded-for": `10.0.0.${index}, 198.51.100.7` });

const wrong = (index = 0) => ({ body: submission({ rootCauseId: WRONG_IDS[index] }) });
const right = () => ({ body: submission({ rootCauseId: CORRECT_ID }) });
const invalidBody = () => ({ body: { rootCauseId: "nope", explanation: "short", evidence: [{ kind: "log", logId: "log-99" }] } });

const setCookies = (response: Response) => response.headers.getSetCookie();

/** A service that records what it is called with and then does what the real one does. */
function spy(real: Service) {
  const calls: Parameters<Service["submitDiagnosis"]>[] = [];
  const service: Service = {
    submitDiagnosis(...args) {
      calls.push(args);
      return real.submitDiagnosis(...args);
    },
  };
  return { calls, service };
}

function handlerWith(lab: Lab, overrides: Partial<Parameters<typeof createDiagnosisSubmissionHandler>[0]>) {
  return createDiagnosisSubmissionHandler({
    service: lab.service,
    registry: lab.registry,
    ipSubmissions: lab.ipSubmissions,
    trustedProxyHops: lab.trustedProxyHops,
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */

describe("diagnosis submission handler: correct and incorrect diagnoses", () => {
  test("an incorrect diagnosis is 200 with generic feedback and the attempt window, and never the answer", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const { status, json, text } = await send(lab, { cookie, ...wrong(0) });

    assert.equal(status, 200);
    assert.equal(json.status, "incorrect");
    assert.deepEqual(json.attempts, { used: 1, limit: 3, remaining: 2, resetsAt: "2026-11-01T10:10:00.000Z" });
    assert.equal("resolution" in json, false);
    assert.deepEqual(Object.keys(json).sort(), ["attempts", "feedback", "status"]);
    for (const secret of [CORRECT_ID, CORRECT_LABEL, RESOLUTION]) assert.equal(text.includes(secret), false, secret);
  });

  test("a correct diagnosis is 200 with the resolution, and the session is completed by the server", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const { status, json } = await send(lab, { cookie, ...right() });

    assert.equal(status, 200);
    assert.equal(json.status, "correct");
    assert.deepEqual(json.resolution, { summary: RESOLUTION });
    assert.deepEqual(Object.keys(json).sort(), ["attempts", "feedback", "resolution", "status"]);
    assert.deepEqual(Object.keys(json.feedback).sort(), ["evidenceSummary", "headline", "hints"]);
    assert.equal("score" in json, false);
    const stored = await session(lab, cookie);
    assert.equal(stored.status, "completed");
    assert.equal(stored.attempts.total, 1);
    assert.equal(stored.completion?.resolution.summary, RESOLUTION);
    assert.equal(stored.completion?.submission.rootCauseId, CORRECT_ID);
  });

  test("a wrong then a right diagnosis: the wrong one is counted, the right one completes", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    await send(lab, { cookie, ...wrong(0) });
    const second = await send(lab, { cookie, ...right() });

    assert.equal(second.json.status, "correct");
    assert.deepEqual(second.json.attempts, { used: 1, limit: 3, remaining: 2, resetsAt: "2026-11-01T10:10:00.000Z" });
    const stored = await session(lab, cookie);
    assert.deepEqual([stored.status, stored.attempts.total, stored.attempts.wrong], ["completed", 2, 1]);
    assert.equal(stored.completion?.submission.attempt, 2);
  });

  test("the diagnosis is taken from the body and the challenge from the route, never from the URL's path or other fields", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const swapped = await lab.handler(request({ cookie, challengeId: "challenge-999" }), context(CHALLENGE_ID));
    const { status } = await read(swapped);

    assert.equal(status, 200, "the route parameter decides, whatever the URL says");
  });
});

describe("diagnosis submission handler: parity with the live endpoint's response shapes", () => {
  /** The live handler, on the same clock, with no cookie and no Origin, as an old client sends. */
  async function live(body: unknown, times = 1) {
    const now = () => START;
    const handler = createDiagnosisHandler({
      registry: createDefaultRegistry(),
      wrongAttempts: new FixedWindowLimiter({ limit: 3, windowMs: 10 * MINUTE, now }),
      ipSubmissions: new FixedWindowLimiter({ limit: 10, windowMs: 10 * MINUTE, now }),
      trustedProxyHops: 0,
      appOrigin: null, // the live endpoint in development mode: this old client sends no Origin, and that must keep working
    });
    let last: Awaited<ReturnType<typeof read>> | undefined;
    let attemptCookie: string | undefined; // the live endpoint sets it on the first response only
    for (let i = 0; i < times; i += 1) {
      const req = new Request(`${ORIGIN}/api/challenges/${CHALLENGE_ID}/diagnosis`, {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:3000", ...(attemptCookie ? { cookie: attemptCookie } : {}) },
        body: JSON.stringify(body),
      });
      last = await read(await handler(req, context(CHALLENGE_ID)));
      attemptCookie ??= last.headers.get("set-cookie")?.split(";")[0];
    }
    return last!;
  }

  test("incorrect, correct and invalid bodies are identical to the live endpoint's", async () => {
    for (const [label, input] of [
      ["incorrect", wrong(0).body],
      ["incorrect, another option", wrong(2).body],
      ["correct", right().body],
      ["invalid", invalidBody().body],
      ["invalid, not an object", []],
    ] as const) {
      const lab = setup();
      const cookie = await ready(lab);

      const mine = await send(lab, { cookie, body: input });
      const theirs = await live(input);

      assert.equal(mine.status, theirs.status, label);
      assert.deepEqual(mine.json, theirs.json, label);
    }
  });

  test("a blocked attempt reports the same 429 body as the live endpoint's, at the same instant", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    for (const index of [0, 1, 2]) await send(lab, { cookie, ...wrong(index) });

    const mine = await send(lab, { cookie, ...wrong(3) });
    const theirs = await live(wrong(3).body, 4);

    assert.equal(mine.status, 429);
    assert.equal(theirs.status, 429);
    assert.deepEqual(mine.json, theirs.json);
    assert.equal(mine.headers.get("retry-after"), theirs.headers.get("retry-after"));
  });

  test("every success body passes the client's own response validator", async () => {
    const { isDiagnosisResponse } = await import("@/lib/diagnosis/response");
    const lab = setup();
    const cookie = await ready(lab);

    const bodies = [
      (await send(lab, { cookie, ...invalidBody() })).json,
      (await send(lab, { cookie, ...wrong(0) })).json,
      (await send(lab, { cookie, ...wrong(1) })).json,
      (await send(lab, { cookie, ...wrong(2) })).json,
      (await send(lab, { cookie, ...wrong(3) })).json, // rate-limited
    ];
    lab.advance(10 * MINUTE);
    bodies.push((await send(lab, { cookie, ...right() })).json);

    assert.deepEqual(
      bodies.map((body) => body.status),
      ["invalid", "incorrect", "incorrect", "incorrect", "rate-limited", "correct"],
    );
    for (const body of bodies) assert.equal(isDiagnosisResponse(body), true, String(body.status));
  });
});

describe("diagnosis submission handler: request checks", () => {
  test("a content type that is not JSON is 415", async () => {
    const lab = setup();
    const { status, json } = await send(lab, { cookie: await ready(lab), headers: { "content-type": "text/plain" } });
    assert.equal(status, 415);
    assert.equal(json.status, "error");
    assert.equal(json.code, "unsupported-media-type");
  });

  test("a foreign, malformed or unproven Origin is 403, and a same-origin request passes", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const refusals: Array<Record<string, string>> = [
      { origin: "https://evil.example" },
      { origin: "not a url" },
      { origin: "null" },
      { origin: "http://localhost:3001" },
      { origin: "" }, // no Origin and no proof
      { origin: "", "sec-fetch-site": "cross-site" },
    ];
    for (const headers of refusals) {
      const { status, json } = await send(lab, { cookie, headers });
      assert.equal(status, 403, JSON.stringify(headers));
      assert.equal(json.code, "forbidden");
    }
    assert.equal((await send(lab, { cookie })).status, 200);
    assert.equal((await send(lab, { cookie, headers: { origin: "", "sec-fetch-site": "same-origin" } })).status, 200);
  });

  test("the origin check compares scheme, host and port, and is not fooled by the Host header", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const downgrade = await send(lab, { cookie, url: "https://buglab.example", headers: { origin: "http://buglab.example" } });
    const forgedHost = await send(lab, { cookie, headers: { host: "evil.example", origin: "http://evil.example" } });
    const https = await send(lab, { cookie, url: "https://buglab.example" });

    assert.equal(downgrade.status, 403);
    assert.equal(forgedHost.status, 403);
    assert.equal(https.status, 200);
  });

  test("an Origin with credentials is 403, even when it parses to our own origin, and nothing is recorded", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const { calls, service } = spy(lab.service);
    const handler = handlerWith(lab, { service });

    for (const origin of ["http://evil.example@localhost:3000", "http://user:pass@localhost:3000", "http://@localhost:3000"]) {
      const variants: Array<Record<string, string>> = [{}, { "sec-fetch-site": "same-origin" }];
      for (const extra of variants) {
        const { status, json, response } = await read(await handler(request({ cookie, headers: { origin, ...extra } }), context(CHALLENGE_ID)));
        assert.equal(status, 403, origin);
        assert.equal(json.code, "forbidden");
        assert.deepEqual(setCookies(response), []);
      }
    }

    assert.equal(calls.length, 0, "the service was never called");
    assert.equal((await session(lab, cookie)).attempts.total, 0);
    assert.equal((await send(lab, { cookie, headers: { origin: ORIGIN } })).status, 200, "the same origin without credentials still passes");
  });

  test("a prefetch is 403", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const prefetches: Array<Record<string, string>> = [{ "sec-purpose": "prefetch" }, { purpose: "prefetch" }];
    for (const headers of prefetches) {
      assert.equal((await send(lab, { cookie, headers })).status, 403, JSON.stringify(headers));
    }
  });

  test("the origin check can be replaced by an injected one, which is the only thing it changes", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const permissive = handlerWith(lab, { isSameOrigin: () => true });
    const refusing = handlerWith(lab, { isSameOrigin: () => false });
    const foreign = { cookie, headers: { origin: "https://evil.example" } };

    assert.equal((await read(await permissive(request(foreign), context(CHALLENGE_ID)))).status, 200);
    assert.equal((await read(await refusing(request({ cookie }), context(CHALLENGE_ID)))).status, 403);
    assert.equal((await read(await permissive(request({ cookie, headers: { "content-type": "text/plain" } }), context(CHALLENGE_ID)))).status, 415);
    assert.equal((await read(await permissive(request({ cookie, headers: { "sec-purpose": "prefetch" } }), context(CHALLENGE_ID)))).status, 403);
  });

  test("by default the strict origin policy applies: a missing Origin is not enough, unlike the live endpoint", async () => {
    const lab = setup();
    const noOrigin = request({ cookie: await ready(lab) });
    noOrigin.headers.delete("origin");

    assert.equal((await read(await lab.handler(noOrigin, context(CHALLENGE_ID)))).status, 403);
  });

  describe("with a configured application origin (BUGLAB_APP_ORIGIN)", () => {
    const APP = "https://buglab.example";
    /** The request as the app sees it behind a TLS-terminating proxy: the upstream URL and Host, the browser's real Origin. */
    const upstream = { url: "http://127.0.0.1:3000" };
    const sendTo = async (handler: ReturnType<typeof handlerWith>, options: Send) =>
      read(await handler(request({ ...upstream, ...options }), context(CHALLENGE_ID)));

    test("the real origin is accepted even though the request URL is the proxy's upstream", async () => {
      const lab = setup();
      const handler = handlerWith(lab, { appOrigin: APP });
      const cookie = await ready(lab);

      // Three sends at most: each default submission is a new incorrect attempt, and the window allows three.
      for (const origin of [APP, "https://BUGLAB.EXAMPLE"]) {
        const { status } = await sendTo(handler, { cookie, headers: { origin, "sec-fetch-site": "same-origin" } });
        assert.equal(status, 200, origin);
      }
      assert.equal((await sendTo(handler, { cookie, headers: { origin: "https://buglab.example:443" } })).status, 200, "Sec-Fetch-Site may be absent when a valid Origin is present");
    });

    test("anything else is 403 and records nothing: the upstream's own origin, other origins and schemes, credentials, an invalid Origin with proof", async () => {
      const lab = setup();
      const { calls, service } = spy(lab.service);
      const handler = handlerWith(lab, { appOrigin: APP, service });
      const cookie = await ready(lab);

      const refusals: Array<Record<string, string>> = [
        { origin: "http://127.0.0.1:3000" }, // the request's own URL is not the app's origin
        { origin: "https://evil.example", host: "evil.example", "x-forwarded-host": "evil.example" },
        { origin: "http://buglab.example" },
        { origin: "https://buglab.example:8443" },
        { origin: "https://evil.example@buglab.example" },
        { origin: "https://@buglab.example" }, // empty credentials normalise away in the shared helper
        { origin: "https://:@buglab.example", "sec-fetch-site": "same-origin" },
        { origin: "null", "sec-fetch-site": "same-origin" }, // an invalid Origin is never rescued by Fetch Metadata
        { origin: "garbage", "sec-fetch-site": "same-origin" },
        { origin: "https://buglab.example/", "sec-fetch-site": "same-origin" },
        { origin: APP, "sec-fetch-site": "cross-site" },
        { origin: APP, "sec-fetch-site": "same-site" },
      ];
      for (const headers of refusals) {
        const { status, json, response } = await sendTo(handler, { cookie, headers });
        assert.equal(status, 403, JSON.stringify(headers));
        assert.equal(json.code, "forbidden");
        assert.deepEqual(response.headers.getSetCookie(), [], "a refusal sets no cookie");
      }
      assert.equal(calls.length, 0, "the service was never reached");
    });

    test("a headerless write is still refused: only Sec-Fetch-Site: same-origin stands in for a missing Origin", async () => {
      const lab = setup();
      const handler = handlerWith(lab, { appOrigin: APP });
      const cookie = await ready(lab);
      const headerless = (extra: Record<string, string> = {}) => {
        const req = request({ ...upstream, cookie, headers: extra });
        req.headers.delete("origin");
        return req;
      };

      assert.equal((await read(await handler(headerless(), context(CHALLENGE_ID)))).status, 403, "no proof at all");
      for (const site of ["same-site", "cross-site", "none", ""]) {
        assert.equal((await read(await handler(headerless({ "sec-fetch-site": site }), context(CHALLENGE_ID)))).status, 403, site);
      }
      assert.equal((await read(await handler(headerless({ "sec-fetch-site": "same-origin" }), context(CHALLENGE_ID)))).status, 200);
    });

    test("Secure follows the configured origin, not the request URL and not X-Forwarded-Proto", async () => {
      const lab = setup();
      const https = handlerWith(lab, { appOrigin: APP });
      const http = handlerWith(lab, { appOrigin: "http://localhost:3000" });
      const cookie = await ready(lab);

      // https app origin: Secure, although the request URL is http and the proxy says http.
      for (const forwarded of [undefined, "http"]) {
        const headers: Record<string, string> = { origin: APP };
        if (forwarded) headers["x-forwarded-proto"] = forwarded;
        const { response } = await sendTo(https, { cookie, headers });
        assert.match(response.headers.getSetCookie()[0], /; HttpOnly; SameSite=Strict; Secure$/, String(forwarded));
      }
      // http app origin: never Secure, even if the request URL is https and the client claims https.
      const { response } = await read(
        await http(request({ url: "https://localhost:3000", cookie, headers: { origin: "http://localhost:3000", "x-forwarded-proto": "https" } }), context(CHALLENGE_ID)),
      );
      assert.equal(response.status, 200);
      assert.doesNotMatch(response.headers.getSetCookie()[0], /Secure/);
      assert.match(response.headers.getSetCookie()[0], /Path=\/api; Max-Age=\d+; HttpOnly; SameSite=Strict$/, "the other cookie attributes are unchanged");
    });

    test("with nothing configured the cookie's Secure follows the request URL, as it did before", async () => {
      const lab = setup();
      const cookie = await ready(lab);
      const http = await send(lab, { cookie });
      const https = await send(lab, { cookie, url: "https://buglab.example" });

      assert.doesNotMatch(http.response.headers.getSetCookie()[0], /Secure/);
      assert.match(https.response.headers.getSetCookie()[0], /; Secure$/);
    });
  });

  test("an unknown challenge is 404, and is decided before the body is read", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    for (const rawBody of ["{not json", "x".repeat(DIAGNOSIS_BODY_LIMIT_BYTES + 1)]) {
      const { status, json, text } = await send(lab, { cookie, challengeId: "challenge-999", rawBody });
      assert.equal(status, 404);
      assert.equal(json.code, "unknown-challenge");
      assert.equal(text.includes(CORRECT_ID), false);
    }
  });

  test("a body over 16 KiB is 413, however it is sent", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const big = JSON.stringify({ ...submission(), padding: "x".repeat(DIAGNOSIS_BODY_LIMIT_BYTES) });

    const declared = await send(lab, { cookie, rawBody: big });
    let pulled = 0;
    const chunked = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(4096).fill(0x20));
          if (pulled >= 1000) controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const undeclared = await send(lab, { cookie, rawBody: chunked });

    assert.equal(declared.status, 413);
    assert.equal(declared.json.code, "payload-too-large");
    assert.equal(undeclared.status, 413);
    assert.ok(pulled <= 6, `the whole upload was buffered (${pulled} chunks read)`);
    assert.equal((await session(lab, cookie)).attempts.total, 0);
  });

  test("the limit is 16 KiB: a body just under it is read", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const base = JSON.stringify({ ...submission(), padding: "" });
    const padded = JSON.stringify({ ...submission(), padding: "x".repeat(DIAGNOSIS_BODY_LIMIT_BYTES - base.length) });
    assert.equal(padded.length, DIAGNOSIS_BODY_LIMIT_BYTES);

    assert.equal((await send(lab, { cookie, rawBody: padded })).status, 200, "unknown extra fields are ignored");
  });

  test("a body that is not JSON is 400 invalid, with the live endpoint's error shape", async () => {
    const lab = setup();
    const { status, json } = await send(lab, { cookie: await ready(lab), rawBody: "{not json" });

    assert.equal(status, 400);
    assert.deepEqual(json, { status: "invalid", errors: [{ field: "body", message: "Request body must be valid JSON." }] });
  });

  test("an empty body is 400 invalid, and a JSON value that is not an object is 400 invalid", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    assert.equal((await send(lab, { cookie, rawBody: "" })).status, 400);
    for (const rawBody of ["[]", "null", '"x"', "5"]) {
      const { status, json } = await send(lab, { cookie, rawBody });
      assert.equal(status, 400, rawBody);
      assert.equal(json.status, "invalid");
    }
  });

  test("no refusal here reaches the service, records an attempt or sets a cookie", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const { calls, service } = spy(lab.service);
    const handler = handlerWith(lab, { service });
    const refusals: Send[] = [
      { headers: { "content-type": "text/plain" } },
      { headers: { origin: "https://evil.example" } },
      { headers: { "sec-purpose": "prefetch" } },
      { challengeId: "challenge-999" },
      { rawBody: "x".repeat(DIAGNOSIS_BODY_LIMIT_BYTES + 1) },
      { rawBody: "{nope" },
      { key: "not-a-uuid" },
    ];

    for (const refusal of refusals) {
      const { response } = await read(await handler(request({ cookie, ...refusal }), context(refusal.challengeId ?? CHALLENGE_ID)));
      assert.ok(response.status >= 400, JSON.stringify(refusal).slice(0, 80));
      assert.deepEqual(setCookies(response), []);
    }

    assert.equal(calls.length, 0, "the service was never called");
    assert.equal((await session(lab, cookie)).attempts.total, 0);
  });

  test("a valid request reaches the service with the cookie value, the route's challenge, the parsed body and the normalised key", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const { calls, service } = spy(lab.service);
    const handler = handlerWith(lab, { service });
    const body = { ...wrong(0).body, extra: "ignored by the validator" };

    await read(await handler(request({ cookie, body, key: key(7).toUpperCase() }), context(CHALLENGE_ID)));
    await read(await handler(request({ cookie, body }), context(CHALLENGE_ID)));

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], [cookie, CHALLENGE_ID, body, { submissionId: key(7) }]);
    assert.deepEqual(calls[1], [cookie, CHALLENGE_ID, body, {}], "no header means no submission id is passed");
  });

  test("the learner cookie is found among other cookies, and an old attempt cookie is ignored and never set again", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const { status, response } = await send(lab, {
      rawCookie: `theme=dark; buglab_attempt=0a0b0c0d-0000-4000-8000-000000000001; ${LEARNER_COOKIE}=${cookie}; other=1`,
    });

    assert.equal(status, 200);
    for (const header of setCookies(response)) assert.doesNotMatch(header, /buglab_attempt/);
    assert.equal((await send(lab, { rawCookie: "buglab_attempt=0a0b0c0d-0000-4000-8000-000000000001" })).status, 401, "the old cookie is not an identity");
  });
});

describe("diagnosis submission handler: invalid submissions", () => {
  test("field errors are 400 invalid, in the live endpoint's order, and cost no attempt", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    for (let i = 0; i < 6; i += 1) {
      const { status, json, text } = await send(lab, { cookie, ...invalidBody() });
      assert.equal(status, 400);
      assert.equal(json.status, "invalid");
      assert.deepEqual(json.errors.map((error: { field: string }) => error.field), ["rootCauseId", "explanation", "evidence"]);
      for (const secret of [CORRECT_ID, CORRECT_LABEL, RESOLUTION]) assert.equal(text.includes(secret), false);
    }

    const stored = await session(lab, cookie);
    assert.deepEqual([stored.attempts.total, stored.attempts.wrong, stored.attempts.window.used], [0, 0, 0]);
    assert.equal((await send(lab, { cookie, ...wrong(0) })).status, 200, "all three attempts are still available");
  });

  test("each rule is reported: root cause, explanation length, evidence, and an empty evidence list", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const fields = async (body: unknown) => (await send(lab, { cookie, body })).json.errors.map((e: { field: string }) => e.field);

    assert.deepEqual(await fields(submission({ rootCauseId: "nope" })), ["rootCauseId"]);
    assert.deepEqual(await fields(submission({ explanation: "too short" })), ["explanation"]);
    assert.deepEqual(await fields(submission({ explanation: "x".repeat(2001) })), ["explanation"]);
    assert.deepEqual(await fields(submission({ evidence: [] })), ["evidence"]);
    assert.deepEqual(await fields(submission({ evidence: [{ kind: "log", logId: "log-99" }] })), ["evidence"]);
    assert.deepEqual(await fields(submission({ evidence: Array.from({ length: 21 }, () => ({ kind: "network" as const, requestId: "req-04" })) })), ["evidence"]);
  });
});

describe("diagnosis submission handler: the learner and the session are required", () => {
  async function expectRejected(lab: Lab, options: Send, status: number, code: string) {
    const { json, response, text } = await send(lab, options);
    assert.equal(response.status, status);
    assert.equal(json.status, "error");
    assert.equal(json.code, code);
    assert.deepEqual(Object.keys(json).sort(), ["code", "message", "status"]);
    assert.deepEqual(setCookies(response), [], "a refusal sets no cookie");
    assert.equal(text.includes(CORRECT_ID), false);
    assert.equal(text.includes(RESOLUTION), false);
  }

  test("no cookie, a malformed cookie and an unknown token are all 401 learner-missing, and nothing is created", async () => {
    const lab = setup();

    await expectRejected(lab, {}, 401, "learner-missing");
    for (const cookie of ["garbage", "", "a".repeat(43), `${"a".repeat(42)}=`, "../../admin"]) {
      await expectRejected(lab, { cookie }, 401, "learner-missing");
    }
    await expectRejected(lab, { cookie: issueSessionToken().token }, 401, "learner-missing");
    assert.equal((lab.store as unknown as { learners: Map<unknown, unknown> }).learners.size, 0, "a submission never creates a learner");
  });

  test("an expired learner is 401 learner-expired, and is not revived", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    lab.advance(DEFAULT_EXPIRY_POLICY.idleTtlMs + 1);

    await expectRejected(lab, { cookie }, 401, "learner-expired");
    await expectRejected(lab, { cookie }, 401, "learner-expired");
    assert.equal((await lab.service.checkLearner(cookie)).state, "expired");
  });

  test("a learner that has not started the challenge is 404 session-missing, and the submission creates no session", async () => {
    const lab = setup();
    const { cookie } = await lab.service.startLearner(null);

    await expectRejected(lab, { cookie: cookie.value }, 404, "session-missing");
    assert.equal((lab.store as unknown as { sessions: Map<unknown, unknown> }).sessions.size, 0);
  });

  test("a session from an older version of the challenge is 409 session-outdated and records nothing", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    lab.setVersion("2+changed");

    await expectRejected(lab, { cookie, ...right() }, 409, "session-outdated");

    const stored = await session(lab, cookie);
    assert.equal(stored.status, "active");
    assert.equal(stored.restartRequired, true);
    assert.equal(stored.attempts.total, 0);
  });

  test("starting the challenge again after a change makes the next submission count at the new version", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    lab.setVersion("2+changed");
    await expectRejected(lab, { cookie }, 409, "session-outdated");

    const restarted = await lab.service.startChallenge(cookie, CHALLENGE_ID);
    assert.ok(restarted.status === "ok" && restarted.restarted);

    assert.equal((await send(lab, { cookie, ...right() })).json.status, "correct");
    assert.equal((await session(lab, cookie)).contentVersion, "2+changed");
  });

  test("a completed session is not outdated by a change: its result stays, and a replay is answered from the stored result", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const first = await send(lab, { cookie, key: key(1), ...right() });
    lab.setVersion("2+changed");

    const again = await send(lab, { cookie, key: key(1), ...right() });

    assert.equal(again.status, 200);
    assert.deepEqual(again.json, first.json);
  });

  test("one learner's session is invisible to another: the second learner gets 404 and the first's record is untouched", async () => {
    const lab = setup();
    const first = await ready(lab);
    const { cookie: second } = await lab.service.startLearner(null);

    await expectRejected(lab, { cookie: second.value }, 404, "session-missing");

    assert.equal((await session(lab, first)).attempts.total, 0);
  });

  test("the body cannot name a learner or a session: the cookie decides who is recording", async () => {
    const lab = setup();
    const first = await ready(lab);
    const { cookie: other } = await lab.service.startLearner(null);
    await lab.service.startChallenge(other.value, CHALLENGE_ID);

    await send(lab, { cookie: first, body: { ...wrong(0).body, learnerId: "internal-2", sessionId: "internal-3", learner: other.value } });

    assert.equal((await session(lab, first)).attempts.total, 1);
    assert.equal((await session(lab, other.value)).attempts.total, 0);
  });
});

describe("diagnosis submission handler: Idempotency-Key", () => {
  test("the same key and payload replays the stored result and records nothing new", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const first = await send(lab, { cookie, key: key(1), ...wrong(0) });
    const retry = await send(lab, { cookie, key: key(1), ...wrong(0) });
    const retryAgain = await send(lab, { cookie, key: key(1), ...wrong(0) });

    assert.equal(first.status, 200);
    assert.deepEqual(retry.json, first.json);
    assert.deepEqual(retryAgain.json, first.json);
    const stored = await session(lab, cookie);
    assert.deepEqual([stored.attempts.total, stored.attempts.wrong, stored.attempts.window.used], [1, 1, 1]);
  });

  test("a replay is still a replay when time has passed, and does not invoke the evaluator", async () => {
    let calls = 0;
    const lab = setup({
      evaluator: {
        evaluate(request) {
          calls += 1;
          return deterministicDiagnosisEvaluator.evaluate(request);
        },
      },
    });
    const cookie = await ready(lab);
    const first = await send(lab, { cookie, key: key(1), ...wrong(0) });
    const afterFirst = calls;
    lab.advance(3 * MINUTE);

    const retry = await send(lab, { cookie, key: key(1), ...wrong(0) });

    assert.equal(calls, afterFirst, "the replay does not invoke the evaluator");
    assert.equal(retry.json.status, "incorrect");
    assert.equal((await session(lab, cookie)).attempts.total, 1);
    assert.deepEqual(retry.json.feedback, first.json.feedback);
  });

  test("a retry of a correct submission returns the same completion, once", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const first = await send(lab, { cookie, key: key(1), ...right() });
    const retry = await send(lab, { cookie, key: key(1), ...right() });

    assert.equal(first.json.status, "correct");
    assert.deepEqual(retry.json, first.json);
    assert.equal((await session(lab, cookie)).attempts.total, 1);
  });

  test("evidence in a different order is the same payload", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const evidence = [
      { kind: "network" as const, requestId: "req-04" },
      { kind: "log" as const, logId: "log-03" },
    ];

    const first = await send(lab, { cookie, key: key(1), body: submission({ evidence }) });
    const reordered = await send(lab, { cookie, key: key(1), body: submission({ evidence: [...evidence].reverse() }) });

    assert.equal(first.status, 200);
    assert.equal(reordered.status, 200);
    assert.equal((await session(lab, cookie)).attempts.total, 1);
  });

  test("a different payload under the same key is 409 submission-id-conflict, and records nothing", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    await send(lab, { cookie, key: key(1), ...wrong(0) });

    const conflict = await send(lab, { cookie, key: key(1), ...wrong(1) });
    const conflictRight = await send(lab, { cookie, key: key(1), ...right() });

    for (const result of [conflict, conflictRight]) {
      assert.equal(result.status, 409);
      assert.equal(result.json.status, "error");
      assert.equal(result.json.code, "submission-id-conflict");
      assert.deepEqual(setCookies(result.response), []);
      assert.equal(result.text.includes(RESOLUTION), false);
    }
    const stored = await session(lab, cookie);
    assert.deepEqual([stored.status, stored.attempts.total], ["active", 1], "a conflicting correct answer cannot complete the session");
  });

  test("a different explanation, or different evidence, under the same key is a conflict too", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    await send(lab, { cookie, key: key(1), ...wrong(0) });

    const explanation = await send(lab, { cookie, key: key(1), body: submission({ rootCauseId: WRONG_IDS[0], explanation: `${EXPLANATION} Also, more.` }) });
    const evidence = await send(lab, { cookie, key: key(1), body: submission({ rootCauseId: WRONG_IDS[0], evidence: [{ kind: "log", logId: "log-03" }] }) });

    assert.equal(explanation.status, 409);
    assert.equal(evidence.status, 409);
  });

  test("keys are case-insensitive: an upper-case key is the same key as its lower-case form", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    await send(lab, { cookie, key: key(1).toLowerCase(), ...wrong(0) });
    const upper = await send(lab, { cookie, key: key(1).toUpperCase(), ...wrong(0) });
    const conflict = await send(lab, { cookie, key: key(1).toUpperCase(), ...wrong(1) });

    assert.equal(upper.status, 200);
    assert.equal(conflict.status, 409);
    assert.equal((await session(lab, cookie)).attempts.total, 1);
  });

  test("a key that is not exactly one UUID is 400 invalid, whatever else is true, and nothing happens", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const bad: Send[] = [
      { key: "" },
      { key: "   " },
      { key: "not-a-uuid" },
      { key: "123" },
      { key: key(1).slice(1) },
      { key: `${key(1)}0` },
      { key: `${key(1)}, ${key(2)}` },
      { key: `{${key(1)}}` },
      { key: key(1).replaceAll("-", "") },
      { key: key(1).replace("0a0b", "zzzz") },
      { key: "'; DROP TABLE attempts; --" },
      { key: "a".repeat(5000) },
      { keyLines: [key(1), key(2)] },
      { keyLines: [key(1), key(1)] },
    ];

    for (const options of bad) {
      const { status, json, response } = await send(lab, { cookie, ...options });
      const label = JSON.stringify(options).slice(0, 60);
      assert.equal(status, 400, label);
      assert.deepEqual(json, { status: "invalid", errors: [{ field: "body", message: "Idempotency-Key must be a UUID." }] }, label);
      assert.deepEqual(setCookies(response), [], label);
    }
    assert.equal((await session(lab, cookie)).attempts.total, 0);
    assert.equal((await lab.service.checkLearner(cookie)).state, "active");
  });

  test("a malformed key is refused before the learner is looked at", async () => {
    const lab = setup();

    assert.equal((await send(lab, { key: "nope" })).status, 400);
    assert.equal((await send(lab, { key: key(1) })).status, 401, "a good key with no learner is 401");
  });

  test("without a key every request is a new attempt", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    await send(lab, { cookie, ...wrong(0) });
    await send(lab, { cookie, ...wrong(0) });

    const stored = await session(lab, cookie);
    assert.deepEqual([stored.attempts.total, stored.attempts.wrong], [2, 2]);
  });

  test("a submissionId in the body is not an idempotency key", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const body = { ...wrong(0).body, submissionId: key(9), idempotencyKey: key(9) };

    await send(lab, { cookie, body });
    await send(lab, { cookie, body });

    assert.equal((await session(lab, cookie)).attempts.total, 2);
  });

  test("the same key from two different learners is two different attempts", async () => {
    const lab = setup();
    const first = await ready(lab);
    const second = await ready(lab);

    const a = await send(lab, { cookie: first, key: key(1), ...wrong(0) });
    const b = await send(lab, { cookie: second, key: key(1), ...right() });

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(b.json.status, "correct");
    assert.equal((await session(lab, first)).status, "active");
    assert.equal((await session(lab, second)).status, "completed");
  });

  test("a replay is answered even when the window is now full, and a blocked request does not use up its key", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const first = await send(lab, { cookie, key: key(1), ...wrong(0) });
    await send(lab, { cookie, key: key(2), ...wrong(1) });
    await send(lab, { cookie, key: key(3), ...wrong(2) });

    const replay = await send(lab, { cookie, key: key(1), ...wrong(0) });
    const blocked = await send(lab, { cookie, key: key(4), ...right() });
    lab.advance(10 * MINUTE);
    const retried = await send(lab, { cookie, key: key(4), ...right() });

    assert.equal(replay.status, 200, "the retry of an attempt that was recorded is a replay, not a block");
    assert.deepEqual(replay.json.feedback, first.json.feedback);
    assert.equal(blocked.status, 429);
    assert.equal(retried.status, 200);
    assert.equal(retried.json.status, "correct", "the key of a blocked request was never recorded");
  });

  test("an invalid request does not use up its key", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    assert.equal((await send(lab, { cookie, key: key(1), ...invalidBody() })).status, 400);
    const fixed = await send(lab, { cookie, key: key(1), ...wrong(0) });

    assert.equal(fixed.status, 200);
    assert.equal(fixed.json.status, "incorrect");
  });

  test("after completion, a new key with any payload is answered with the stored result and records nothing", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const done = await send(lab, { cookie, key: key(1), ...right() });

    const later = await send(lab, { cookie, key: key(2), ...wrong(0) });

    assert.equal(later.status, 200);
    assert.equal(later.json.status, "correct");
    assert.deepEqual(later.json.resolution, done.json.resolution);
    const stored = await session(lab, cookie);
    assert.deepEqual([stored.status, stored.attempts.total, stored.attempts.wrong], ["completed", 1, 0]);
  });
});

describe("diagnosis submission handler: the attempt limit", () => {
  test("the fourth incorrect attempt in ten minutes is 429 with Retry-After, in the live endpoint's shape", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    for (const index of [0, 1, 2]) assert.equal((await send(lab, { cookie, ...wrong(index) })).json.status, "incorrect");

    const blocked = await send(lab, { cookie, ...wrong(3) });

    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "600");
    assert.deepEqual(blocked.json, {
      status: "rate-limited",
      retryAfterSeconds: 600,
      attempts: { used: 3, limit: 3, remaining: 0, resetsAt: "2026-11-01T10:10:00.000Z" },
    });
    assert.equal(blocked.headers.get("retry-after"), String(blocked.json.retryAfterSeconds));
  });

  test("a blocked correct answer is byte-for-byte the same response as a blocked wrong one", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    for (const index of [0, 1, 2]) await send(lab, { cookie, ...wrong(index) });

    const blockedRight = await send(lab, { cookie, ...right() });
    const blockedWrong = await send(lab, { cookie, ...wrong(3) });

    assert.equal(blockedRight.status, 429);
    assert.equal(blockedRight.text, blockedWrong.text);
    assert.equal(blockedRight.headers.get("retry-after"), blockedWrong.headers.get("retry-after"));
    for (const secret of [CORRECT_ID, CORRECT_LABEL, RESOLUTION]) assert.equal(blockedRight.text.includes(secret), false);
    assert.equal((await session(lab, cookie)).status, "active", "a blocked correct answer does not complete the session");
  });

  test("the window slides: a slot frees when the oldest incorrect attempt is ten minutes old", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    await send(lab, { cookie, ...wrong(0) }); // t = 0
    lab.advance(5 * MINUTE);
    await send(lab, { cookie, ...wrong(1) }); // t = 5
    lab.advance(1 * MINUTE);
    await send(lab, { cookie, ...wrong(2) }); // t = 6

    const at6 = await send(lab, { cookie, ...wrong(3) });
    lab.advance(3 * MINUTE);
    const at9 = await send(lab, { cookie, ...wrong(3) });
    lab.advance(1 * MINUTE);
    const at10 = await send(lab, { cookie, ...right() });

    assert.equal(at6.status, 429);
    assert.equal(at6.headers.get("retry-after"), "240");
    assert.equal(at9.status, 429);
    assert.equal(at9.headers.get("retry-after"), "60");
    assert.equal(at10.status, 200);
    assert.equal(at10.json.status, "correct");
  });

  test("the limit belongs to the learner's session: another learner is not affected", async () => {
    const lab = setup();
    const first = await ready(lab);
    const second = await ready(lab);
    for (const index of [0, 1, 2]) await send(lab, { cookie: first, ...wrong(index) });

    assert.equal((await send(lab, { cookie: first, ...wrong(3) })).status, 429);
    assert.equal((await send(lab, { cookie: second, ...wrong(3) })).status, 200);
  });

  test("invalid submissions and replays do not use up the window", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    for (let i = 0; i < 5; i += 1) await send(lab, { cookie, ...invalidBody() });
    for (let i = 0; i < 5; i += 1) await send(lab, { cookie, key: key(1), ...wrong(0) });

    const stored = await session(lab, cookie);
    assert.equal(stored.attempts.window.used, 1);
    assert.equal((await send(lab, { cookie, ...wrong(1) })).status, 200);
    assert.equal((await send(lab, { cookie, ...wrong(2) })).status, 200);
  });

  test("a blocked request records nothing and the rate-limited response sets the cookie like any other answer from the service", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    for (const index of [0, 1, 2]) await send(lab, { cookie, ...wrong(index) });

    const blocked = await send(lab, { cookie, ...wrong(3) });

    assert.equal((await session(lab, cookie)).attempts.total, 3);
    assert.equal(setCookies(blocked.response).length, 1);
  });
});

describe("diagnosis submission handler: the IP abuse limit", () => {
  /** One judged submission from a learner nobody has used yet, claiming the given client address. */
  async function judged(lab: Lab, headers: Record<string, string>, which = wrong(0)) {
    return send(lab, { cookie: await ready(lab), headers, ...which });
  }

  test("with a trusted proxy, the eleventh judged submission from one address is 429, whatever the learner", async () => {
    const lab = setup({ trustedProxyHops: 1 });
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      // Rotating spoofed left-most entries must not create new buckets.
      statuses.push((await judged(lab, fromIp(index))).status);
    }

    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429);
  });

  test("the IP limit's 429 has the live endpoint's shape: a retry time and no attempt window", async () => {
    const lab = setup({ trustedProxyHops: 1 });
    for (let index = 0; index < 10; index += 1) await judged(lab, fromIp(index));

    const blocked = await judged(lab, fromIp(99));

    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.json, { status: "rate-limited", retryAfterSeconds: 600 });
    assert.equal(blocked.headers.get("retry-after"), "600");
    assert.deepEqual(setCookies(blocked.response), []);
  });

  test("a blocked address learns nothing about the answer: a correct and a wrong guess get the same response", async () => {
    const lab = setup({ trustedProxyHops: 1 });
    for (let index = 0; index < 10; index += 1) await judged(lab, fromIp(index));

    const blockedWrong = await judged(lab, fromIp(1), wrong(1));
    const blockedRight = await judged(lab, fromIp(2), right());

    assert.equal(blockedWrong.status, 429);
    assert.equal(blockedRight.text, blockedWrong.text);
  });

  test("the service is not asked while the address is blocked, and the blocked submission is never recorded", async () => {
    const lab = setup({ trustedProxyHops: 1 });
    for (let index = 0; index < 10; index += 1) await judged(lab, fromIp(index));
    const { calls, service } = spy(lab.service);
    const handler = handlerWith(lab, { service });
    const cookie = await ready(lab);

    const { status } = await read(await handler(request({ cookie, headers: fromIp(0), ...right() }), context(CHALLENGE_ID)));

    assert.equal(status, 429);
    assert.equal(calls.length, 0);
    assert.equal((await session(lab, cookie)).status, "active");
  });

  test("the limit is per challenge and address, and frees after ten minutes", async () => {
    const lab = setup({ trustedProxyHops: 1 });
    for (let index = 0; index < 10; index += 1) await judged(lab, fromIp(index));
    assert.equal((await judged(lab, fromIp(0))).status, 429);

    lab.advance(10 * MINUTE);

    assert.equal((await judged(lab, fromIp(0))).status, 200);
  });

  test("only judged submissions count: invalid ones, unauthenticated ones, replays and attempt-limit blocks do not", async () => {
    const lab = setup({ trustedProxyHops: 1 });
    const headers = fromIp(0);
    const cookie = await ready(lab);

    for (let i = 0; i < 12; i += 1) await send(lab, { cookie, headers, ...invalidBody() });
    for (let i = 0; i < 12; i += 1) await send(lab, { headers, ...wrong(0) }); // no learner: 401
    for (let i = 0; i < 12; i += 1) await send(lab, { cookie, headers, key: key(1), ...wrong(0) }); // one judged, eleven replays
    for (const index of [1, 2]) await send(lab, { cookie, headers, ...wrong(index) }); // judged: the window is now full
    for (let i = 0; i < 12; i += 1) await send(lab, { cookie, headers, ...wrong(3) }); // blocked by the attempt limit

    // 3 judged so far. Seven more are allowed, then the eighth is blocked.
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) statuses.push((await judged(lab, headers)).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 429]);
  });

  test("without trusted proxies a claimed address is ignored, so no IP limit applies", async () => {
    const lab = setup({ trustedProxyHops: 0 });
    for (let index = 0; index < 12; index += 1) {
      assert.equal((await judged(lab, { "x-forwarded-for": "198.51.100.7" })).status, 200);
    }
  });

  test("a malformed forwarded address is not trusted either", async () => {
    const lab = setup({ trustedProxyHops: 1 });
    for (let index = 0; index < 12; index += 1) {
      assert.equal((await judged(lab, { "x-forwarded-for": "not an address; DROP" })).status, 200);
    }
  });

  test("the limiter is asked before the service and counted after, through the injected limiter", async () => {
    const lab = setup({ trustedProxyHops: 1 });
    const events: string[] = [];
    const counter = {
      status: (k: string) => {
        events.push(`status ${k}`);
        return lab.ipSubmissions.status(k);
      },
      increment: (k: string) => {
        events.push(`increment ${k}`);
        return lab.ipSubmissions.increment(k);
      },
    };
    const handler = handlerWith(lab, {
      ipSubmissions: counter,
      service: { submitDiagnosis: (...args) => (events.push("service"), lab.service.submitDiagnosis(...args)) },
    });

    await read(await handler(request({ cookie: await ready(lab), headers: fromIp(5) }), context(CHALLENGE_ID)));

    assert.deepEqual(events, [`status ${CHALLENGE_ID}:198.51.100.7`, "service", `increment ${CHALLENGE_ID}:198.51.100.7`]);
  });
});

describe("diagnosis submission handler: the learner cookie", () => {
  const TOKEN_COOKIE = new RegExp(`^${LEARNER_COOKIE}=([A-Za-z0-9_-]{43}); Path=/api; Max-Age=(\\d+); HttpOnly; SameSite=Strict$`);

  test("a successful answer sets the learner cookie with exactly the documented attributes, for the same token", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const { response } = await send(lab, { cookie, ...wrong(0) });

    const headers = setCookies(response);
    assert.equal(headers.length, 1);
    const match = TOKEN_COOKIE.exec(headers[0]);
    assert.ok(match, headers[0]);
    assert.equal(match[1], cookie, "the token is resumed, never rotated");
    assert.equal(Number(match[2]), Math.floor(DEFAULT_EXPIRY_POLICY.idleTtlMs / 1000));
    assert.doesNotMatch(headers[0], /Secure/, "plain HTTP development keeps working");
    assert.doesNotMatch(headers[0], /Domain|Expires/);
  });

  test("the cookie is Secure when the request came over HTTPS", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const { response } = await send(lab, { cookie, url: "https://buglab.example" });

    assert.match(setCookies(response)[0], /^buglab_learner=[A-Za-z0-9_-]{43}; Path=\/api; Max-Age=\d+; HttpOnly; SameSite=Strict; Secure$/);
  });

  test("Max-Age never outlives the learner's absolute expiry", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    // Keep the learner alive with writes every 28 days until it is close to the 90-day ceiling.
    for (let i = 0; i < 3; i += 1) {
      lab.advance(28 * DAY);
      assert.equal((await send(lab, { cookie, ...invalidBody() })).status, 400);
    }

    const { response } = await send(lab, { cookie, ...invalidBody() });

    const maxAge = Number(TOKEN_COOKIE.exec(setCookies(response)[0])?.[2]);
    assert.equal(maxAge, Math.floor((DEFAULT_EXPIRY_POLICY.absoluteTtlMs - 84 * DAY) / 1000));
  });

  test("every answer the service gives for a verified learner refreshes the cookie: correct, incorrect, invalid and rate-limited", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const responses = [
      await send(lab, { cookie, ...invalidBody() }),
      await send(lab, { cookie, ...wrong(0) }),
      await send(lab, { cookie, ...wrong(1) }),
      await send(lab, { cookie, ...wrong(2) }),
      await send(lab, { cookie, ...wrong(3) }),
    ];
    lab.advance(10 * MINUTE);
    responses.push(await send(lab, { cookie, ...right() }));

    assert.deepEqual(
      responses.map((r) => r.status),
      [400, 200, 200, 200, 429, 200],
    );
    for (const { response } of responses) assert.match(setCookies(response)[0] ?? "", TOKEN_COOKIE, String(response.status));
  });

  test("no refusal sets a cookie: auth, session, conflict, size, type, origin, malformed body and key, IP limit, failure", async () => {
    const lab = setup({ trustedProxyHops: 1 });
    const cookie = await ready(lab);
    const { cookie: unstarted } = await lab.service.startLearner(null);
    await send(lab, { cookie, key: key(1), ...wrong(0), headers: fromIp(0) });
    const refused: Array<[string, Response]> = [
      ["no learner", (await send(lab, {})).response],
      ["no session", (await send(lab, { cookie: unstarted.value })).response],
      ["conflict", (await send(lab, { cookie, key: key(1), ...wrong(1) })).response],
      ["too large", (await send(lab, { cookie, rawBody: "x".repeat(DIAGNOSIS_BODY_LIMIT_BYTES + 1) })).response],
      ["content type", (await send(lab, { cookie, headers: { "content-type": "text/plain" } })).response],
      ["origin", (await send(lab, { cookie, headers: { origin: "https://evil.example" } })).response],
      ["malformed body", (await send(lab, { cookie, rawBody: "{" })).response],
      ["malformed key", (await send(lab, { cookie, key: "x" })).response],
      ["unknown challenge", (await send(lab, { cookie, challengeId: "nope" })).response],
    ];
    lab.setVersion("2+changed");
    refused.push(["outdated", (await send(lab, { cookie })).response]);
    for (let index = 1; index < 10; index += 1) await judged(lab, fromIp(index));
    refused.push(["IP limit", (await judged(lab, fromIp(0))).response]);

    for (const [label, response] of refused) {
      assert.ok(response.status >= 400, label);
      assert.deepEqual(setCookies(response), [], label);
    }
  });

  async function judged(lab: Lab, headers: Record<string, string>) {
    lab.setVersion(VERSION);
    return send(lab, { cookie: await ready(lab), headers, ...wrong(0) });
  }

  test("a cookie the service returns in a form that is not valid is dropped, never written into a header", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const real = await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, wrong(0).body);
    assert.equal(real.status, "ok");
    const answer = real.status === "ok" ? real.response : (undefined as never);

    for (const issued of [
      { value: "bad\r\nSet-Cookie: admin=1", maxAgeSeconds: 100 },
      { value: "short", maxAgeSeconds: 100 },
      { value: cookie + "; Domain=evil.example", maxAgeSeconds: 100 },
      { value: cookie, maxAgeSeconds: -1 },
      { value: cookie, maxAgeSeconds: Number.NaN },
      { value: cookie, maxAgeSeconds: 1.5 },
      { value: cookie, maxAgeSeconds: Number.POSITIVE_INFINITY },
    ]) {
      const handler = handlerWith(lab, {
        service: { submitDiagnosis: async () => ({ status: "ok" as const, replayed: false, response: answer, cookie: issued }) },
      });

      const { status, response, json } = await read(await handler(request({ cookie }), context(CHALLENGE_ID)));

      assert.equal(status, 200, JSON.stringify(issued));
      assert.equal(json.status, "incorrect");
      assert.deepEqual(setCookies(response), [], JSON.stringify(issued));
    }
  });

  test("a valid cookie whose Max-Age has reached zero is still well formed and is written", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const handler = handlerWithFixedAnswer(lab, { value: cookie, maxAgeSeconds: 0 });

    const { response } = await read(await handler(request({ cookie }), context(CHALLENGE_ID)));

    assert.match(setCookies(response)[0], /Max-Age=0;/);
  });

  function handlerWithFixedAnswer(lab: Lab, issued: { value: string; maxAgeSeconds: number }) {
    return handlerWith(lab, {
      service: {
        submitDiagnosis: async () => ({
          status: "ok" as const,
          replayed: false,
          cookie: issued,
          response: { status: "invalid" as const, errors: [{ field: "body" as const, message: "x" }] },
        }),
      },
    });
  }
});

describe("diagnosis submission handler: response headers", () => {
  /** One response for each status the handler can produce. */
  async function everyResponse() {
    const lab = setup();
    const cookie = await ready(lab);
    const { cookie: unstarted } = await lab.service.startLearner(null);
    const responses: Array<[string, Response]> = [];
    const add = async (label: string, options: Send) => responses.push([label, (await send(lab, options)).response]);

    await add("200 incorrect", { cookie, key: key(1), ...wrong(0) });
    await add("200 replay", { cookie, key: key(1), ...wrong(0) });
    await add("400 invalid", { cookie, ...invalidBody() });
    await add("400 malformed JSON", { cookie, rawBody: "{" });
    await add("400 bad key", { cookie, key: "x" });
    await add("401", {});
    await add("403", { cookie, headers: { origin: "https://evil.example" } });
    await add("404 challenge", { cookie, challengeId: "nope" });
    await add("404 session", { cookie: unstarted.value });
    await add("409 conflict", { cookie, key: key(1), ...wrong(1) });
    await add("413", { cookie, rawBody: "x".repeat(DIAGNOSIS_BODY_LIMIT_BYTES + 1) });
    await add("415", { cookie, headers: { "content-type": "text/plain" } });
    await add("200 incorrect 2", { cookie, ...wrong(1) });
    await add("200 incorrect 3", { cookie, ...wrong(2) });
    await add("429 attempts", { cookie, ...wrong(3) });
    lab.advance(10 * MINUTE);
    await add("200 correct", { cookie, ...right() });

    const stale = setup();
    const staleCookie = await ready(stale);
    stale.setVersion("2+changed");
    responses.push(["409 outdated", (await send(stale, { cookie: staleCookie })).response]);

    const limited = setup({ trustedProxyHops: 1 });
    for (let index = 0; index < 10; index += 1) {
      await send(limited, { cookie: await ready(limited), headers: { "x-forwarded-for": `10.0.0.${index}, 198.51.100.7` } });
    }
    responses.push(["429 IP", (await send(limited, { cookie: await ready(limited), headers: { "x-forwarded-for": "10.0.0.1, 198.51.100.7" } })).response]);

    const broken = createDiagnosisSubmissionHandler({
      service: { submitDiagnosis: () => Promise.reject(new Error("storage is down")) },
      registry: lab.registry,
      ipSubmissions: lab.ipSubmissions,
      trustedProxyHops: 0,
    });
    responses.push(["500", await broken(request({ cookie }), context(CHALLENGE_ID))]);
    return responses;
  }

  test("every response, success or failure, is no-store, nosniff, varies on the cookie and grants no cross-origin access", async () => {
    const responses = await everyResponse();

    const statuses = new Set(responses.map(([, response]) => response.status));
    for (const expected of [200, 400, 401, 403, 404, 409, 413, 415, 429, 500]) assert.ok(statuses.has(expected), `no ${expected} response was checked`);
    for (const [label, response] of responses) {
      assert.equal(response.headers.get("cache-control"), "no-store", label);
      assert.equal(response.headers.get("vary"), "Cookie", label);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff", label);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/, label);
      assert.ok(![...response.headers.keys()].some((name) => name.startsWith("access-control-")), label);
    }
  });

  test("only 429 carries Retry-After, and it is a whole number of seconds", async () => {
    for (const [label, response] of await everyResponse()) {
      const retry = response.headers.get("retry-after");
      if (response.status === 429) assert.match(retry ?? "", /^[1-9]\d*$/, label);
      else assert.equal(retry, null, label);
    }
  });
});

describe("diagnosis submission handler: what a response never contains", () => {
  test("no response contains the token, its hash, the request hash, an internal id or answer-key data", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const token = parseSessionToken(cookie)!;
    const forbidden = [token, hashSessionToken(token), hashSubmission(wrong(0).body), "internal-"];
    const answerOnlyInCompletion = [CORRECT_ID, CORRECT_LABEL];

    const results = [
      await send(lab, { cookie, key: key(1), ...wrong(0) }),
      await send(lab, { cookie, key: key(1), ...wrong(0) }),
      await send(lab, { cookie, key: key(1), ...wrong(1) }),
      await send(lab, { cookie, ...invalidBody() }),
      await send(lab, { cookie, ...wrong(1) }),
      await send(lab, { cookie, ...wrong(2) }),
      await send(lab, { cookie, ...wrong(3) }),
      await send(lab, {}),
      await send(lab, { cookie: issueSessionToken().token }),
      await send(lab, { cookie, challengeId: "nope" }),
    ];
    lab.advance(10 * MINUTE);
    const correct = await send(lab, { cookie, ...right() });
    results.push(correct);
    results.push(await send(lab, { cookie, key: key(5), ...right() }));

    for (const { text, status } of results) {
      for (const value of forbidden) assert.equal(text.includes(value), false, `${status}: ${value.slice(0, 12)}`);
    }
    for (const { text, json } of results) {
      if (json.status === "correct") continue;
      for (const value of [...answerOnlyInCompletion, RESOLUTION]) assert.equal(text.includes(value), false, `${json.status}: ${value.slice(0, 20)}`);
      assert.doesNotMatch(text, /key observation|keyObservation|correctRootCauseId/i);
    }
    assert.equal(correct.text.includes(CORRECT_ID), false, "even the correct response never names the option id");
    assert.equal(correct.text.includes(CORRECT_LABEL), false, "or its label");
  });

  test("the token is only ever in the Set-Cookie header, never in a body", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const { text, response } = await send(lab, { cookie, ...wrong(0) });

    assert.equal(text.includes(cookie), false);
    assert.ok(setCookies(response)[0].includes(cookie));
  });
});

describe("diagnosis submission handler: a client cannot complete a session", () => {
  const forged = {
    completed: true,
    complete: true,
    correct: true,
    isCorrect: true,
    status: "correct",
    result: "correct",
    outcome: "correct",
    score: 100,
    completion: { resolution: { summary: "x" }, feedback: { headline: "x", hints: [], evidenceSummary: { total: 0, logs: 0, network: 0 } } },
    completedAt: "2026-11-01T10:00:00.000Z",
    attempts: { used: 0, limit: 99, remaining: 99 },
    challengeVersion: "1+test",
    sessionStatus: "completed",
  };

  test("flags in the body are ignored: a wrong answer stays wrong and the session stays open", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const { json } = await send(lab, { cookie, body: { ...wrong(0).body, ...forged } });

    assert.equal(json.status, "incorrect");
    assert.notEqual(json.attempts.limit, 99);
    const stored = await session(lab, cookie);
    assert.deepEqual([stored.status, stored.attempts.total, stored.completion], ["active", 1, undefined]);
    assert.equal(stored.completedAt, undefined);
  });

  test("a forged completion stored under a key cannot be replayed into one", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    await send(lab, { cookie, key: key(1), body: { ...wrong(0).body, ...forged } });

    const retry = await send(lab, { cookie, key: key(1), body: { ...wrong(0).body, ...forged } });

    assert.equal(retry.json.status, "incorrect");
    assert.equal((await session(lab, cookie)).status, "active");
  });

  test("headers cannot complete a session either", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const { json } = await send(lab, {
      cookie,
      key: key(1),
      headers: { "x-completed": "true", "x-correct": "1", "x-forwarded-user": "admin", "x-learner-id": "internal-1" },
      ...wrong(0),
    });

    assert.equal(json.status, "incorrect");
    assert.equal((await session(lab, cookie)).status, "active");
  });

  test("only the server's own judgement of a correct diagnosis completes it, and it records that diagnosis, not the forged fields", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const { json } = await send(lab, { cookie, body: { ...right().body, completedAt: "1999-01-01T00:00:00.000Z", score: 0, ...{ completion: forged.completion } } });

    assert.equal(json.status, "correct");
    const stored = await session(lab, cookie);
    assert.equal(stored.status, "completed");
    assert.equal(stored.completedAt, new Date(START).toISOString(), "the completion time is the server's clock");
    assert.equal(stored.completion?.resolution.summary, RESOLUTION);
    assert.notEqual(stored.completion?.resolution.summary, "x");
  });
});

describe("diagnosis submission handler: unexpected failures", () => {
  const SECRET = "password=hunter2 at /srv/app/db.ts:42 token=abc123";

  async function broken(service: Service, options: Send = {}) {
    const lab = setup();
    const handler = handlerWith(lab, { service });
    return read(await handler(request({ cookie: await ready(lab), ...options }), context(CHALLENGE_ID)));
  }

  function assertGeneric(result: Awaited<ReturnType<typeof read>>) {
    assert.equal(result.status, 500);
    assert.deepEqual(result.json, GENERIC_500);
    assert.equal(result.text.includes("hunter2"), false);
    assert.equal(result.text.includes("/srv/"), false);
    assert.equal(result.text.includes("abc123"), false);
    assert.deepEqual(setCookies(result.response), []);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("vary"), "Cookie");
    assert.equal(result.headers.get("x-content-type-options"), "nosniff");
    assert.equal(result.headers.get("retry-after"), null);
  }

  test("a service that throws is a plain 500 with no detail and no cookie", async () => {
    assertGeneric(await broken({ submitDiagnosis: () => Promise.reject(new Error(SECRET)) }));
    assertGeneric(await broken({ submitDiagnosis: () => { throw new Error(SECRET); } }));
    assertGeneric(await broken({ submitDiagnosis: () => Promise.reject(SECRET) }));
    assertGeneric(await broken({ submitDiagnosis: () => Promise.reject(undefined) }));
  });

  test("a storage failure behind the real service is a plain 500, and never an answer", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    for (const failing of ["finalize", "touch", "find"] as const) {
      const store = new Proxy(lab.store, {
        get(target, property) {
          if (property === failing) return () => Promise.reject(new Error(SECRET));
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const service = new LearnerSessionService({ learners: store, sessions: store, attempts: store, registry: lab.registry, challengeVersion: () => VERSION });
      const handler = handlerWith(lab, { service });

      assertGeneric(await read(await handler(request({ cookie, ...right() }), context(CHALLENGE_ID))));
    }
    assert.equal((await session(lab, cookie)).attempts.total, 0, "nothing was recorded");
  });

  test("a service that answers with something that is not a diagnosis answer is a plain 500", async () => {
    for (const response of [{ status: "error", message: "x" }, { status: "mystery" }, undefined, null]) {
      assertGeneric(
        await broken({
          submitDiagnosis: async () => ({ status: "ok" as const, replayed: false, response: response as never, cookie: undefined as never }),
        }),
      );
    }
  });

  test("a route whose parameters fail, and an origin check that throws, are plain 500s too", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const params = await read(await lab.handler(request({ cookie }), { params: Promise.reject(new Error(SECRET)) }));
    const origin = await read(
      await handlerWith(lab, { isSameOrigin: () => { throw new Error(SECRET); } })(request({ cookie }), context(CHALLENGE_ID)),
    );

    assertGeneric(params);
    assertGeneric(origin);
  });

  test("a limiter that throws is a plain 500 and the service is not reached", async () => {
    const lab = setup({ trustedProxyHops: 1 });
    const { calls, service } = spy(lab.service);
    const handler = handlerWith(lab, {
      service,
      ipSubmissions: { status: () => { throw new Error(SECRET); }, increment: () => { throw new Error(SECRET); } },
    });

    const result = await read(await handler(request({ cookie: await ready(lab), headers: { "x-forwarded-for": "10.0.0.1, 198.51.100.7" } }), context(CHALLENGE_ID)));

    assertGeneric(result);
    assert.equal(calls.length, 0);
  });
});

describe("diagnosis submission handler: concurrent submissions", () => {
  test("many copies of one correct submission under one key complete the session once, and every copy gets the same answer", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const results = await Promise.all(Array.from({ length: 8 }, () => send(lab, { cookie, key: key(1), ...right() })));

    assert.deepEqual(new Set(results.map((r) => r.status)), new Set([200]));
    assert.equal(new Set(results.map((r) => r.text)).size, 1, "all eight bodies are identical");
    assert.equal(results[0].json.status, "correct");
    const stored = await session(lab, cookie);
    assert.deepEqual([stored.status, stored.attempts.total], ["completed", 1]);
  });

  test("many copies of one wrong submission under one key record one attempt", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const results = await Promise.all(Array.from({ length: 8 }, () => send(lab, { cookie, key: key(1), ...wrong(0) })));

    assert.equal(new Set(results.map((r) => r.text)).size, 1);
    const stored = await session(lab, cookie);
    assert.deepEqual([stored.attempts.total, stored.attempts.wrong, stored.attempts.window.used], [1, 1, 1]);
  });

  test("two different payloads racing for one key: exactly one wins and the other is a conflict", async () => {
    const lab = setup();
    const cookie = await ready(lab);
    const payloads = [wrong(0), wrong(1), wrong(0), wrong(1)];

    const results = await Promise.all(payloads.map((payload) => send(lab, { cookie, key: key(1), ...payload })));

    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 200, 409, 409]);
    const winners = results.filter((r) => r.status === 200);
    assert.equal(new Set(winners.map((r) => r.text)).size, 1);
    assert.equal((await session(lab, cookie)).attempts.total, 1);
  });

  test("six simultaneous different wrong submissions: three are recorded and three are blocked, never more", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => send(lab, { cookie, key: key(i + 1), ...wrong(i % WRONG_IDS.length) })));

    assert.equal(results.filter((r) => r.status === 200).length, 3);
    assert.equal(results.filter((r) => r.status === 429).length, 3);
    const stored = await session(lab, cookie);
    assert.deepEqual([stored.attempts.total, stored.attempts.wrong], [3, 3]);
  });

  test("a correct and a wrong submission racing: the session completes at most once, and a blocked or later answer never undoes it", async () => {
    const lab = setup();
    const cookie = await ready(lab);

    const results = await Promise.all([
      send(lab, { cookie, key: key(1), ...wrong(0) }),
      send(lab, { cookie, key: key(2), ...right() }),
      send(lab, { cookie, key: key(3), ...wrong(1) }),
      send(lab, { cookie, key: key(4), ...right() }),
    ]);

    assert.ok(results.every((r) => r.status === 200));
    const stored = await session(lab, cookie);
    assert.equal(stored.status, "completed");
    assert.equal(stored.attempts.total - stored.attempts.wrong, 1, "exactly one correct attempt was recorded");
    assert.equal(results.filter((r) => r.json.status === "correct").length >= 1, true);
  });

  test("simultaneous first submissions from different learners are independent", async () => {
    const lab = setup();
    const cookies = await Promise.all(Array.from({ length: 5 }, () => ready(lab)));

    const results = await Promise.all(cookies.map((cookie) => send(lab, { cookie, key: key(1), ...right() })));

    assert.ok(results.every((r) => r.status === 200 && r.json.status === "correct"));
    for (const cookie of cookies) assert.equal((await session(lab, cookie)).attempts.total, 1);
  });
});
