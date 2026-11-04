/*
 * Restoring a completed challenge after a refresh: what the session view carries, where it comes
 * from, and what can and cannot influence it.
 *
 * The view must give the workspace everything it needs to show the finished challenge again (status,
 * the server's completion time, the resolution, the feedback and the diagnosis that solved it) and
 * nothing else. Every field comes from what the SERVER recorded when it evaluated the winning
 * attempt: a client can neither supply nor alter any of it, and an unfinished session carries none.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { MemoryStore } from "@/server/session/memory-store";
import { createLearnerSessionService } from "@/server/session/service";
import { hashSessionToken, parseSessionToken } from "@/server/session/token";
import type { DiagnosisSubmission } from "@/types/diagnosis";
import { CHALLENGE_ID, CORRECT_ID, EXPLANATION, RESOLUTION, WRONG_IDS, submission } from "../diagnosis/fixtures";

const START = Date.parse("2026-11-01T10:00:00Z");
const MINUTE = 60_000;

function lab() {
  let now = START;
  const store = new MemoryStore({ now: () => now });
  const registry = createDefaultChallengeRegistry();
  const service = () =>
    createLearnerSessionService({
      learners: store,
      sessions: store,
      attempts: store,
      registry: registry.diagnosisRegistry,
      challengeVersion: (id) => registry.contentVersion(id)!,
      now: () => now,
    });
  return {
    store,
    registry,
    service,
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}
type Lab = ReturnType<typeof lab>;

async function started(l: Lab, svc = l.service()) {
  const cookie = (await svc.startLearner(undefined)).cookie.value;
  await svc.startChallenge(cookie, CHALLENGE_ID);
  return { svc, cookie };
}

function ok<T extends { status: string }>(result: T): Extract<T, { status: "ok" }> {
  assert.equal(result.status, "ok", JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
}

const view = async (svc: ReturnType<Lab["service"]>, cookie: string) => ok(await svc.getChallengeSession(cookie, CHALLENGE_ID)).session!;

/** A complete journey: one wrong attempt, then the right one two minutes later, with log and network evidence. */
async function solve(l: Lab) {
  const { svc, cookie } = await started(l);
  ok(await svc.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: WRONG_IDS[0] })));
  l.advance(2 * MINUTE);
  const body: DiagnosisSubmission = {
    rootCauseId: CORRECT_ID,
    explanation: EXPLANATION,
    evidence: [
      { kind: "network", requestId: "req-04" },
      { kind: "log", logId: "log-06" },
    ],
  };
  const solvedAt = l.now();
  const submissionId = randomUUID();
  const win = ok(await svc.submitDiagnosis(cookie, CHALLENGE_ID, body, { submissionId }));
  assert.equal(win.response.status, "correct");
  return { svc, cookie, body, win, solvedAt, submissionId };
}

describe("what a completed session carries", () => {
  test("status, the server's completion time, the resolution, the feedback and the diagnosis that solved it", async () => {
    const l = lab();
    const { svc, cookie, body, solvedAt } = await solve(l);

    const v = await view(svc, cookie);

    assert.equal(v.status, "completed");
    assert.equal(v.completedAt, new Date(solvedAt).toISOString(), "the time the server recorded the correct attempt");
    assert.equal(v.restartRequired, false);
    assert.deepEqual(Object.keys(v).sort(), ["attempts", "challengeId", "completedAt", "completion", "contentVersion", "restartRequired", "startedAt", "status"]);
    assert.deepEqual(Object.keys(v.completion!).sort(), ["feedback", "resolution", "submission"]);
    assert.deepEqual(v.completion!.resolution, { summary: RESOLUTION });
    assert.deepEqual(Object.keys(v.completion!.submission).sort(), ["attempt", "evidence", "explanation", "rootCauseId"]);
    assert.equal(v.completion!.submission.rootCauseId, CORRECT_ID);
    assert.equal(v.completion!.submission.attempt, 2, "the second attempt solved it");
    assert.equal(v.completion!.submission.explanation, body.explanation);
    assert.deepEqual(v.completion!.submission.evidence, body.evidence, "the submitted evidence references, in the order submitted");
    assert.deepEqual(v.attempts.total, 2);
    assert.deepEqual(v.attempts.wrong, 1);
  });

  test("the feedback is exactly what the diagnosis response gave, and so is the resolution", async () => {
    const l = lab();
    const { svc, cookie, win } = await solve(l);
    assert.ok(win.response.status === "correct");

    const v = await view(svc, cookie);

    assert.deepEqual(v.completion!.feedback, win.response.feedback);
    assert.deepEqual(v.completion!.resolution, win.response.resolution);
    assert.equal(v.completion!.feedback.evidenceSummary.total, 2);
    assert.equal(v.completion!.feedback.evidenceSummary.logs, 1);
    assert.equal(v.completion!.feedback.evidenceSummary.network, 1);
  });

  test("a refresh gives the same view, from a new service over the same store", async () => {
    const l = lab();
    const { svc, cookie } = await solve(l);
    const first = await view(svc, cookie);
    l.advance(MINUTE);

    const refreshed = await view(l.service(), cookie);

    assert.deepEqual(refreshed, first);
  });

  test("the winning submission replays to the very response it first produced", async () => {
    const l = lab();
    const { svc, cookie, body, win, submissionId } = await solve(l);

    const replay = ok(await svc.submitDiagnosis(cookie, CHALLENGE_ID, body, { submissionId }));

    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.response, win.response);
  });

  test("the evidence in the view is a copy: changing it changes nothing", async () => {
    const l = lab();
    const { svc, cookie } = await solve(l);
    const first = await view(svc, cookie);

    first.completion!.submission.evidence.push({ kind: "log", logId: "log-01" });
    first.completion!.submission.evidence[0] = { kind: "log", logId: "tampered" };
    first.completion!.feedback.hints.push("tampered");
    first.completion!.resolution.summary = "tampered";

    const second = await view(svc, cookie);
    assert.equal(second.completion!.submission.evidence.length, 2);
    assert.deepEqual(second.completion!.submission.evidence[0], { kind: "network", requestId: "req-04" });
    assert.ok(!second.completion!.feedback.hints.includes("tampered"));
    assert.equal(second.completion!.resolution.summary, RESOLUTION);
  });

  test("it carries no internal id, no hash, no token and no answer-key structure", async () => {
    const l = lab();
    const { svc, cookie } = await solve(l);
    const found = await l.store.findByTokenHash(hashSessionToken(parseSessionToken(cookie)!));
    assert.ok(found.state === "active");
    const session = await l.store.find({ learnerId: found.learner.id, challengeId: CHALLENGE_ID });
    const attempts = await l.store.list({ learnerId: found.learner.id, sessionId: session!.id });

    const text = JSON.stringify(await view(svc, cookie));

    const secrets = [
      found.learner.id,
      session!.id,
      ...attempts.flatMap((a) => [a.id, a.requestHash, a.submissionId]),
      hashSessionToken(parseSessionToken(cookie)!),
      cookie,
      "keyObservations",
      "correctRootCauseId",
      "resolutionSummary",
      "requestHash",
      "tokenHash",
      "learnerId",
      "sessionId",
    ];
    for (const secret of secrets) assert.ok(!text.includes(secret), `leaked: ${secret.slice(0, 40)}`);
  });
});

describe("an unfinished session carries no completion", () => {
  test("not before any attempt, and not after wrong ones: no completion, no completion time", async () => {
    const l = lab();
    const { svc, cookie } = await started(l);

    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const v = await view(svc, cookie);
      assert.equal(v.status, "active");
      assert.ok(!("completion" in v) && !("completedAt" in v), `after ${attempt} wrong attempts`);
      assert.ok(!JSON.stringify(v).includes(RESOLUTION));
      if (attempt < 2) ok(await svc.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: WRONG_IDS[attempt] })));
    }
  });
});

describe("completion is decided by the server, never by the client", () => {
  const forged = {
    completed: true,
    completion: { resolution: { summary: "forged" }, feedback: { headline: "forged", hints: [], evidenceSummary: { total: 0, logs: 0, network: 0 } } },
    completedAt: "2026-01-01T00:00:00.000Z",
    status: "correct",
    result: { resolutionSummary: "forged" },
    outcome: "correct",
    restartRequired: false,
    contentVersion: "9+forged",
    attempts: { total: 99 },
  };

  test("a wrong answer with every completion field forged is still wrong, and completes nothing", async () => {
    const l = lab();
    const { svc, cookie } = await started(l);

    const result = ok(await svc.submitDiagnosis(cookie, CHALLENGE_ID, { ...submission({ rootCauseId: WRONG_IDS[0] }), ...forged }));

    assert.equal(result.response.status, "incorrect");
    const v = await view(svc, cookie);
    assert.equal(v.status, "active");
    assert.ok(!("completion" in v) && !("completedAt" in v));
    assert.equal(v.contentVersion, l.registry.contentVersion(CHALLENGE_ID));
    assert.equal(v.attempts.total, 1);
  });

  test("a right answer with forged fields completes with the server's own result, not the forged one", async () => {
    const l = lab();
    const { svc, cookie } = await started(l);

    ok(await svc.submitDiagnosis(cookie, CHALLENGE_ID, { ...submission({ rootCauseId: CORRECT_ID }), ...forged }));

    const v = await view(svc, cookie);
    assert.equal(v.status, "completed");
    assert.equal(v.completion?.resolution.summary, RESOLUTION);
    assert.notEqual(v.completedAt, forged.completedAt);
    assert.equal(v.completedAt, new Date(l.now()).toISOString());
    assert.ok(!JSON.stringify(v).includes("forged"));
  });
});

describe("a completed view belongs to its learner alone", () => {
  test("another learner sees none of it, with or without a session of their own", async () => {
    const l = lab();
    await solve(l);
    const svc = l.service();

    const without = (await svc.startLearner(undefined)).cookie.value;
    assert.equal(ok(await svc.getChallengeSession(without, CHALLENGE_ID)).session, null);

    ok(await svc.startChallenge(without, CHALLENGE_ID));
    const own = await view(svc, without);
    assert.equal(own.status, "active");
    assert.ok(!("completion" in own));
    assert.ok(!JSON.stringify(own).includes(RESOLUTION));
  });
});

describe("a stored completion cannot be changed by what happens afterwards", () => {
  test("later submissions, wrong or right, change neither the view nor the completion time", async () => {
    const l = lab();
    const { svc, cookie } = await solve(l);
    const before = await view(svc, cookie);
    l.advance(MINUTE);

    for (const rootCauseId of [WRONG_IDS[1], CORRECT_ID, WRONG_IDS[0]]) {
      const later = ok(await svc.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId, explanation: `${EXPLANATION} Different words this time.` })));
      assert.equal(later.replayed, true);
      assert.equal(later.response.status, "correct", "the stored verdict is replayed whatever is sent");
    }

    assert.deepEqual(await view(svc, cookie), before);
  });
});
