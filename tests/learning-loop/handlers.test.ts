import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createDefaultRegistry } from "@/server/diagnosis/registry";
import { listCompletions } from "@/server/learning-loop/completion-read";
import { createLearningLoopHandlers } from "@/server/learning-loop/handlers";
import { MemoryLearningLoopStore } from "@/server/learning-loop/memory-store";
import { createLearningLoopService, type LearningLoopService } from "@/server/learning-loop/service";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { MemoryStore } from "@/server/session/memory-store";
import { issueSessionToken } from "@/server/session/token";
import { RESULT } from "../session/attempt-contract";

const START = Date.parse("2026-11-05T12:00:00Z");
const ORIGIN = "http://localhost:3000";
const WINDOW = { limit: 3, windowMs: 600_000 };
const V1 = "1+aaaaaaaaaaaa";
const C1 = "challenge-001";
const C2 = "challenge-002";
const C3 = "challenge-003";

let n = 0;
function correctAttempt(learnerId: string, sessionId: string) {
  n += 1;
  return {
    learnerId,
    sessionId,
    submissionId: `sub-${n}`,
    requestHash: n.toString(16).padStart(64, "0"),
    rootCauseId: "option-a",
    explanation: "An explanation of what the learner believes is happening.",
    evidence: [{ kind: "log" as const, logId: "log-01" }],
    outcome: "correct" as const,
    result: RESULT,
    window: WINDOW,
  };
}

/** The real diagnosis registry is a Map; copies of its one entry stand in for more published challenges. */
function diagnosisRegistry() {
  const real = createDefaultRegistry();
  const entry = real.get(C1)!;
  return new Map([...real, [C2, entry], [C3, entry]]);
}

async function setup(options: { service?: (real: LearningLoopService) => LearningLoopService } = {}) {
  let now = START;
  const sessions = new MemoryStore({ now: () => now });
  const loop = new MemoryLearningLoopStore({
    listCompletions: (learnerId) => listCompletions(sessions, learnerId),
  });
  let ids = 0;
  const registry = diagnosisRegistry();
  const real = createLearningLoopService({
    learners: sessions,
    sessions,
    store: loop,
    registry,
    now: () => now,
    newId: () => `refl_${String(++ids).padStart(3, "0")}`,
  });
  const handlers = createLearningLoopHandlers({ service: options.service ? options.service(real) : real });
  const issued = issueSessionToken();
  const learner = await sessions.create({ tokenHash: issued.tokenHash });
  const complete = async (challengeId: string) => {
    const { session } = await sessions.start({ learnerId: learner.id, challengeId, challengeVersion: V1 });
    await sessions.record(correctAttempt(learner.id, session.id));
  };
  return { handlers, loop, sessions, learner, cookie: issued.token as string, complete, tick: (ms: number) => (now += ms) };
}
type Lab = Awaited<ReturnType<typeof setup>>;

interface Options {
  cookie?: string;
  headers?: Record<string, string>;
  body?: string;
}

function get(path: string, { cookie, headers = {} }: Options = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "GET",
    headers: { ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}), ...headers },
  });
}

function write(method: "POST" | "PATCH" | "DELETE", path: string, { cookie, headers = {}, body }: Options = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  });
}

const ctx = (reflectionId: string) => ({ params: Promise.resolve({ reflectionId }) });
const json = (value: unknown) => JSON.stringify(value);

/** Success and error envelopes share one cast; missing fields are absent at runtime but typed for assertions. */
type HandlerBody = {
  status?: string;
  code?: string;
  message?: string;
  reflection: { id: string; revision: number; body?: string; deleted?: boolean; deletedAt?: string };
  reflections: Array<{ id: string; challengeId: string }>;
  entries: Array<{ reflectionId: string; challengeId: string }>;
  items: Array<{ kind: string }>;
  nextCursor: string | null;
  existingReflectionId?: string;
  currentRevision?: number;
};

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as HandlerBody };
}

async function createReflection(lab: Lab, challengeId = C1, body = "what I learned") {
  await lab.complete(challengeId);
  const result = await read(await lab.handlers.reflections.POST(write("POST", "/api/learning/reflections", { cookie: lab.cookie, body: json({ challengeId, body }) })));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.reflection as { id: string; revision: number };
}

function assertEnvelope(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

function assertError(result: { status: number; body: HandlerBody }, status: number, code: string) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.status, "error");
  assert.equal(result.body.code, code);
  assert.equal(typeof result.body.message, "string");
}

describe("learning loop handlers: response envelope", () => {
  test("every response, success or error, is no-store, Vary: Cookie and nosniff", async () => {
    const lab = await setup();
    const { reflections, reflection, journal, activity } = lab.handlers;
    const responses = [
      await reflections.GET(get("/api/learning/reflections")), // 401
      await reflections.GET(get("/api/learning/reflections", { cookie: lab.cookie })), // 200
      await reflections.POST(write("POST", "/api/learning/reflections", { cookie: lab.cookie, body: "nope" })), // 400
      await reflections.POST(write("POST", "/api/learning/reflections", { headers: { "content-type": "text/plain" } })), // 415
      await reflection.GET(get("/api/learning/reflections/x", { cookie: lab.cookie }), ctx("x")), // 404
      await journal.GET(get("/api/learning/journal", { cookie: lab.cookie })),
      await activity.GET(get("/api/learning/activity", { cookie: lab.cookie })),
    ];
    for (const response of responses) assertEnvelope(response);
  });

  test("a read that did not refresh the idle expiry sets no cookie; a write sets one", async () => {
    const lab = await setup();
    const readResponse = await lab.handlers.reflections.GET(get("/api/learning/reflections", { cookie: lab.cookie }));
    assert.equal(readResponse.headers.get("set-cookie"), null);

    await lab.complete(C1);
    const created = await lab.handlers.reflections.POST(
      write("POST", "/api/learning/reflections", { cookie: lab.cookie, body: json({ challengeId: C1, body: "b" }) }),
    );
    const setCookie = created.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`^${LEARNER_COOKIE}=${lab.cookie}; Path=/api; Max-Age=\\d+; HttpOnly; SameSite=Strict`));
  });

  test("no response carries an internal id, a session id or deletedAt on a Reflection", async () => {
    const lab = await setup();
    const created = await createReflection(lab);
    const response = await lab.handlers.reflections.GET(get("/api/learning/reflections", { cookie: lab.cookie }));
    const text = JSON.stringify(await response.json());
    assert.ok(text.includes(created.id));
    assert.doesNotMatch(text, /learnerId|challengeSessionId|sessionId|deletedAt|tokenHash/);
    assert.ok(!text.includes(lab.learner.id));
  });
});

describe("learning loop handlers: write guards (POST, PATCH and DELETE)", () => {
  const cases = [
    ["POST", "/api/learning/reflections"],
    ["PATCH", "/api/learning/reflections/refl_001"],
    ["DELETE", "/api/learning/reflections/refl_001"],
  ] as const;
  const call = (lab: Lab, method: (typeof cases)[number][0], request: Request) =>
    method === "POST" ? lab.handlers.reflections.POST(request) : lab.handlers.reflection[method](request, ctx("refl_001"));

  for (const [method, path] of cases) {
    test(`${method}: wrong content type -> 415, cross origin -> 403, prefetch -> 403, headerless -> 403; nothing is written`, async () => {
      const lab = await setup();
      await lab.complete(C1);
      const body = json({ challengeId: C1, body: "b", revision: 1 });
      const base = { cookie: lab.cookie, body };

      assertError(await read(await call(lab, method, write(method, path, { ...base, headers: { "content-type": "text/plain" } }))), 415, "unsupported-media-type");
      assertError(await read(await call(lab, method, write(method, path, { ...base, headers: { origin: "https://evil.example" } }))), 403, "forbidden");
      assertError(await read(await call(lab, method, write(method, path, { ...base, headers: { "sec-purpose": "prefetch" } }))), 403, "forbidden");
      assertError(await read(await call(lab, method, write(method, path, { ...base, headers: { origin: "" } }))), 403, "forbidden");
      assert.deepEqual(await lab.loop.listActiveReflections(lab.learner.id), []);
    });

    test(`${method}: guards run before identity, so a missing cookie with a bad content type is 415, not 401`, async () => {
      const lab = await setup();
      const result = await read(await call(lab, method, write(method, path, { headers: { "content-type": "text/plain" } })));
      assertError(result, 415, "unsupported-media-type");
      assert.equal(result.body.code === "learner-missing", false);
    });

    test(`${method}: malformed JSON, a non-object body and an oversized body are 400 bad-request`, async () => {
      const lab = await setup();
      for (const body of ["{not json", "[]", "null", "42", `{"body":"${"x".repeat(70_000)}"}`]) {
        assertError(await read(await call(lab, method, write(method, path, { cookie: lab.cookie, body }))), 400, "bad-request");
      }
    });
  }

  test("a write with no cookie is 401 learner-missing", async () => {
    const lab = await setup();
    assertError(await read(await lab.handlers.reflections.POST(write("POST", "/api/learning/reflections", { body: json({ challengeId: C1, body: "b" }) }))), 401, "learner-missing");
  });

  test("an expired learner is 401 learner-expired", async () => {
    const lab = await setup();
    lab.tick(31 * 24 * 60 * 60 * 1000);
    assertError(await read(await lab.handlers.reflections.POST(write("POST", "/api/learning/reflections", { cookie: lab.cookie, body: json({ challengeId: C1, body: "b" }) }))), 401, "learner-expired");
  });
});

describe("learning loop handlers: reflections", () => {
  test("POST creates (201) and GET lists, gets, and filters by challengeId", async () => {
    const lab = await setup();
    const first = await createReflection(lab, C1, "  first  ");
    await createReflection(lab, C2, "second");

    const created = await read(await lab.handlers.reflection.GET(get(`/api/learning/reflections/${first.id}`, { cookie: lab.cookie }), ctx(first.id)));
    assert.equal(created.status, 200);
    assert.equal(created.body.reflection.body, "first");
    assert.equal(created.body.reflection.revision, 1);

    const all = await read(await lab.handlers.reflections.GET(get("/api/learning/reflections", { cookie: lab.cookie })));
    assert.equal(all.body.reflections.length, 2);
    const filtered = await read(await lab.handlers.reflections.GET(get(`/api/learning/reflections?challengeId=${C2}`, { cookie: lab.cookie })));
    assert.deepEqual(filtered.body.reflections.map((r) => r.challengeId), [C2]);
  });

  test("POST errors: completion-required and unknown-challenge are 404, a duplicate is 409 with the existing id, bad fields are 400", async () => {
    const lab = await setup();
    const path = "/api/learning/reflections";
    const post = (body: unknown) => lab.handlers.reflections.POST(write("POST", path, { cookie: lab.cookie, body: json(body) }));

    assertError(await read(await post({ challengeId: C1, body: "b" })), 404, "completion-required");
    assertError(await read(await post({ challengeId: "challenge-999", body: "b" })), 404, "unknown-challenge");
    assertError(await read(await post({ challengeId: C1, body: "   " })), 400, "validation-failed");
    assertError(await read(await post({ challengeId: 5, body: "b" })), 400, "validation-failed");
    assertError(await read(await post({ challengeId: C1 })), 400, "validation-failed");

    const existing = await createReflection(lab, C1);
    const duplicate = await read(await post({ challengeId: C1, body: "again" }));
    assertError(duplicate, 409, "reflection-already-exists");
    assert.equal(duplicate.body.existingReflectionId, existing.id);
  });

  test("an unknown challenge is refused before the learner is looked up (no cookie needed to learn nothing)", async () => {
    const lab = await setup();
    const result = await read(await lab.handlers.reflections.POST(write("POST", "/api/learning/reflections", { body: json({ challengeId: "challenge-999", body: "b" }) })));
    assertError(result, 404, "unknown-challenge");
  });

  test("GET one: unknown, foreign and soft-deleted ids are the same 404 not-found", async () => {
    const lab = await setup();
    const mine = await createReflection(lab);
    const other = issueSessionToken();
    await lab.sessions.create({ tokenHash: other.tokenHash });

    const unknown = await read(await lab.handlers.reflection.GET(get("/api/learning/reflections/nope", { cookie: lab.cookie }), ctx("nope")));
    const foreign = await read(await lab.handlers.reflection.GET(get(`/api/learning/reflections/${mine.id}`, { cookie: other.token }), ctx(mine.id)));
    assertError(unknown, 404, "not-found");
    assert.deepEqual(foreign, unknown);
  });

  test("GET list with an invalid challengeId is 400 validation-failed; an unpublished one is just an empty list", async () => {
    const lab = await setup();
    assertError(await read(await lab.handlers.reflections.GET(get("/api/learning/reflections?challengeId=", { cookie: lab.cookie }))), 400, "validation-failed");
    const unpublished = await read(await lab.handlers.reflections.GET(get("/api/learning/reflections?challengeId=challenge-999", { cookie: lab.cookie })));
    assert.equal(unpublished.status, 200);
    assert.deepEqual(unpublished.body, { reflections: [] });
  });

  test("PATCH updates and bumps the revision; a stale revision is 409 with currentRevision and writes nothing", async () => {
    const lab = await setup();
    const { id } = await createReflection(lab);
    const path = `/api/learning/reflections/${id}`;
    const patch = (body: unknown) => lab.handlers.reflection.PATCH(write("PATCH", path, { cookie: lab.cookie, body: json(body) }), ctx(id));

    const updated = await read(await patch({ body: " updated ", revision: 1 }));
    assert.equal(updated.status, 200);
    assert.equal(updated.body.reflection.revision, 2);
    assert.equal(updated.body.reflection.body, "updated");

    const stale = await read(await patch({ body: "late", revision: 1 }));
    assertError(stale, 409, "revision-conflict");
    assert.equal(stale.body.currentRevision, 2);
    const now = await read(await lab.handlers.reflection.GET(get(path, { cookie: lab.cookie }), ctx(id)));
    assert.equal(now.body.reflection.body, "updated");

    assertError(await read(await patch({ body: "x" })), 400, "validation-failed");
    assertError(await read(await patch({ body: "x", revision: "2" })), 400, "validation-failed");
    assertError(await read(await patch({ body: "", revision: 2 })), 400, "validation-failed");
    assertError(await read(await lab.handlers.reflection.PATCH(write("PATCH", "/api/learning/reflections/nope", { cookie: lab.cookie, body: json({ body: "x", revision: 1 }) }), ctx("nope"))), 404, "not-found");
  });

  test("DELETE: 200 with deleted:true and an ISO deletedAt, no restore, a second DELETE is 404", async () => {
    const lab = await setup();
    const { id } = await createReflection(lab, C1);
    lab.tick(5_000);
    const path = `/api/learning/reflections/${id}`;
    const del = (body?: string) => lab.handlers.reflection.DELETE(write("DELETE", path, { cookie: lab.cookie, ...(body === undefined ? {} : { body }) }), ctx(id));

    assertError(await read(await del()), 400, "validation-failed"); // no body: revision missing
    assertError(await read(await del("{}")), 400, "validation-failed");
    assertError(await read(await del(json({ revision: 1.5 }))), 400, "validation-failed");
    const stale = await read(await del(json({ revision: 9 })));
    assertError(stale, 409, "revision-conflict");
    assert.equal(stale.body.currentRevision, 1);

    const deleted = await read(await del(json({ revision: 1 })));
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, {
      reflection: { id, challengeId: C1, revision: 1, deleted: true, deletedAt: new Date(START + 5_000).toISOString() },
    });
    assert.match(deleted.body.reflection.deletedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    assertError(await read(await del(json({ revision: 1 }))), 404, "not-found");
    assertError(await read(await lab.handlers.reflection.GET(get(path, { cookie: lab.cookie }), ctx(id))), 404, "not-found");
  });
});

describe("learning loop handlers: journal", () => {
  async function withThree() {
    const lab = await setup();
    for (const c of [C1, C2, C3]) {
      await createReflection(lab, c, `notes ${c}`);
      lab.tick(1000);
    }
    return lab;
  }
  const journal = (lab: Lab, query = "") => lab.handlers.journal.GET(get(`/api/learning/journal${query}`, { cookie: lab.cookie }));

  test("lists entries, newest first, and pages with an opaque cursor", async () => {
    const lab = await withThree();
    const page1 = await read(await journal(lab, "?limit=2"));
    assert.equal(page1.status, 200);
    assert.deepEqual(page1.body.entries.map((e) => e.challengeId), [C3, C2]);
    assert.equal(typeof page1.body.nextCursor, "string");

    const page2 = await read(await journal(lab, `?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor!)}`));
    assert.deepEqual(page2.body.entries.map((e) => e.challengeId), [C1]);
    assert.equal(page2.body.nextCursor, null);
    assert.doesNotMatch(JSON.stringify(page1.body), /learnerId|challengeSessionId|deletedAt/);
  });

  test("an oversized limit is clamped, not refused", async () => {
    const lab = await withThree();
    const result = await read(await journal(lab, "?limit=500"));
    assert.equal(result.status, 200);
    assert.equal(result.body.entries.length, 3);
  });

  test("a bad limit is 400 bad-request, not validation-failed", async () => {
    const lab = await withThree();
    for (const limit of ["abc", "0", "-1", "1.5", "", "1e3", "0x10", " 2", "99999999999999999999", "1&limit=2"]) {
      assertError(await read(await journal(lab, `?limit=${limit}`)), 400, "bad-request");
    }
  });

  test("an invalid cursor is 400 bad-request", async () => {
    const lab = await withThree();
    for (const cursor of ["", "garbage", "!!!", "e30", "A".repeat(2000)]) {
      assertError(await read(await journal(lab, `?cursor=${cursor}`)), 400, "bad-request");
    }
    assertError(await read(await journal(lab, "?cursor=a&cursor=b")), 400, "bad-request");
  });

  test("a cursor from the activity feed is not a journal cursor", async () => {
    const lab = await withThree();
    const feed = await read(await lab.handlers.activity.GET(get("/api/learning/activity?limit=1", { cookie: lab.cookie })));
    assertError(await read(await journal(lab, `?cursor=${encodeURIComponent(feed.body.nextCursor!)}`)), 400, "bad-request");
  });

  test("401 without a cookie; bad paging parameters do not hide it as a 400 oracle (limit is parsed first, no learner needed)", async () => {
    const lab = await setup();
    assertError(await read(await lab.handlers.journal.GET(get("/api/learning/journal"))), 401, "learner-missing");
    assertError(await read(await lab.handlers.journal.GET(get("/api/learning/journal?limit=abc"))), 400, "bad-request");
  });
});

describe("learning loop handlers: activity (real diagnosis registry Map)", () => {
  async function withActivity() {
    const lab = await setup();
    await lab.complete(C3); // a completion with no reflection
    await createReflection(lab, C1, "a reflection");
    return lab;
  }
  const activity = (lab: Lab, query = "") => lab.handlers.activity.GET(get(`/api/learning/activity${query}`, { cookie: lab.cookie }));
  const kindsOf = (body: HandlerBody) => body.items.map((i) => i.kind).sort();

  test("includes completions and reflections", async () => {
    const lab = await withActivity();
    const result = await read(await activity(lab));
    assert.equal(result.status, 200);
    assert.deepEqual(kindsOf(result.body), ["challenge.completed", "challenge.completed", "reflection.updated"]);
    assert.doesNotMatch(JSON.stringify(result.body), /learnerId|challengeSessionId|deletedAt/);
  });

  test("kinds is a comma-separated string, split into an array", async () => {
    const lab = await withActivity();
    assert.deepEqual(kindsOf((await read(await activity(lab, "?kinds=reflection.updated"))).body), ["reflection.updated"]);
    assert.deepEqual(kindsOf((await read(await activity(lab, "?kinds=challenge.completed"))).body), ["challenge.completed", "challenge.completed"]);
    assert.deepEqual(
      kindsOf((await read(await activity(lab, "?kinds=challenge.completed,reflection.updated"))).body),
      ["challenge.completed", "challenge.completed", "reflection.updated"],
    );
    assert.deepEqual(kindsOf((await read(await activity(lab, "?kinds=reflection.updated&kinds=challenge.completed"))).body).length, 3, "a repeated parameter is joined");
  });

  test("an empty kinds is treated as absent", async () => {
    const lab = await withActivity();
    for (const query of ["?kinds=", "?kinds=,", "?kinds=%20,%20"]) {
      const result = await read(await activity(lab, query));
      assert.equal(result.status, 200, query);
      assert.equal(result.body.items.length, 3, query);
    }
  });

  test("an unknown kind is 400 bad-request", async () => {
    const lab = await withActivity();
    for (const kinds of ["nope", "reflection.updated,nope", "reflection.created"]) {
      assertError(await read(await activity(lab, `?kinds=${kinds}`)), 400, "bad-request");
    }
  });

  test("limit and cursor page the feed; bad limit and bad cursor are 400 bad-request", async () => {
    const lab = await withActivity();
    const page1 = await read(await activity(lab, "?limit=2"));
    assert.equal(page1.body.items.length, 2);
    assert.equal(typeof page1.body.nextCursor, "string");
    const page2 = await read(await activity(lab, `?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor!)}`));
    assert.equal(page2.body.items.length, 1);
    assert.equal(page2.body.nextCursor, null);

    for (const query of ["?limit=abc", "?limit=0", "?limit=-3", "?limit=2.5", "?cursor=garbage", "?cursor="]) {
      assertError(await read(await activity(lab, query)), 400, "bad-request");
    }
  });

  test("401 without a cookie", async () => {
    const lab = await setup();
    assertError(await read(await lab.handlers.activity.GET(get("/api/learning/activity"))), 401, "learner-missing");
  });
});

describe("learning loop handlers: failures", () => {
  test("an unexpected service error is a 500 internal with a generic message and no detail", async () => {
    const lab = await setup({
      service: (real) =>
        new Proxy(real, {
          get(target, property, receiver) {
            if (typeof property === "string" && /Reflection|Journal|Activity/.test(property)) {
              return async () => {
                throw new Error("internal detail: SECRET-DB-DETAIL leaked");
              };
            }
            return Reflect.get(target, property, receiver);
          },
        }),
    });
    const calls = [
      lab.handlers.reflections.GET(get("/api/learning/reflections", { cookie: lab.cookie })),
      lab.handlers.reflections.POST(write("POST", "/api/learning/reflections", { cookie: lab.cookie, body: json({ challengeId: C1, body: "b" }) })),
      lab.handlers.reflection.GET(get("/api/learning/reflections/x", { cookie: lab.cookie }), ctx("x")),
      lab.handlers.reflection.PATCH(write("PATCH", "/api/learning/reflections/x", { cookie: lab.cookie, body: json({ body: "b", revision: 1 }) }), ctx("x")),
      lab.handlers.reflection.DELETE(write("DELETE", "/api/learning/reflections/x", { cookie: lab.cookie, body: json({ revision: 1 }) }), ctx("x")),
      lab.handlers.journal.GET(get("/api/learning/journal", { cookie: lab.cookie })),
      lab.handlers.activity.GET(get("/api/learning/activity", { cookie: lab.cookie })),
    ];
    for (const response of await Promise.all(calls)) {
      assertEnvelope(response);
      const text = await response.clone().text();
      assert.doesNotMatch(text, /SECRET-DB-DETAIL|leaked/);
      assertError(await read(response), 500, "internal");
      assert.equal(response.headers.get("set-cookie"), null);
    }
  });

  test("a route param that fails to resolve is a 500 internal, not an unhandled rejection", async () => {
    const lab = await setup();
    const result = await read(await lab.handlers.reflection.GET(get("/api/learning/reflections/x", { cookie: lab.cookie }), { params: Promise.reject(new Error("boom")) }));
    assertError(result, 500, "internal");
  });
});
