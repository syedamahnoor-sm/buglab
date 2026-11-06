/*
 * The contract every ChallengeSessionStore must satisfy: a learner's run at a
 * challenge, owned by exactly one learner, at most one per learner and challenge.
 * Written against the port only, so a durable store runs the same suite unchanged.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { issueSessionToken } from "@/server/session/token";
import { StoreError, type RecordAttemptInput } from "@/server/session/types";
import { RESULT } from "./attempt-contract";
import type { Store, StoreHarness } from "./store-contract";

const CHALLENGE_A = "challenge-001";
const CHALLENGE_B = "challenge-002";
const VERSION = "1";

async function newLearner(store: Store) {
  const { tokenHash } = issueSessionToken();
  return { tokenHash, learner: await store.create({ tokenHash }) };
}

function tryToMutate(value: object, changes: Record<string, unknown>) {
  try {
    Object.assign(value, changes);
  } catch {
    // A frozen copy rejects the write. Either outcome is fine: what matters is the store.
  }
}

const invalidInput = (error: unknown) => error instanceof StoreError && error.code === "invalid-input";

export function runChallengeSessionStoreContract(
  label: string,
  createHarness: () => StoreHarness | Promise<StoreHarness>,
): void {
  describe(`ChallengeSessionStore contract: ${label}`, () => {
    describe("starting and finding", () => {
      test("starts a session owned by the learner, with every counter at zero", async () => {
        const h = await createHarness();
        const { learner } = await newLearner(h.store);
        const started = h.now();

        const { session, created } = await h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });

        assert.equal(created, true);
        assert.equal(typeof session.id, "string");
        assert.ok(session.id.length > 0);
        assert.notEqual(session.id, learner.id);
        assert.equal(session.learnerId, learner.id);
        assert.equal(session.challengeId, CHALLENGE_A);
        assert.equal(session.challengeVersion, VERSION);
        assert.equal(session.status, "active");
        assert.equal(session.revision, 0);
        assert.equal(session.attemptCount, 0);
        assert.equal(session.wrongAttempts, 0);
        assert.equal(session.createdAt, started);
        assert.equal(session.updatedAt, started);
        assert.ok(!("completedAt" in session), "an active session has no completion time");
      });

      test("starting again resumes the same session, unchanged", async () => {
        const h = await createHarness();
        const { learner } = await newLearner(h.store);
        const first = await h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });
        await h.advance(h.policy.touchIntervalMs);

        const second = await h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: "2" });

        assert.equal(second.created, false);
        assert.deepEqual(second.session, first.session);
        assert.equal(second.session.challengeVersion, VERSION, "the version recorded at the start is kept");
      });

      test("finds the learner's session as an equal but separate copy, and null when there is none", async () => {
        const h = await createHarness();
        const { learner } = await newLearner(h.store);
        assert.equal(await h.store.find({ learnerId: learner.id, challengeId: CHALLENGE_A }), null);

        const { session } = await h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });
        const found = await h.store.find({ learnerId: learner.id, challengeId: CHALLENGE_A });

        assert.deepEqual(found, session);
        assert.notEqual(found, session, "each call returns its own copy");
        assert.equal(await h.store.find({ learnerId: learner.id, challengeId: CHALLENGE_B }), null);
      });
    });

    describe("one learner, many challenges", () => {
      test("the same learner has a separate session for each challenge", async () => {
        const h = await createHarness();
        const { learner } = await newLearner(h.store);

        const a = await h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });
        const b = await h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_B, challengeVersion: "7" });

        assert.equal(a.created && b.created, true);
        assert.notEqual(a.session.id, b.session.id);
        assert.equal(a.session.learnerId, b.session.learnerId);
        assert.deepEqual(await h.store.find({ learnerId: learner.id, challengeId: CHALLENGE_A }), a.session);
        assert.deepEqual(await h.store.find({ learnerId: learner.id, challengeId: CHALLENGE_B }), b.session);
        assert.equal(b.session.challengeVersion, "7");
      });
    });

    describe("listing current completed sessions", () => {
      const WINDOW = { limit: 3, windowMs: 600_000 };
      let counter = 0;
      const correct = (learnerId: string, sessionId: string): RecordAttemptInput => {
        counter += 1;
        return {
          learnerId,
          sessionId,
          submissionId: `completed-${counter}`,
          requestHash: counter.toString(16).padStart(64, "0"),
          rootCauseId: "option-a",
          explanation: "An explanation of what the learner believes is happening.",
          evidence: [{ kind: "log", logId: "log-01" }],
          outcome: "correct",
          result: RESULT,
          window: WINDOW,
        };
      };
      const complete = async (h: StoreHarness, learnerId: string, challengeId: string) => {
        const { session } = await h.store.start({ learnerId, challengeId, challengeVersion: VERSION });
        await h.store.record(correct(learnerId, session.id));
        return session.id;
      };

      test("returns only this learner's completed current sessions, newest completion first; unfinished ones and others' are left out", async () => {
        const h = await createHarness();
        const { learner } = await newLearner(h.store);
        const { learner: other } = await newLearner(h.store);
        assert.deepEqual(await h.store.listCurrentCompleted(learner.id), []);
        assert.deepEqual(await h.store.listCurrentCompleted("no-such-learner"), []);

        const first = await complete(h, learner.id, CHALLENGE_A);
        await h.advance(1000);
        const second = await complete(h, learner.id, CHALLENGE_B);
        await h.store.start({ learnerId: learner.id, challengeId: "challenge-003", challengeVersion: VERSION });
        await complete(h, other.id, CHALLENGE_A);

        const listed = await h.store.listCurrentCompleted(learner.id);
        assert.deepEqual(listed.map((s) => s.id), [second, first]);
        for (const session of listed) {
          assert.equal(session.learnerId, learner.id);
          assert.equal(session.status, "completed");
          assert.equal(typeof session.completedAt, "number");
          assert.ok(session.result);
        }
        assert.deepEqual(listed[1], await h.store.find({ learnerId: learner.id, challengeId: CHALLENGE_A }));
      });

      test("a superseded unfinished session never appears, and the result is a separate copy", async () => {
        const h = await createHarness();
        const { learner } = await newLearner(h.store);
        const { session } = await h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });
        await h.store.restart({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: "2", supersedes: session.id });
        assert.deepEqual(await h.store.listCurrentCompleted(learner.id), []);

        await complete(h, learner.id, CHALLENGE_B);
        const listed = await h.store.listCurrentCompleted(learner.id);
        assert.equal(listed.length, 1);
        tryToMutate(listed[0]!, { status: "active" });
        assert.equal((await h.store.listCurrentCompleted(learner.id))[0]!.status, "completed");
      });

      test("rejects an empty learner id", async () => {
        const h = await createHarness();
        await assert.rejects(h.store.listCurrentCompleted(""), invalidInput);
      });
    });

    describe("ownership and isolation", () => {
      test("two learners never share a session for the same challenge", async () => {
        const h = await createHarness();
        const one = await newLearner(h.store);
        const two = await newLearner(h.store);

        const first = await h.store.start({ learnerId: one.learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });
        const second = await h.store.start({ learnerId: two.learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });

        assert.equal(second.created, true);
        assert.notEqual(first.session.id, second.session.id);
        assert.equal(first.session.learnerId, one.learner.id);
        assert.equal(second.session.learnerId, two.learner.id);
      });

      test("a learner cannot find another learner's session, whatever the challenge", async () => {
        const h = await createHarness();
        const one = await newLearner(h.store);
        const two = await newLearner(h.store);
        await h.store.start({ learnerId: one.learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });

        assert.equal(await h.store.find({ learnerId: two.learner.id, challengeId: CHALLENGE_A }), null);
      });

      test("starting a session for a learner that does not exist is refused, and creates nothing", async () => {
        const h = await createHarness();

        await assert.rejects(
          h.store.start({ learnerId: "no-such-learner", challengeId: CHALLENGE_A, challengeVersion: VERSION }),
          (error: unknown) => error instanceof StoreError && error.code === "not-found",
        );
        assert.equal(await h.store.find({ learnerId: "no-such-learner", challengeId: CHALLENGE_A }), null);
      });
    });

    describe("rejected input", () => {
      test("rejects an empty learner id, challenge id or version, and stores nothing", async () => {
        const h = await createHarness();
        const { learner } = await newLearner(h.store);

        await assert.rejects(h.store.start({ learnerId: "", challengeId: CHALLENGE_A, challengeVersion: VERSION }), invalidInput);
        await assert.rejects(h.store.start({ learnerId: learner.id, challengeId: "", challengeVersion: VERSION }), invalidInput);
        await assert.rejects(h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: "" }), invalidInput);
        await assert.rejects(h.store.find({ learnerId: "", challengeId: CHALLENGE_A }), invalidInput);
        await assert.rejects(h.store.find({ learnerId: learner.id, challengeId: "" }), invalidInput);
        assert.equal(await h.store.find({ learnerId: learner.id, challengeId: CHALLENGE_A }), null);
      });
    });

    describe("defensive copies", () => {
      test("changing a returned session does not change what the store holds", async () => {
        const h = await createHarness();
        const { learner } = await newLearner(h.store);
        const { session } = await h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });

        tryToMutate(session, { status: "completed", wrongAttempts: 99, learnerId: "someone-else", revision: 99 });
        const found = await h.store.find({ learnerId: learner.id, challengeId: CHALLENGE_A });
        assert.ok(found);
        tryToMutate(found, { status: "completed", attemptCount: 99 });

        const after = await h.store.find({ learnerId: learner.id, challengeId: CHALLENGE_A });
        assert.equal(after?.status, "active");
        assert.equal(after?.wrongAttempts, 0);
        assert.equal(after?.attemptCount, 0);
        assert.equal(after?.learnerId, learner.id);
        assert.equal(after?.revision, 0);
      });
    });

    describe("a learner's data goes with the learner", () => {
      test("purging an expired learner removes its sessions and attempts, and nobody else's", async () => {
        const h = await createHarness();
        const gone = await newLearner(h.store);
        const { session } = await h.store.start({ learnerId: gone.learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });
        // One millisecond before the first learner is purgeable, a second learner begins.
        await h.advance(h.policy.idleTtlMs + h.policy.purgeGraceMs - 1);
        const kept = await newLearner(h.store);
        await h.store.start({ learnerId: kept.learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION });
        await h.advance(1);

        const removed = await h.store.purgeExpired();

        assert.equal(removed, 1);
        assert.equal(await h.store.find({ learnerId: gone.learner.id, challengeId: CHALLENGE_A }), null);
        await assert.rejects(
          h.store.list({ learnerId: gone.learner.id, sessionId: session.id }),
          (error: unknown) => error instanceof StoreError && error.code === "not-found",
        );
        assert.ok(await h.store.find({ learnerId: kept.learner.id, challengeId: CHALLENGE_A }), "a live learner keeps its session");
      });
    });

    describe("concurrent operations", () => {
      test("racing starts for the same learner and challenge produce exactly one session", async () => {
        const h = await createHarness();
        const { learner } = await newLearner(h.store);

        const results = await Promise.all(
          Array.from({ length: 10 }, () =>
            h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: VERSION }),
          ),
        );

        assert.equal(results.filter((result) => result.created).length, 1);
        assert.equal(new Set(results.map((result) => result.session.id)).size, 1);
      });
    });

    describe("restarting an unfinished session at a new content version", () => {
      const V1 = "1+aaaaaaaaaaaa";
      const V2 = "1+bbbbbbbbbbbb";
      const WINDOW = { limit: 3, windowMs: 600_000 };
      let counter = 0;

      async function begin(h: StoreHarness) {
        const { learner } = await newLearner(h.store);
        const { session } = await h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_A, challengeVersion: V1 });
        return { learner, session, owner: { learnerId: learner.id, challengeId: CHALLENGE_A } };
      }
      const attempt = (learnerId: string, sessionId: string, outcome: "correct" | "incorrect"): RecordAttemptInput => {
        counter += 1;
        return {
          learnerId,
          sessionId,
          submissionId: `restart-${counter}`,
          requestHash: counter.toString(16).padStart(64, "0"),
          rootCauseId: "option-a",
          explanation: "An explanation of what the learner believes is happening.",
          evidence: [{ kind: "log", logId: "log-01" }],
          outcome,
          ...(outcome === "correct" ? { result: RESULT } : {}),
          window: WINDOW,
        };
      };

      test("replaces it with a fresh session at the new version, and find() returns only the new one", async () => {
        const h = await createHarness();
        const { learner, session, owner } = await begin(h);
        await h.advance(1000);

        const outcome = await h.store.restart({ ...owner, challengeVersion: V2, supersedes: session.id });

        assert.equal(outcome.restarted, true);
        assert.notEqual(outcome.session.id, session.id);
        assert.equal(outcome.session.learnerId, learner.id);
        assert.equal(outcome.session.challengeId, CHALLENGE_A);
        assert.equal(outcome.session.challengeVersion, V2);
        assert.equal(outcome.session.status, "active");
        assert.equal(outcome.session.attemptCount, 0);
        assert.equal(outcome.session.wrongAttempts, 0);
        assert.equal(outcome.session.revision, 0);
        assert.equal(outcome.session.createdAt, h.now());
        assert.ok(!("completedAt" in outcome.session) && !("result" in outcome.session) && !("supersededAt" in outcome.session));
        assert.deepEqual(await h.store.find(owner), outcome.session);
        const resumed = await h.store.start({ ...owner, challengeVersion: V2 });
        assert.equal(resumed.created, false, "starting again resumes the replacement");
        assert.equal(resumed.session.id, outcome.session.id);
      });

      test("the superseded session is kept as history: its attempts can be listed, but it accepts no more and is never found", async () => {
        const h = await createHarness();
        const { learner, session, owner } = await begin(h);
        await h.store.record(attempt(learner.id, session.id, "incorrect"));

        await h.store.restart({ ...owner, challengeVersion: V2, supersedes: session.id });

        const history = await h.store.list({ learnerId: learner.id, sessionId: session.id });
        assert.equal(history.length, 1, "the old attempt is still there");
        assert.equal((await h.store.windowStatus({ learnerId: learner.id, sessionId: session.id }, WINDOW)).used, 1);
        await assert.rejects(
          h.store.record(attempt(learner.id, session.id, "incorrect")),
          (error: unknown) => error instanceof StoreError && error.code === "superseded",
        );
        assert.equal((await h.store.list({ learnerId: learner.id, sessionId: session.id })).length, 1, "nothing was recorded");
        assert.notEqual((await h.store.find(owner))?.id, session.id);
      });

      test("the new session has its own empty attempt history and window", async () => {
        const h = await createHarness();
        const { learner, session, owner } = await begin(h);
        for (let i = 0; i < 3; i += 1) await h.store.record(attempt(learner.id, session.id, "incorrect"));
        assert.equal((await h.store.windowStatus({ learnerId: learner.id, sessionId: session.id }, WINDOW)).used, 3);

        const { session: fresh } = await h.store.restart({ ...owner, challengeVersion: V2, supersedes: session.id });

        assert.deepEqual(await h.store.list({ learnerId: learner.id, sessionId: fresh.id }), []);
        assert.equal((await h.store.windowStatus({ learnerId: learner.id, sessionId: fresh.id }, WINDOW)).used, 0);
        const recorded = await h.store.record(attempt(learner.id, fresh.id, "incorrect"));
        assert.equal(recorded.kind, "recorded");
      });

      test("a completed session is never restarted: its result, completion time and version are kept", async () => {
        const h = await createHarness();
        const { learner, session, owner } = await begin(h);
        await h.store.record(attempt(learner.id, session.id, "correct"));
        const completed = await h.store.find(owner);
        assert.equal(completed?.status, "completed");

        const outcome = await h.store.restart({ ...owner, challengeVersion: V2, supersedes: session.id });

        assert.equal(outcome.restarted, false);
        assert.deepEqual(outcome.session, completed);
        assert.equal(outcome.session.challengeVersion, V1);
        assert.deepEqual(await h.store.find(owner), completed);
      });

      test("only the session it names is replaced: a stale name changes nothing and returns the current session", async () => {
        const h = await createHarness();
        const { session, owner } = await begin(h);
        const first = await h.store.restart({ ...owner, challengeVersion: V2, supersedes: session.id });
        assert.equal(first.restarted, true);

        const second = await h.store.restart({ ...owner, challengeVersion: "1+cccccccccccc", supersedes: session.id });

        assert.equal(second.restarted, false);
        assert.deepEqual(second.session, first.session, "the newer session is untouched, whatever version was asked for");
        assert.deepEqual(await h.store.find(owner), first.session);
      });

      test("a session already at the requested version is left alone", async () => {
        const h = await createHarness();
        const { session, owner } = await begin(h);

        const outcome = await h.store.restart({ ...owner, challengeVersion: V1, supersedes: session.id });

        assert.equal(outcome.restarted, false);
        assert.deepEqual(outcome.session, session);
      });

      test("it can name only the session of the learner and challenge it is called for", async () => {
        const h = await createHarness();
        const one = await begin(h);
        const two = await begin(h);

        // Learner two names learner one's session: two's own session is not that one, so nothing happens.
        const outcome = await h.store.restart({ ...two.owner, challengeVersion: V2, supersedes: one.session.id });

        assert.equal(outcome.restarted, false);
        assert.equal(outcome.session.id, two.session.id);
        assert.equal((await h.store.find(one.owner))?.id, one.session.id, "learner one is untouched");
        assert.equal((await h.store.find(two.owner))?.id, two.session.id);
      });

      test("another challenge of the same learner is untouched", async () => {
        const h = await createHarness();
        const { learner, session, owner } = await begin(h);
        const other = await h.store.start({ learnerId: learner.id, challengeId: CHALLENGE_B, challengeVersion: V1 });

        await h.store.restart({ ...owner, challengeVersion: V2, supersedes: session.id });

        assert.deepEqual(await h.store.find({ learnerId: learner.id, challengeId: CHALLENGE_B }), other.session);
      });

      test("is refused when there is no session or no learner, and when the input is malformed", async () => {
        const h = await createHarness();
        const { learner, session, owner } = await begin(h);
        const notFound = (error: unknown) => error instanceof StoreError && error.code === "not-found";

        await assert.rejects(h.store.restart({ learnerId: learner.id, challengeId: CHALLENGE_B, challengeVersion: V2, supersedes: session.id }), notFound);
        await assert.rejects(h.store.restart({ learnerId: "no-such-learner", challengeId: CHALLENGE_A, challengeVersion: V2, supersedes: session.id }), notFound);
        for (const bad of [{ learnerId: "" }, { challengeId: "" }, { challengeVersion: "" }, { supersedes: "" }]) {
          await assert.rejects(h.store.restart({ ...owner, challengeVersion: V2, supersedes: session.id, ...bad }), invalidInput);
        }
        assert.deepEqual(await h.store.find(owner), session, "nothing changed");
      });

      test("racing restarts of the same stale session produce exactly one new session", async () => {
        const h = await createHarness();
        const { session, owner } = await begin(h);

        const results = await Promise.all(
          Array.from({ length: 10 }, () => h.store.restart({ ...owner, challengeVersion: V2, supersedes: session.id })),
        );

        assert.equal(results.filter((result) => result.restarted).length, 1);
        assert.equal(new Set(results.map((result) => result.session.id)).size, 1);
        assert.notEqual(results[0].session.id, session.id);
      });

      test("a purged learner's superseded sessions go too", async () => {
        const h = await createHarness();
        const { learner, session, owner } = await begin(h);
        await h.store.record(attempt(learner.id, session.id, "incorrect"));
        await h.store.restart({ ...owner, challengeVersion: V2, supersedes: session.id });
        await h.advance(h.policy.absoluteTtlMs + h.policy.purgeGraceMs);

        assert.equal(await h.store.purgeExpired(), 1);

        await assert.rejects(
          h.store.list({ learnerId: learner.id, sessionId: session.id }),
          (error: unknown) => error instanceof StoreError && error.code === "not-found",
        );
      });
    });
  });
}
