/*
 * The session view builders (snapshots.ts), tested directly.
 *
 * The service already hands them the right inputs, so through the service these rules are
 * protected twice. These tests pin each rule at the view layer on its own, so that the view stays
 * safe even if a caller passes it something the service never would.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toCompletionView, toSessionView } from "@/server/session/snapshots";
import type { ChallengeSessionRecord, DiagnosisAttemptRecord } from "@/server/session/types";

const T0 = Date.parse("2026-11-01T10:00:00Z");
const WINDOW = { used: 1, limit: 3, resetsAt: T0 + 600_000 };

const RESULT = {
  resolutionSummary: "Here is what happened.",
  feedback: { headline: "Diagnosis confirmed.", hints: ["One.", "Two."], evidenceSummary: { total: 2, logs: 1, network: 1 } },
};

const session = (overrides: Partial<ChallengeSessionRecord> = {}): ChallengeSessionRecord => ({
  id: "internal-session-id",
  learnerId: "internal-learner-id",
  challengeId: "challenge-001",
  challengeVersion: "1+aaaaaaaaaaaa",
  status: "active",
  revision: 4,
  attemptCount: 1,
  wrongAttempts: 1,
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

const completed = (overrides: Partial<ChallengeSessionRecord> = {}) =>
  session({ status: "completed", completedAt: T0 + 120_000, attemptCount: 2, result: RESULT, ...overrides });

const attempt = (overrides: Partial<DiagnosisAttemptRecord> = {}): DiagnosisAttemptRecord => ({
  id: "internal-attempt-id",
  sessionId: "internal-session-id",
  challengeId: "challenge-001",
  seq: 2,
  submissionId: "submission-secret",
  requestHash: "f".repeat(64),
  rootCauseId: "option-a",
  explanation: "What the learner thinks happened.",
  evidence: [
    { kind: "network", requestId: "req-04" },
    { kind: "log", logId: "log-06" },
  ],
  outcome: "correct",
  createdAt: T0 + 120_000,
  ...overrides,
});

describe("toSessionView", () => {
  test("an unfinished session has no completion and no completion time", () => {
    const view = toSessionView(session(), WINDOW, { restartRequired: false });

    assert.equal(view.status, "active");
    assert.ok(!("completion" in view) && !("completedAt" in view));
  });

  test("a completed session carries its completion time and completion", () => {
    const view = toSessionView(completed(), WINDOW, { restartRequired: false, correctAttempt: attempt() });

    assert.equal(view.status, "completed");
    assert.equal(view.completedAt, new Date(T0 + 120_000).toISOString());
    assert.ok(view.completion);
  });

  test("an unfinished session never carries a completion, even if it is handed a correct attempt", () => {
    const view = toSessionView(session(), WINDOW, { restartRequired: false, correctAttempt: attempt() });

    assert.ok(!("completion" in view));
  });

  test("a completed session is never reported as needing a restart, whatever the caller says", () => {
    const view = toSessionView(completed(), WINDOW, { restartRequired: true, correctAttempt: attempt() });

    assert.equal(view.restartRequired, false);
  });

  test("an unfinished session reports restartRequired as it is told", () => {
    assert.equal(toSessionView(session(), WINDOW, { restartRequired: true }).restartRequired, true);
    assert.equal(toSessionView(session(), WINDOW, { restartRequired: false }).restartRequired, false);
  });

  test("a completed session without its winning attempt is an integrity error, never a partial view", () => {
    assert.throws(() => toSessionView(completed(), WINDOW, { restartRequired: false }), /no correct attempt/);
  });

  test("a completed session without its stored result is an integrity error, never a view made from the answer key", () => {
    const withoutResult = completed();
    delete (withoutResult as { result?: unknown }).result;

    assert.throws(() => toSessionView(withoutResult, WINDOW, { restartRequired: false, correctAttempt: attempt() }), /no stored result/);
  });

  test("it is built field by field: no id, hash or other record field comes through", () => {
    const view = toSessionView(completed(), WINDOW, { restartRequired: false, correctAttempt: attempt() });
    const text = JSON.stringify(view);

    for (const secret of ["internal-session-id", "internal-learner-id", "internal-attempt-id", "submission-secret", "f".repeat(64), "revision", "learnerId", "updatedAt", "supersededAt"]) {
      assert.ok(!text.includes(secret), `leaked: ${secret.slice(0, 30)}`);
    }
    assert.deepEqual(Object.keys(view).sort(), ["attempts", "challengeId", "completedAt", "completion", "contentVersion", "restartRequired", "startedAt", "status"]);
  });

  test("the attempt window is the existing contract's shape, with the reset time as an ISO string", () => {
    const view = toSessionView(session(), WINDOW, { restartRequired: false });

    assert.deepEqual(view.attempts, {
      total: 1,
      wrong: 1,
      window: { used: 1, limit: 3, remaining: 2, resetsAt: new Date(T0 + 600_000).toISOString() },
    });
  });
});

describe("toCompletionView", () => {
  test("is built from the stored result and the winning attempt", () => {
    const view = toCompletionView(completed(), attempt());

    assert.deepEqual(view, {
      resolution: { summary: "Here is what happened." },
      feedback: RESULT.feedback,
      submission: {
        attempt: 2,
        rootCauseId: "option-a",
        explanation: "What the learner thinks happened.",
        evidence: [
          { kind: "network", requestId: "req-04" },
          { kind: "log", logId: "log-06" },
        ],
      },
    });
  });

  test("copies the result and the evidence: changing the view changes neither the record nor the attempt", () => {
    const record = completed();
    const winning = attempt();

    const view = toCompletionView(record, winning);
    view.feedback.hints.push("tampered");
    view.feedback.evidenceSummary.total = 99;
    view.submission.evidence.push({ kind: "log", logId: "log-01" });
    view.submission.evidence[0] = { kind: "log", logId: "tampered" };

    assert.deepEqual(record.result?.feedback.hints, ["One.", "Two."]);
    assert.equal(record.result?.feedback.evidenceSummary.total, 2);
    assert.equal(winning.evidence.length, 2);
    assert.deepEqual(winning.evidence[0], { kind: "network", requestId: "req-04" });
  });

  test("an evidence reference is copied by allow-list: fields it should not have never come through", () => {
    const sneaky = { kind: "log", logId: "log-06", secret: "do-not-send", requestId: "req-04" } as never;
    const view = toCompletionView(completed(), attempt({ evidence: [sneaky] }));

    assert.deepEqual(view.submission.evidence, [{ kind: "log", logId: "log-06" }]);
  });

  test("the attempt number is the winning attempt's sequence number", () => {
    assert.equal(toCompletionView(completed(), attempt({ seq: 1 })).submission.attempt, 1);
    assert.equal(toCompletionView(completed(), attempt({ seq: 7 })).submission.attempt, 7);
  });
});
