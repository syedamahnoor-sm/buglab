/*
 * The contract every AttemptStore must satisfy: recording an attempt is one atomic
 * step that checks the idempotency key, the completed state and the attempt
 * window, then appends the attempt and (for a correct outcome) completes the
 * session. Written against the port only, so a durable store runs the same suite.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { issueSessionToken } from "@/server/session/token";
import {
  StoreError,
  type AttemptWindow,
  type CompletionResult,
  type RecordAttemptInput,
  type RecordAttemptResult,
} from "@/server/session/types";
import type { Store, StoreHarness } from "./store-contract";

const CHALLENGE = "challenge-001";
const WINDOW: AttemptWindow = { limit: 3, windowMs: 600_000 };

/** What a correct attempt stores on its session: what the learner was shown. */
export const RESULT: CompletionResult = {
  resolutionSummary: "The challenge is resolved: here is what happened.",
  feedback: { headline: "Diagnosis confirmed.", hints: ["A hint.", "Another hint."], evidenceSummary: { total: 1, logs: 1, network: 0 } },
};

let counter = 0;
/** A valid SHA-256-shaped hash, different for every number. */
const hashOf = (n: number) => n.toString(16).padStart(64, "0");

async function newLearnerWithSession(store: Store, challengeId = CHALLENGE) {
  const { tokenHash } = issueSessionToken();
  const learner = await store.create({ tokenHash });
  const { session } = await store.start({ learnerId: learner.id, challengeId, challengeVersion: "1" });
  return { learner, session };
}

/** A valid incorrect attempt with a fresh submission id, unless told otherwise. */
function attempt(
  owner: { learner: { id: string }; session: { id: string } },
  overrides: Partial<RecordAttemptInput> = {},
): RecordAttemptInput {
  const n = ++counter;
  const input: RecordAttemptInput = {
    learnerId: owner.learner.id,
    sessionId: owner.session.id,
    submissionId: `submission-${n}`,
    requestHash: hashOf(n),
    rootCauseId: "option-a",
    explanation: "An explanation of what the learner believes is happening.",
    evidence: [{ kind: "log", logId: "log-01" }],
    outcome: "incorrect",
    window: WINDOW,
    ...overrides,
  };
  // A correct attempt must say what the learner was shown, unless a test is deliberately leaving it out.
  return input.outcome === "correct" && !("result" in overrides) ? { ...input, result: RESULT } : input;
}

function expectKind<K extends RecordAttemptResult["kind"]>(result: RecordAttemptResult, kind: K) {
  assert.equal(result.kind, kind);
  return result as Extract<RecordAttemptResult, { kind: K }>;
}

function tryToMutate(value: object, changes: Record<string, unknown>) {
  try {
    Object.assign(value, changes);
  } catch {
    // A frozen copy rejects the write. Either outcome is fine: what matters is the store.
  }
}

const rejectsWith = (code: StoreError["code"]) => (error: unknown) => error instanceof StoreError && error.code === code;

export function runAttemptStoreContract(
  label: string,
  createHarness: () => StoreHarness | Promise<StoreHarness>,
): void {
  describe(`AttemptStore contract: ${label}`, () => {
    describe("recording", () => {
      test("records an attempt with the documented fields, and counts it on the session", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const input = attempt(owner, { rootCauseId: "option-b", evidence: [{ kind: "network", requestId: "req-04" }] });

        const result = expectKind(await h.store.record(input), "recorded");

        assert.equal(result.attempt.seq, 1);
        assert.equal(result.attempt.sessionId, owner.session.id);
        assert.equal(result.attempt.challengeId, CHALLENGE);
        assert.equal(result.attempt.submissionId, input.submissionId);
        assert.equal(result.attempt.requestHash, input.requestHash);
        assert.equal(result.attempt.rootCauseId, "option-b");
        assert.equal(result.attempt.explanation, input.explanation);
        assert.deepEqual(result.attempt.evidence, [{ kind: "network", requestId: "req-04" }]);
        assert.equal(result.attempt.outcome, "incorrect");
        assert.equal(result.attempt.createdAt, h.now());
        assert.ok(result.attempt.id.length > 0);
        assert.equal(result.session.attemptCount, 1);
        assert.equal(result.session.wrongAttempts, 1);
        assert.equal(result.session.status, "active");
        assert.equal(result.session.revision, 1);
        assert.deepEqual(result.window, { used: 1, limit: 3, resetsAt: h.now() + WINDOW.windowMs });
      });

      test("numbers attempts 1, 2, 3 within a session and lists them in order", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);

        for (let i = 0; i < 3; i++) {
          await h.advance(1_000);
          expectKind(await h.store.record(attempt(owner)), "recorded");
        }

        const listed = await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id });
        assert.deepEqual(listed.map((item) => item.seq), [1, 2, 3]);
        assert.deepEqual(
          listed.map((item) => item.createdAt),
          [...listed.map((item) => item.createdAt)].sort((a, b) => a - b),
        );
      });

      test("every session numbers its own attempts from 1", async () => {
        const h = await createHarness();
        const first = await newLearnerWithSession(h.store);
        const second = await newLearnerWithSession(h.store);
        await h.store.record(attempt(first));
        await h.store.record(attempt(first));

        const result = expectKind(await h.store.record(attempt(second)), "recorded");

        assert.equal(result.attempt.seq, 1);
      });

      test("one learner's sessions for two challenges keep separate histories", async () => {
        const h = await createHarness();
        const a = await newLearnerWithSession(h.store, "challenge-001");
        const { session: other } = await h.store.start({ learnerId: a.learner.id, challengeId: "challenge-002", challengeVersion: "1" });
        await h.store.record(attempt(a));

        const result = expectKind(await h.store.record(attempt({ learner: a.learner, session: other })), "recorded");

        assert.equal(result.attempt.seq, 1);
        assert.equal(result.attempt.challengeId, "challenge-002");
        assert.equal((await h.store.list({ learnerId: a.learner.id, sessionId: a.session.id })).length, 1);
      });
    });

    describe("completion", () => {
      test("a correct attempt completes the session in the same step, and does not count as wrong", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        await h.store.record(attempt(owner));
        await h.advance(5_000);

        const result = expectKind(await h.store.record(attempt(owner, { outcome: "correct" })), "recorded");

        assert.equal(result.session.status, "completed");
        assert.equal(result.session.completedAt, h.now());
        assert.equal(result.session.wrongAttempts, 1);
        assert.equal(result.session.attemptCount, 2);
        const found = await h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE });
        assert.deepEqual(found, result.session);
      });

      test("once completed, nothing more is recorded: the stored correct attempt comes back", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const done = expectKind(await h.store.record(attempt(owner, { outcome: "correct" })), "recorded");

        for (const outcome of ["incorrect", "correct"] as const) {
          const result = expectKind(await h.store.record(attempt(owner, { outcome })), "already-completed");
          assert.deepEqual(result.attempt, done.attempt);
        }

        const listed = await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id });
        assert.equal(listed.length, 1);
        const found = await h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE });
        assert.equal(found?.attemptCount, 1);
        assert.equal(found?.completedAt, done.session.completedAt);
      });

      test("a session can only ever hold one correct attempt", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);

        for (let i = 0; i < 5; i++) await h.store.record(attempt(owner, { outcome: "correct" }));

        const listed = await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id });
        assert.equal(listed.filter((item) => item.outcome === "correct").length, 1);
      });
    });

    describe("the completion result", () => {
      const find = (h: StoreHarness, owner: { learner: { id: string } }) => h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE });

      test("a correct attempt must say what the learner was shown, and without it nothing is recorded", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);

        await assert.rejects(h.store.record(attempt(owner, { outcome: "correct", result: undefined })), rejectsWith("invalid-input"));

        const session = await find(h, owner);
        assert.equal(session?.status, "active");
        assert.equal(session?.attemptCount, 0);
        assert.deepEqual(await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id }), []);
      });

      test("an incorrect attempt may not carry one", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);

        await assert.rejects(h.store.record(attempt(owner, { outcome: "incorrect", result: RESULT })), rejectsWith("invalid-input"));
        assert.equal((await find(h, owner))?.attemptCount, 0);
      });

      const malformed: [string, unknown][] = [
        ["null", null],
        ["a string", "resolved"],
        ["an empty resolution summary", { ...RESULT, resolutionSummary: "" }],
        ["a numeric resolution summary", { ...RESULT, resolutionSummary: 5 }],
        ["no feedback", { resolutionSummary: RESULT.resolutionSummary }],
        ["a numeric headline", { ...RESULT, feedback: { ...RESULT.feedback, headline: 5 } }],
        ["hints that are not a list", { ...RESULT, feedback: { ...RESULT.feedback, hints: "hint" } }],
        ["a hint that is not a string", { ...RESULT, feedback: { ...RESULT.feedback, hints: ["ok", 3] } }],
        ["no evidence summary", { ...RESULT, feedback: { headline: "h", hints: [] } }],
        ["a negative count", { ...RESULT, feedback: { ...RESULT.feedback, evidenceSummary: { total: -1, logs: 0, network: 0 } } }],
        ["a fractional count", { ...RESULT, feedback: { ...RESULT.feedback, evidenceSummary: { total: 1.5, logs: 0, network: 0 } } }],
        ["a missing count", { ...RESULT, feedback: { ...RESULT.feedback, evidenceSummary: { total: 1, logs: 0 } } }],
      ];
      for (const [label, result] of malformed) {
        test(`a result with ${label} is refused and records nothing`, async () => {
          const h = await createHarness();
          const owner = await newLearnerWithSession(h.store);

          await assert.rejects(h.store.record(attempt(owner, { outcome: "correct", result: result as never })), rejectsWith("invalid-input"));

          assert.equal((await find(h, owner))?.status, "active");
          assert.equal((await find(h, owner))?.attemptCount, 0);
        });
      }

      test("completion stores the result on the session, and an unfinished session has none", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const wrong = expectKind(await h.store.record(attempt(owner)), "recorded");
        assert.ok(!("result" in wrong.session));

        const done = expectKind(await h.store.record(attempt(owner, { outcome: "correct" })), "recorded");

        assert.deepEqual(done.session.result, RESULT);
        assert.deepEqual((await find(h, owner))?.result, RESULT);
      });

      test("the stored result is a copy: neither the caller's object nor a returned one can change it", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const mine = structuredClone(RESULT) as { resolutionSummary: string; feedback: { headline: string; hints: string[]; evidenceSummary: { total: number; logs: number; network: number } } };

        const done = expectKind(await h.store.record(attempt(owner, { outcome: "correct", result: mine })), "recorded");
        mine.resolutionSummary = "tampered after the fact";
        mine.feedback.hints.push("tampered");
        const returned = done.session.result!;
        tryToMutate(returned, { resolutionSummary: "tampered" });
        tryToMutate(returned.feedback, { headline: "tampered" });
        try {
          (returned.feedback.hints as string[]).push("tampered");
        } catch {
          // A frozen list rejects the write: either outcome is fine.
        }

        assert.deepEqual((await find(h, owner))?.result, RESULT);
      });

      test("a later correct attempt never overwrites the stored result", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        await h.store.record(attempt(owner, { outcome: "correct" }));

        const other = { ...RESULT, resolutionSummary: "A different explanation, offered later." };
        const again = expectKind(await h.store.record(attempt(owner, { outcome: "correct", result: other })), "already-completed");

        assert.deepEqual(again.session.result, RESULT);
        assert.deepEqual((await find(h, owner))?.result, RESULT);
      });

      test("a result is never part of an attempt record", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const done = expectKind(await h.store.record(attempt(owner, { outcome: "correct" })), "recorded");

        assert.ok(!("result" in done.attempt));
        assert.ok(!JSON.stringify(await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).includes(RESULT.resolutionSummary));
      });

      test("a duplicate and an already-completed answer carry the session as it is, with the stored result", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const winning = attempt(owner, { outcome: "correct" });
        await h.store.record(winning);

        const duplicate = expectKind(await h.store.record(winning), "duplicate");
        const later = expectKind(await h.store.record(attempt(owner)), "already-completed");

        for (const result of [duplicate, later]) {
          assert.equal(result.session.status, "completed");
          assert.deepEqual(result.session.result, RESULT);
        }
      });

      test("a duplicate of an earlier wrong attempt, in a session that is still unfinished, reports the session without a result", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const wrong = attempt(owner);
        await h.store.record(wrong);

        const duplicate = expectKind(await h.store.record(wrong), "duplicate");

        assert.equal(duplicate.session.status, "active");
        assert.ok(!("result" in duplicate.session));
      });
    });

    describe("duplicate submissions", () => {
      test("the same submission id with the same content is a duplicate: the original comes back, nothing is recorded", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const input = attempt(owner);
        const first = expectKind(await h.store.record(input), "recorded");
        await h.advance(1_000);

        const again = expectKind(await h.store.record(input), "duplicate");

        assert.deepEqual(again.attempt, first.attempt);
        assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 1);
        assert.equal((await h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE }))?.wrongAttempts, 1);
      });

      test("the same submission id with different content is a conflict, and nothing is recorded", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const input = attempt(owner);
        await h.store.record(input);

        expectKind(await h.store.record({ ...input, requestHash: hashOf(9_999), rootCauseId: "option-z" }), "conflict");

        assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 1);
      });

      test("a retry is a duplicate even when the window is full or the session is completed", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const inputs = [attempt(owner), attempt(owner), attempt(owner)];
        for (const input of inputs) await h.store.record(input);
        expectKind(await h.store.record(attempt(owner)), "rate-limited");

        expectKind(await h.store.record(inputs[0]), "duplicate");

        const other = await newLearnerWithSession(h.store);
        const correct = attempt(other, { outcome: "correct" });
        await h.store.record(correct);
        expectKind(await h.store.record(correct), "duplicate");
      });

      test("submission ids are scoped to a session: another session can use the same id", async () => {
        const h = await createHarness();
        const first = await newLearnerWithSession(h.store);
        const second = await newLearnerWithSession(h.store);
        const input = attempt(first);
        await h.store.record(input);

        expectKind(await h.store.record({ ...input, learnerId: second.learner.id, sessionId: second.session.id }), "recorded");
      });
    });

    describe("the attempt window", () => {
      test("blocks once the window is full of incorrect attempts, whatever the next outcome would be", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const first = expectKind(await h.store.record(attempt(owner)), "recorded");
        await h.advance(1_000);
        await h.store.record(attempt(owner));
        await h.advance(1_000);
        await h.store.record(attempt(owner));

        for (const outcome of ["incorrect", "correct"] as const) {
          const blocked = expectKind(await h.store.record(attempt(owner, { outcome })), "rate-limited");
          assert.equal(blocked.retryAfterMs, first.attempt.createdAt + WINDOW.windowMs - h.now());
          assert.equal(blocked.window.used, 3);
          assert.equal(blocked.window.resetsAt, first.attempt.createdAt + WINDOW.windowMs);
        }

        const found = await h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE });
        assert.equal(found?.attemptCount, 3, "a blocked attempt is never recorded");
        assert.equal(found?.status, "active");
      });

      test("is a sliding window: an attempt frees its slot exactly when it leaves the window", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const t0 = h.now();
        await h.store.record(attempt(owner));
        await h.advance(1_000);
        await h.store.record(attempt(owner));
        await h.advance(1_000);
        await h.store.record(attempt(owner));

        await h.advance(t0 + WINDOW.windowMs - 1 - h.now());
        expectKind(await h.store.record(attempt(owner)), "rate-limited");

        await h.advance(1);
        const freed = expectKind(await h.store.record(attempt(owner)), "recorded");
        assert.equal(freed.window.used, 3, "two old attempts remain in the window, plus this one");
      });

      test("correct attempts never count toward the window", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        await h.store.record(attempt(owner));
        await h.store.record(attempt(owner));

        const result = expectKind(await h.store.record(attempt(owner, { outcome: "correct" })), "recorded");

        assert.equal(result.window.used, 2);
      });

      test("windowStatus reports the current window without recording anything", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const owner2 = { learnerId: owner.learner.id, sessionId: owner.session.id };
        assert.deepEqual(await h.store.windowStatus(owner2, WINDOW), { used: 0, limit: 3 });

        await h.store.record(attempt(owner));

        assert.deepEqual(await h.store.windowStatus(owner2, WINDOW), { used: 1, limit: 3, resetsAt: h.now() + WINDOW.windowMs });
        assert.equal((await h.store.list(owner2)).length, 1);
      });

      test("each session has its own window", async () => {
        const h = await createHarness();
        const full = await newLearnerWithSession(h.store);
        const fresh = await newLearnerWithSession(h.store);
        for (let i = 0; i < 3; i++) await h.store.record(attempt(full));

        expectKind(await h.store.record(attempt(full)), "rate-limited");
        expectKind(await h.store.record(attempt(fresh)), "recorded");
      });
    });

    describe("ownership", () => {
      test("another learner cannot record into, list or inspect a session, and nothing changes", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const intruder = await newLearnerWithSession(h.store);
        const asIntruder = { learnerId: intruder.learner.id, sessionId: owner.session.id };

        await assert.rejects(h.store.record({ ...attempt(owner), learnerId: intruder.learner.id }), rejectsWith("not-owner"));
        await assert.rejects(h.store.list(asIntruder), rejectsWith("not-owner"));
        await assert.rejects(h.store.windowStatus(asIntruder, WINDOW), rejectsWith("not-owner"));

        const listed = await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id });
        assert.equal(listed.length, 0);
      });

      test("an unknown session is not found", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);

        await assert.rejects(h.store.record({ ...attempt(owner), sessionId: "no-such-session" }), rejectsWith("not-found"));
        await assert.rejects(h.store.list({ learnerId: owner.learner.id, sessionId: "no-such-session" }), rejectsWith("not-found"));
      });
    });

    describe("rejected input", () => {
      test("rejects malformed attempts and records nothing", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const bad: Array<Partial<RecordAttemptInput>> = [
          { submissionId: "" },
          { submissionId: "x".repeat(129) },
          { requestHash: "not a hash" },
          { requestHash: hashOf(255).toUpperCase() },
          { rootCauseId: "" },
          { outcome: "maybe" as never },
          { window: { limit: 0, windowMs: 1_000 } },
          { window: { limit: 3, windowMs: 0 } },
          { evidence: "log-01" as never },
        ];

        for (const overrides of bad) {
          await assert.rejects(h.store.record(attempt(owner, overrides)), rejectsWith("invalid-input"), JSON.stringify(overrides));
        }

        assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 0);
      });
    });

    describe("what is stored", () => {
      test("a record holds only what the learner submitted and what the server decided", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);

        const result = expectKind(await h.store.record(attempt(owner)), "recorded");

        assert.deepEqual(Object.keys(result.attempt).sort(), [
          "challengeId",
          "createdAt",
          "evidence",
          "explanation",
          "id",
          "outcome",
          "requestHash",
          "rootCauseId",
          "seq",
          "sessionId",
          "submissionId",
        ]);
      });

      test("changing a returned attempt, or the input afterwards, does not change what the store holds", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const evidence = [{ kind: "log" as const, logId: "log-01" }];
        const result = expectKind(await h.store.record(attempt(owner, { evidence })), "recorded");

        tryToMutate(result.attempt, { outcome: "correct", seq: 99, explanation: "tampered" });
        tryToMutate(result.attempt.evidence, { length: 0 });
        evidence.push({ kind: "log", logId: "log-99" });
        evidence[0].logId = "log-tampered";

        const [stored] = await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id });
        assert.equal(stored.outcome, "incorrect");
        assert.equal(stored.seq, 1);
        assert.notEqual(stored.explanation, "tampered");
        assert.deepEqual(stored.evidence, [{ kind: "log", logId: "log-01" }]);
      });
    });

    describe("concurrent operations", () => {
      test("many racing attempts each get their own sequence number", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const wide: AttemptWindow = { limit: 100, windowMs: WINDOW.windowMs };

        const results = await Promise.all(Array.from({ length: 20 }, () => h.store.record(attempt(owner, { window: wide }))));

        const seqs = results.map((result) => expectKind(result, "recorded").attempt.seq).sort((a, b) => a - b);
        assert.deepEqual(seqs, Array.from({ length: 20 }, (_, index) => index + 1));
        assert.equal((await h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE }))?.attemptCount, 20);
      });

      test("racing correct attempts complete the session exactly once", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);

        const results = await Promise.all(Array.from({ length: 6 }, () => h.store.record(attempt(owner, { outcome: "correct" }))));

        assert.equal(results.filter((result) => result.kind === "recorded").length, 1);
        assert.equal(results.filter((result) => result.kind === "already-completed").length, 5);
        const listed = await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id });
        assert.equal(listed.length, 1);
      });

      test("the same submission id racing is recorded once, and the rest are duplicates", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);
        const input = attempt(owner);

        const results = await Promise.all(Array.from({ length: 5 }, () => h.store.record(input)));

        assert.equal(results.filter((result) => result.kind === "recorded").length, 1);
        assert.equal(results.filter((result) => result.kind === "duplicate").length, 4);
      });

      test("racing incorrect attempts never exceed the window", async () => {
        const h = await createHarness();
        const owner = await newLearnerWithSession(h.store);

        const results = await Promise.all(Array.from({ length: 8 }, () => h.store.record(attempt(owner))));

        assert.equal(results.filter((result) => result.kind === "recorded").length, WINDOW.limit);
        assert.equal(results.filter((result) => result.kind === "rate-limited").length, 8 - WINDOW.limit);
        assert.equal((await h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE }))?.wrongAttempts, WINDOW.limit);
      });
    });
  });
}
