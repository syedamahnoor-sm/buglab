import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LearnerSessionApi } from "@/lib/learner-session/api";
import { createSessionCoordinator } from "@/lib/learner-session/coordinator";
import type { ApiError, ApiResult, ChallengeSession } from "@/types/learner-session";

type Api = Pick<LearnerSessionApi, "getSession" | "startLearner" | "startSession">;

const session = (overrides: Partial<ChallengeSession> = {}): ChallengeSession => ({
  challengeId: "challenge-001",
  contentVersion: "1+v1",
  status: "active",
  startedAt: "2026-11-04T10:00:00.000Z",
  restartRequired: false,
  attempts: { total: 0, wrong: 0, window: { used: 0, limit: 3, remaining: 3 } },
  ...overrides,
});
const ok = <T>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
const err = (kind: ApiError["kind"], status: number, code: string | null = null): ApiResult<never> => ({
  ok: false,
  error: { kind, status, code, message: "m" },
});

/** A scripted API: each method answers from its queue and every call is logged. */
function scriptedApi(script: {
  getSession?: ApiResult<Awaited<ReturnType<Api["getSession"]>> extends ApiResult<infer T> ? T : never>[];
  startLearner?: ApiResult<{ created: boolean }>[];
  startSession?: ApiResult<{ created: boolean; restarted: boolean; session: ChallengeSession }>[];
}) {
  const calls: string[] = [];
  const next = <T>(name: string, queue: T[] | undefined): Promise<T> => {
    calls.push(name);
    const value = queue?.shift();
    if (value === undefined) throw new Error(`unexpected call: ${name}`);
    return new Promise((resolve) => setTimeout(() => resolve(value), 5));
  };
  const api: Api = {
    getSession: () => next("getSession", script.getSession),
    startLearner: () => next("startLearner", script.startLearner),
    startSession: () => next("startSession", script.startSession),
  };
  return { api, calls };
}

describe("session initialization", () => {
  test("an active, current session is ready with a single read", async () => {
    const { api, calls } = scriptedApi({ getSession: [ok({ state: "active", session: session() })] });
    const init = await createSessionCoordinator(api, "challenge-001").ensure();
    assert.deepEqual(calls, ["getSession"]);
    assert.ok(init.kind === "ready" && !init.learnerCreated && !init.sessionCreated && !init.restarted);
  });

  test("with no learner: create it, then start the session", async () => {
    const { api, calls } = scriptedApi({
      getSession: [err("unauthorized", 401, "learner-missing")],
      startLearner: [ok({ created: true }, 201)],
      startSession: [ok({ created: true, restarted: false, session: session() }, 201)],
    });
    const init = await createSessionCoordinator(api, "challenge-001").ensure();
    assert.deepEqual(calls, ["getSession", "startLearner", "startSession"]);
    assert.ok(init.kind === "ready" && init.learnerCreated && init.sessionCreated);
  });

  test("an expired learner is replaced the same way", async () => {
    const { api, calls } = scriptedApi({
      getSession: [err("unauthorized", 401, "learner-expired")],
      startLearner: [ok({ created: true }, 201)],
      startSession: [ok({ created: true, restarted: false, session: session() }, 201)],
    });
    assert.equal((await createSessionCoordinator(api, "c").ensure()).kind, "ready");
    assert.deepEqual(calls, ["getSession", "startLearner", "startSession"]);
  });

  test("a learner with no session yet starts one", async () => {
    const { api, calls } = scriptedApi({
      getSession: [ok({ state: "none" })],
      startSession: [ok({ created: true, restarted: false, session: session() }, 201)],
    });
    const init = await createSessionCoordinator(api, "c").ensure();
    assert.deepEqual(calls, ["getSession", "startSession"]);
    assert.ok(init.kind === "ready" && init.sessionCreated && !init.learnerCreated);
  });

  test("restartRequired starts the challenge again and reports the restart", async () => {
    const { api, calls } = scriptedApi({
      getSession: [ok({ state: "active", session: session({ restartRequired: true }) })],
      startSession: [ok({ created: true, restarted: true, session: session({ contentVersion: "1+v2" }) }, 201)],
    });
    const init = await createSessionCoordinator(api, "c").ensure();
    assert.deepEqual(calls, ["getSession", "startSession"]);
    assert.ok(init.kind === "ready" && init.restarted && init.session.contentVersion === "1+v2");
  });

  test("a learner that expires between the read and the start is recreated once", async () => {
    const { api, calls } = scriptedApi({
      getSession: [ok({ state: "none" })],
      startSession: [err("unauthorized", 401, "learner-expired"), ok({ created: true, restarted: false, session: session() }, 201)],
      startLearner: [ok({ created: true }, 201)],
    });
    const init = await createSessionCoordinator(api, "c").ensure();
    assert.deepEqual(calls, ["getSession", "startSession", "startLearner", "startSession"]);
    assert.equal(init.kind, "ready");
  });

  test("it never loops: a second 401 after creating the learner fails", async () => {
    const { api, calls } = scriptedApi({
      getSession: [err("unauthorized", 401, "learner-missing")],
      startLearner: [ok({ created: true }, 201)],
      startSession: [err("unauthorized", 401, "learner-missing")],
    });
    const init = await createSessionCoordinator(api, "c").ensure();
    assert.deepEqual(calls, ["getSession", "startLearner", "startSession"]);
    assert.ok(init.kind === "failed" && init.error.kind === "unauthorized");
  });

  test("other failures are reported, not retried", async () => {
    for (const [method, error] of [
      ["getSession", err("not-found", 404, "unknown-challenge")],
      ["getSession", err("forbidden", 403, "forbidden")],
      ["getSession", err("server", 500, "internal")],
    ] as const) {
      const { api, calls } = scriptedApi({ [method]: [error] });
      const init = await createSessionCoordinator(api, "c").ensure();
      assert.deepEqual(calls, [method]);
      assert.ok(init.kind === "failed" && init.error.status === (error.ok ? 0 : error.error.status));
    }
  });
});

describe("no duplicate initialization", () => {
  test("concurrent ensure() calls share one run", async () => {
    const { api, calls } = scriptedApi({
      getSession: [err("unauthorized", 401, "learner-missing")],
      startLearner: [ok({ created: true }, 201)],
      startSession: [ok({ created: true, restarted: false, session: session() }, 201)],
    });
    const coordinator = createSessionCoordinator(api, "c");
    const results = await Promise.all([coordinator.ensure(), coordinator.ensure(), coordinator.ensure()]);
    assert.deepEqual(calls, ["getSession", "startLearner", "startSession"]);
    assert.ok(results.every((result) => result === results[0]));
  });

  test("a ready session is kept: later ensure() calls make no requests", async () => {
    const { api, calls } = scriptedApi({ getSession: [ok({ state: "active", session: session() })] });
    const coordinator = createSessionCoordinator(api, "c");
    const first = await coordinator.ensure();
    assert.equal(await coordinator.ensure(), first);
    assert.deepEqual(calls, ["getSession"]);
  });

  test("a failure is not kept: the next ensure() tries again", async () => {
    const { api, calls } = scriptedApi({
      getSession: [err("network", 0), ok({ state: "active", session: session() })],
    });
    const coordinator = createSessionCoordinator(api, "c");
    assert.equal((await coordinator.ensure()).kind, "failed");
    assert.equal((await coordinator.ensure()).kind, "ready");
    assert.deepEqual(calls, ["getSession", "getSession"]);
  });

  test("invalidate() makes the next ensure() read again and report a version change", async () => {
    const { api, calls } = scriptedApi({
      getSession: [
        ok({ state: "active", session: session() }),
        ok({ state: "active", session: session({ restartRequired: true }) }),
      ],
      startSession: [ok({ created: true, restarted: true, session: session({ contentVersion: "1+v2" }) }, 201)],
    });
    const coordinator = createSessionCoordinator(api, "c");
    const first = await coordinator.ensure();
    assert.ok(first.kind === "ready" && !first.versionChanged);
    coordinator.invalidate();
    const second = await coordinator.ensure();
    assert.deepEqual(calls, ["getSession", "getSession", "startSession"]);
    assert.ok(second.kind === "ready" && second.versionChanged && second.restarted);
  });

  test("a completed session is ready as it is; restoring it is left to Phase 2", async () => {
    const completed = session({
      status: "completed",
      completedAt: "2026-11-04T10:05:00.000Z",
      completion: {
        resolution: { summary: "s" },
        feedback: { headline: "h", hints: [], evidenceSummary: { total: 1, logs: 1, network: 0 } },
        submission: { attempt: 2, rootCauseId: "opt-a", explanation: "e", evidence: [{ kind: "log", logId: "log-01" }] },
      },
    });
    const { api, calls } = scriptedApi({ getSession: [ok({ state: "active", session: completed })] });
    const init = await createSessionCoordinator(api, "c").ensure();
    assert.deepEqual(calls, ["getSession"]);
    assert.ok(init.kind === "ready" && init.session.status === "completed" && init.session.completion);
  });
});
