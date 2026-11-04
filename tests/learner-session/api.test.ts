import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createLearnerSessionApi, errorFromResponse, parseRetryAfter } from "@/lib/learner-session/api";
import type { DiagnosisSubmission } from "@/types/diagnosis";

/** A fetch double that answers every call with `reply` and records what was sent. */
function mockFetch(reply: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return reply(String(input), init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const window = { used: 1, limit: 3, remaining: 2 };
const activeSession = {
  challengeId: "challenge-001",
  contentVersion: "1+abc",
  status: "active",
  startedAt: "2026-11-04T10:00:00.000Z",
  restartRequired: false,
  attempts: { total: 0, wrong: 0, window: { used: 0, limit: 3, remaining: 3 } },
};
const submission: DiagnosisSubmission = {
  rootCauseId: "opt-a",
  explanation: "An explanation long enough to be accepted by the validator here.",
  evidence: [{ kind: "log", logId: "log-01" }],
};

describe("requests", () => {
  test("GET and POST go to the documented paths, same-origin, POSTs as JSON", async () => {
    const { fetchImpl, calls } = mockFetch(() => json(200, { learner: { state: "none" } }));
    const api = createLearnerSessionApi({ fetch: fetchImpl });
    await api.getLearner();
    await api.startLearner();
    await api.getSession("challenge-001");
    await api.startSession("challenge-001");
    await api.listAttempts("challenge-001");
    assert.deepEqual(
      calls.map(({ url, init }) => `${init.method} ${url}`),
      [
        "GET /api/learner",
        "POST /api/learner",
        "GET /api/challenges/challenge-001/session",
        "POST /api/challenges/challenge-001/session",
        "GET /api/challenges/challenge-001/attempts",
      ],
    );
    for (const { init } of calls) {
      assert.equal(init.credentials, "same-origin");
      if (init.method === "POST") {
        assert.deepEqual(init.headers, { "Content-Type": "application/json" });
        assert.equal(init.body, "{}");
      } else {
        assert.equal(init.body, undefined);
      }
    }
  });

  test("the challenge id is one encoded path segment", async () => {
    const { fetchImpl, calls } = mockFetch(() => json(200, { session: { state: "none" } }));
    await createLearnerSessionApi({ fetch: fetchImpl }).getSession("a/b?c#d");
    assert.equal(calls[0].url, "/api/challenges/a%2Fb%3Fc%23d/session");
  });

  test("a diagnosis carries its body and the Idempotency-Key, and never a cookie", async () => {
    const { fetchImpl, calls } = mockFetch(() => json(200, { status: "incorrect", feedback: { headline: "h", hints: [], evidenceSummary: { total: 1, logs: 1, network: 0 } }, attempts: window }));
    const key = "3f0c7a3e-8a1b-4c2d-9e3f-0a1b2c3d4e5f";
    await createLearnerSessionApi({ fetch: fetchImpl }).submitDiagnosis("challenge-001", submission, { idempotencyKey: key });
    const { url, init } = calls[0];
    assert.equal(url, "/api/challenges/challenge-001/diagnosis");
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, { "Content-Type": "application/json", "Idempotency-Key": key });
    assert.deepEqual(JSON.parse(String(init.body)), submission);
    assert.ok(!JSON.stringify(init.headers).toLowerCase().includes("cookie"));
  });
});

describe("successful responses are parsed and checked", () => {
  test("learner, session (none and active), started session and attempts", async () => {
    const replies = [
      json(200, { learner: { state: "expired" } }),
      json(201, { learner: { state: "active", created: true } }),
      json(200, { session: { state: "none" } }),
      json(200, { session: { state: "active", ...activeSession } }),
      json(201, { session: { state: "active", created: true, restarted: false, ...activeSession } }),
      json(200, { attempts: [{ seq: 1, submittedAt: "2026-11-04T10:01:00.000Z", rootCauseId: "opt-a", result: "incorrect", evidenceCount: 1 }] }),
    ];
    const { fetchImpl } = mockFetch(() => replies.shift()!);
    const api = createLearnerSessionApi({ fetch: fetchImpl });
    assert.deepEqual(await api.getLearner(), { ok: true, status: 200, data: { state: "expired" } });
    assert.deepEqual(await api.startLearner(), { ok: true, status: 201, data: { created: true } });
    assert.deepEqual(await api.getSession("challenge-001"), { ok: true, status: 200, data: { state: "none" } });
    assert.deepEqual(await api.getSession("challenge-001"), { ok: true, status: 200, data: { state: "active", session: activeSession } });
    assert.deepEqual(await api.startSession("challenge-001"), {
      ok: true,
      status: 201,
      data: { created: true, restarted: false, session: activeSession },
    });
    const attempts = await api.listAttempts("challenge-001");
    assert.ok(attempts.ok && attempts.data.length === 1 && attempts.data[0].result === "incorrect");
  });

  test("unknown fields in a session view are dropped, never passed on", async () => {
    const { fetchImpl } = mockFetch(() => json(200, { session: { state: "active", ...activeSession, internalId: "x", tokenHash: "y" } }));
    const result = await createLearnerSessionApi({ fetch: fetchImpl }).getSession("challenge-001");
    assert.ok(result.ok && result.data.state === "active");
    assert.deepEqual(Object.keys(result.data.session).sort(), Object.keys(activeSession).sort());
  });

  test("a 2xx with a malformed body is an invalid response, not data", async () => {
    for (const body of [
      null,
      { learner: { state: "maybe" } },
      { session: { state: "active", ...activeSession, status: "won" } },
      { session: { state: "active", ...activeSession, status: "completed" } }, // completed without completion
      { attempts: [{ seq: -1 }] },
    ]) {
      const { fetchImpl } = mockFetch(() => json(200, body));
      const api = createLearnerSessionApi({ fetch: fetchImpl });
      const results = [await api.getLearner(), await api.getSession("c"), await api.listAttempts("c")];
      for (const result of results) assert.ok(!result.ok && result.error.kind === "invalid-response", JSON.stringify(body));
    }
  });
});

describe("errors are mapped explicitly", () => {
  const cases: [number, string, string | null][] = [
    [400, "bad-request", "bad-request"],
    [401, "unauthorized", "learner-missing"],
    [401, "unauthorized", "learner-expired"],
    [403, "forbidden", "forbidden"],
    [404, "not-found", "unknown-challenge"],
    [404, "not-found", "session-missing"],
    [409, "conflict", "session-outdated"],
    [409, "conflict", "submission-id-conflict"],
    [413, "payload-too-large", "payload-too-large"],
    [415, "unsupported-media-type", "unsupported-media-type"],
    [429, "rate-limited", null],
    [500, "server", "internal"],
    [503, "server", null],
    [418, "invalid-response", null],
  ];

  for (const [status, kind, code] of cases) {
    test(`${status}${code ? ` ${code}` : ""} -> ${kind}`, async () => {
      const body = code ? { status: "error", code, message: `server says ${code}` } : {};
      const { fetchImpl } = mockFetch(() => json(status, body));
      const result = await createLearnerSessionApi({ fetch: fetchImpl }).getSession("challenge-001");
      assert.ok(!result.ok);
      assert.equal(result.error.kind, kind);
      assert.equal(result.error.status, status);
      assert.equal(result.error.code, code);
      assert.ok(result.error.message.length > 0);
    });
  }

  test("a 429 reports Retry-After in seconds, from the header or the body", () => {
    assert.equal(errorFromResponse(429, {}, "42").retryAfterSeconds, 42);
    assert.equal(errorFromResponse(429, { retryAfterSeconds: 7 }, null).retryAfterSeconds, 7);
    assert.equal(errorFromResponse(429, {}, null).retryAfterSeconds, undefined);
    assert.equal(parseRetryAfter(new Date(Date.UTC(2026, 10, 4, 10, 0, 30)).toUTCString(), Date.UTC(2026, 10, 4, 10, 0, 0)), 30);
    assert.equal(parseRetryAfter("not a date"), undefined);
    assert.equal(parseRetryAfter(new Date(0).toUTCString(), 1_000_000), 0, "a past date is 0, never negative");
  });

  test("an unreadable error body still gives a status-based error", async () => {
    const { fetchImpl } = mockFetch(() => new Response("<html>gateway</html>", { status: 502 }));
    const result = await createLearnerSessionApi({ fetch: fetchImpl }).startLearner();
    assert.ok(!result.ok && result.error.kind === "server" && result.error.code === null);
  });

  test("no response at all is a network error", async () => {
    const api = createLearnerSessionApi({ fetch: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
    const result = await api.getLearner();
    assert.ok(!result.ok && result.error.kind === "network" && result.error.status === null);
  });

  test("a request that outlives the timeout is a timeout", async () => {
    const hang = ((_: unknown, init: RequestInit = {}) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
    const result = await createLearnerSessionApi({ fetch: hang, timeoutMs: 20 }).getLearner();
    assert.ok(!result.ok && result.error.kind === "timeout");
  });

  test("the caller's own abort is rethrown, not reported as a failure", async () => {
    const hang = ((_: unknown, init: RequestInit = {}) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
    const controller = new AbortController();
    const pending = createLearnerSessionApi({ fetch: hang }).getLearner(controller.signal);
    controller.abort();
    await assert.rejects(pending);
  });
});

describe("diagnosis answers", () => {
  const feedback = { headline: "Not quite", hints: ["Look again"], evidenceSummary: { total: 1, logs: 1, network: 0 } };

  test("200 correct/incorrect, 400 invalid and 429 rate-limited are answers to show", async () => {
    const cases: [number, unknown, Record<string, string>?][] = [
      [200, { status: "correct", feedback, resolution: { summary: "s" }, attempts: window }],
      [200, { status: "incorrect", feedback, attempts: window }],
      [400, { status: "invalid", errors: [{ field: "explanation", message: "Too short." }] }],
      [429, { status: "rate-limited", retryAfterSeconds: 60, attempts: window }, { "retry-after": "60" }],
    ];
    for (const [status, body, headers] of cases) {
      const { fetchImpl } = mockFetch(() => json(status, body, headers));
      const result = await createLearnerSessionApi({ fetch: fetchImpl }).submitDiagnosis("c", submission, { idempotencyKey: "k" });
      assert.equal(result.kind, "response", String(status));
      if (result.kind === "response") assert.deepEqual(result.response, body);
    }
  });

  test("a 429 answer takes Retry-After from the header when it is given", async () => {
    const { fetchImpl } = mockFetch(() => json(429, { status: "rate-limited", retryAfterSeconds: 5 }, { "retry-after": "9" }));
    const result = await createLearnerSessionApi({ fetch: fetchImpl }).submitDiagnosis("c", submission, { idempotencyKey: "k" });
    assert.ok(result.kind === "response" && result.response.status === "rate-limited" && result.response.retryAfterSeconds === 9);
  });

  test("a body whose status disagrees with the HTTP status is not trusted", async () => {
    const { fetchImpl } = mockFetch(() => json(500, { status: "correct", feedback, resolution: { summary: "s" }, attempts: window }));
    const result = await createLearnerSessionApi({ fetch: fetchImpl }).submitDiagnosis("c", submission, { idempotencyKey: "k" });
    assert.ok(result.kind === "error" && result.error.kind === "server");
  });

  test("errors without an answer shape are mapped like any other call", async () => {
    for (const [status, code, kind] of [
      [401, "learner-missing", "unauthorized"],
      [404, "session-missing", "not-found"],
      [409, "submission-id-conflict", "conflict"],
      [413, "payload-too-large", "payload-too-large"],
      [403, "forbidden", "forbidden"],
    ] as const) {
      const { fetchImpl } = mockFetch(() => json(status, { status: "error", code, message: "m" }));
      const result = await createLearnerSessionApi({ fetch: fetchImpl }).submitDiagnosis("c", submission, { idempotencyKey: "k" });
      assert.ok(result.kind === "error" && result.error.kind === kind && result.error.code === code, `${status} ${code}`);
    }
  });
});
