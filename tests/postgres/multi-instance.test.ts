/*
 * Two or more INDEPENDENT store instances sharing one real PostgreSQL database. Each instance has its own
 * connection pool, so it is a separate client of the database, exactly as two application instances are. Every
 * concurrency claim in the documentation is exercised here with real simultaneous requests, not mocks.
 *
 * These tests run on the database's own clock (no override), as production does.
 *
 * ABOUT THE RACES. See concurrency.ts: every race here starts from warmed pools and goes through `stampede`, so a
 * missing or weakened lock breaks the assertions every time instead of only on an unlucky schedule.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import type { Pool } from "pg";
import { DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import { issueSessionToken } from "@/server/session/token";
import { StoreError, type RecordAttemptInput, type RecordAttemptResult } from "@/server/session/types";
import { RESULT } from "../session/attempt-contract";
import { fulfilled, stampede, warm } from "./concurrency";
import { SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const fixture = pgFixture();
const WINDOW = { limit: 3, windowMs: 600_000 };
const CHALLENGE = "challenge-001";
const LOCK_SESSION = "SELECT 1 FROM challenge_sessions WHERE id = $1 FOR UPDATE";
const LOCK_LEARNER = "SELECT 1 FROM learners WHERE token_hash = $1 FOR UPDATE";

let counter = 0;
const hash = () => (++counter).toString(16).padStart(64, "0");

/** The pools of the "instances" a test made, closed after it so a long run never exhausts the server's connections. */
const instancePools: Pool[] = [];
afterEach(async () => {
  await Promise.all(instancePools.splice(0).filter((pool) => !pool.ended).map((pool) => pool.end()));
});

/** Two stores, two warmed pools: two application instances. */
async function twoInstances() {
  const pg = await fixture();
  await pg.reset();
  const poolA = pg.newPool(10);
  const poolB = pg.newPool(10);
  instancePools.push(poolA, poolB);
  await Promise.all([warm(poolA), warm(poolB)]);
  const a = pg.newStore({}, poolA);
  const b = pg.newStore({}, poolB);
  return { pg, a, b, both: [a, b] as const, pools: [poolA, poolB] as const };
}

type Store = ReturnType<Awaited<ReturnType<typeof fixture>>["newStore"]>;

async function learnerAndSession(store: Store) {
  const learner = await store.create({ tokenHash: issueSessionToken().tokenHash });
  const { session } = await store.start({ learnerId: learner.id, challengeId: CHALLENGE, challengeVersion: "v1" });
  return { learner, session };
}

const attemptInput = (learnerId: string, sessionId: string, id: string, outcome: "correct" | "incorrect"): RecordAttemptInput => ({
  learnerId,
  sessionId,
  submissionId: id,
  requestHash: hash(),
  rootCauseId: "option-a",
  explanation: "An explanation.",
  evidence: [{ kind: "log", logId: "log-01" }],
  outcome,
  ...(outcome === "correct" ? { result: RESULT } : {}),
  window: WINDOW,
});

const count = (results: RecordAttemptResult[], kind: string) => results.filter((r) => r.kind === kind).length;

describe("two store instances, one database", { skip: SKIP }, () => {
  describe("shared state", () => {
    test("what one instance writes the other reads, at every level", async () => {
      const { a, b } = await twoInstances();
      const { tokenHash } = issueSessionToken();

      const learner = await a.create({ tokenHash });
      const seenByB = await b.findByTokenHash(tokenHash);
      assert.ok(seenByB.state === "active");
      assert.equal(seenByB.learner.id, learner.id);

      const { session } = await b.start({ learnerId: learner.id, challengeId: CHALLENGE, challengeVersion: "v1" });
      assert.equal((await a.find({ learnerId: learner.id, challengeId: CHALLENGE }))?.id, session.id);

      const recorded = await a.record(attemptInput(learner.id, session.id, "s-1", "incorrect"));
      assert.equal(recorded.kind, "recorded");
      const listed = await b.list({ learnerId: learner.id, sessionId: session.id });
      assert.deepEqual(listed.map((attempt) => attempt.submissionId), ["s-1"]);
      assert.equal((await b.windowStatus({ learnerId: learner.id, sessionId: session.id }, WINDOW)).used, 1);

      const completed = await b.record(attemptInput(learner.id, session.id, "s-2", "correct"));
      assert.equal(completed.kind, "recorded");
      const final = await a.find({ learnerId: learner.id, challengeId: CHALLENGE });
      assert.equal(final?.status, "completed");
      assert.deepEqual(final?.result, RESULT, "the completion result is stored and the other instance reads it back exactly");
    });

    test("one instance's touch is the other's idle expiry", async () => {
      const { a, b } = await twoInstances();
      const { tokenHash } = issueSessionToken();
      const created = await a.create({ tokenHash });

      const touched = await b.touch(tokenHash, "write");
      assert.ok(touched.state === "active" && touched.refreshed);
      const seen = await a.findByTokenHash(tokenHash);
      assert.ok(seen.state === "active");
      assert.equal(seen.learner.revision, created.revision + 1);
      assert.equal(seen.learner.idleExpiresAt, touched.learner.idleExpiresAt);
    });
  });

  describe("concurrent learner creation", () => {
    test("twenty simultaneous creations of one token hash, from two instances: exactly one wins", async () => {
      const { pg, both, pools } = await twoInstances();
      const { tokenHash } = issueSessionToken();

      // Everyone is released at once by an exclusive table lock, so all twenty INSERTs really collide.
      const outcomes = await stampede(pools[0], "LOCK TABLE learners IN SHARE ROW EXCLUSIVE MODE", [], () =>
        Array.from({ length: 20 }, (_, i) => both[i % 2].create({ tokenHash })),
      );

      const won = outcomes.filter((o) => o.status === "fulfilled");
      const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
      assert.equal(won.length, 1);
      assert.equal(lost.length, 19);
      assert.ok(
        lost.every((o) => o.reason instanceof StoreError && o.reason.code === "duplicate-token"),
        "every loser got the contract's error, not a raw database error",
      );
      const rows = await pg.query("SELECT count(*)::int AS n FROM learners");
      assert.equal(rows.rows[0].n, 1);
    });

    test("a hundred simultaneous creations of different learners all succeed with distinct ids", async () => {
      const { pg, both } = await twoInstances();
      const learners = await Promise.all(Array.from({ length: 100 }, (_, i) => both[i % 2].create({ tokenHash: issueSessionToken().tokenHash })));

      assert.equal(new Set(learners.map((l) => l.id)).size, 100);
      const rows = await pg.query("SELECT count(*)::int AS n FROM learners");
      assert.equal(rows.rows[0].n, 100);
    });
  });

  describe("concurrent session updates", () => {
    test("racing starts for one learner and challenge, from two instances, produce one session", async () => {
      const { pg, both, pools } = await twoInstances();
      const learner = await both[0].create({ tokenHash: issueSessionToken().tokenHash });

      const results = fulfilled(
        await stampede(pools[0], "LOCK TABLE challenge_sessions IN SHARE ROW EXCLUSIVE MODE", [], () =>
          Array.from({ length: 20 }, (_, i) => both[i % 2].start({ learnerId: learner.id, challengeId: CHALLENGE, challengeVersion: "v1" })),
        ),
      );

      assert.equal(results.filter((r) => r.created).length, 1, "exactly one created it");
      assert.equal(new Set(results.map((r) => r.session.id)).size, 1, "everyone got the same session");
      const rows = await pg.query("SELECT count(*)::int AS n FROM challenge_sessions");
      assert.equal(rows.rows[0].n, 1);
    });

    test("racing restarts of one stale session produce exactly one replacement", async () => {
      const { pg, both, pools } = await twoInstances();
      const { learner, session } = await learnerAndSession(both[0]);

      const results = fulfilled(
        await stampede(pools[0], LOCK_SESSION, [session.id], () =>
          Array.from({ length: 20 }, (_, i) =>
            both[i % 2].restart({ learnerId: learner.id, challengeId: CHALLENGE, challengeVersion: "v2", supersedes: session.id }),
          ),
        ),
      );

      assert.equal(results.filter((r) => r.restarted).length, 1);
      assert.equal(new Set(results.map((r) => r.session.id)).size, 1, "all of them end up on the one new session");
      const rows = await pg.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE superseded_at IS NULL)::int AS current FROM challenge_sessions");
      assert.deepEqual({ ...rows.rows[0] }, { n: 2, current: 1 }, "the old session is kept as history and exactly one is current");
    });

    test("ten simultaneous different incorrect attempts against a window of three: exactly three are recorded", async () => {
      const { pg, both, pools } = await twoInstances();
      const { learner, session } = await learnerAndSession(both[0]);

      const results = fulfilled(
        await stampede(pools[0], LOCK_SESSION, [session.id], () =>
          Array.from({ length: 10 }, (_, i) => both[i % 2].record(attemptInput(learner.id, session.id, `s-${i}`, "incorrect"))),
        ),
      );

      assert.equal(count(results, "recorded"), 3);
      assert.equal(count(results, "rate-limited"), 7);
      const rows = await pg.query("SELECT seq FROM diagnosis_attempts WHERE session_id = $1 ORDER BY seq", [session.id]);
      assert.deepEqual(rows.rows.map((r) => r.seq), [1, 2, 3], "sequence numbers are contiguous: no gaps, no repeats");
      const stored = await both[1].find({ learnerId: learner.id, challengeId: CHALLENGE });
      assert.equal(stored?.attemptCount, 3);
      assert.equal(stored?.wrongAttempts, 3);
      assert.equal(stored?.revision, 3, "one revision per recorded attempt, none lost");
    });

    test("the same submission sent twenty times at once is recorded once and replayed nineteen times", async () => {
      const { pg, both, pools } = await twoInstances();
      const { learner, session } = await learnerAndSession(both[0]);
      const input = attemptInput(learner.id, session.id, "same-key", "incorrect");

      const results = fulfilled(
        await stampede(pools[0], LOCK_SESSION, [session.id], () => Array.from({ length: 20 }, (_, i) => both[i % 2].record(input))),
      );

      assert.equal(count(results, "recorded"), 1);
      assert.equal(count(results, "duplicate"), 19);
      const rows = await pg.query("SELECT count(*)::int AS n FROM diagnosis_attempts");
      assert.equal(rows.rows[0].n, 1);
    });

    test("the same key with different content, racing, is one recorded and the rest conflict", async () => {
      const { both, pools } = await twoInstances();
      const { learner, session } = await learnerAndSession(both[0]);

      const results = fulfilled(
        await stampede(pools[0], LOCK_SESSION, [session.id], () =>
          Array.from({ length: 10 }, (_, i) => both[i % 2].record({ ...attemptInput(learner.id, session.id, "same-key", "incorrect"), requestHash: hash() })),
        ),
      );

      assert.equal(count(results, "recorded"), 1);
      assert.equal(count(results, "conflict"), 9, "a reused id with different content is never silently accepted");
    });

    test("five different correct answers racing to complete: one completes the session, the rest see it already completed", async () => {
      const { pg, both, pools } = await twoInstances();
      const { learner, session } = await learnerAndSession(both[0]);

      const results = fulfilled(
        await stampede(pools[0], LOCK_SESSION, [session.id], () =>
          Array.from({ length: 5 }, (_, i) => both[i % 2].record(attemptInput(learner.id, session.id, `win-${i}`, "correct"))),
        ),
      );

      assert.equal(count(results, "recorded"), 1);
      assert.equal(count(results, "already-completed"), 4);
      const winner = results.find((r) => r.kind === "recorded") as { attempt: { submissionId: string } };
      for (const r of results) {
        if (r.kind === "already-completed") assert.equal(r.attempt.submissionId, winner.attempt.submissionId, "everyone is told about the same winning attempt");
      }
      const rows = await pg.query("SELECT count(*)::int AS n FROM diagnosis_attempts WHERE outcome = 'correct'");
      assert.equal(rows.rows[0].n, 1, "one correct attempt in the database");
      const stored = await both[0].find({ learnerId: learner.id, challengeId: CHALLENGE });
      assert.equal(stored?.status, "completed");
      assert.deepEqual(stored?.result, RESULT);
    });

    test("a restart racing an attempt: the attempt lands on the session it named, or is refused as superseded, never lost silently or on the wrong session", async () => {
      const { pg, both, pools } = await twoInstances();
      const { learner, session } = await learnerAndSession(both[0]);

      const [restart, attempt] = await stampede(pools[0], LOCK_SESSION, [session.id], () => [
        both[0].restart({ learnerId: learner.id, challengeId: CHALLENGE, challengeVersion: "v2", supersedes: session.id }),
        both[1].record(attemptInput(learner.id, session.id, "racer", "incorrect")),
      ] as Promise<unknown>[]);

      assert.equal(restart.status, "fulfilled");
      if (attempt.status === "fulfilled") {
        assert.equal((attempt.value as RecordAttemptResult).kind, "recorded");
        const rows = await pg.query("SELECT session_id FROM diagnosis_attempts");
        assert.deepEqual(rows.rows.map((r) => r.session_id), [session.id], "it landed on the old session, now history");
      } else {
        assert.ok(attempt.reason instanceof StoreError && attempt.reason.code === "superseded");
      }
      const current = await both[0].find({ learnerId: learner.id, challengeId: CHALLENGE });
      assert.notEqual(current?.id, session.id);
      assert.equal(current?.attemptCount, 0, "the new session starts clean");
    });

    test("twenty simultaneous write touches from two instances each advance the revision: no lost updates", async () => {
      const { both, pools } = await twoInstances();
      const { tokenHash } = issueSessionToken();
      const created = await both[0].create({ tokenHash });

      const results = fulfilled(
        await stampede(pools[0], LOCK_LEARNER, [tokenHash], () => Array.from({ length: 20 }, (_, i) => both[i % 2].touch(tokenHash, "write"))),
      );

      assert.ok(results.every((r) => r.state === "active" && r.refreshed));
      const final = await both[1].findByTokenHash(tokenHash);
      assert.ok(final.state === "active");
      assert.equal(final.learner.revision, created.revision + 20);
    });

    test("simultaneous READ touches refresh at most once per touch interval, across instances", async () => {
      const { pg, both, pools } = await twoInstances();
      const { tokenHash } = issueSessionToken();
      await both[0].create({ tokenHash });
      // Make the learner look untouched for longer than the interval, so exactly one read should refresh it.
      await pg.query("UPDATE learners SET last_touched_at = last_touched_at - $1::bigint", [DEFAULT_EXPIRY_POLICY.touchIntervalMs + 1000]);

      const results = fulfilled(
        await stampede(pools[0], LOCK_LEARNER, [tokenHash], () => Array.from({ length: 20 }, (_, i) => both[i % 2].touch(tokenHash, "read"))),
      );

      assert.equal(results.filter((r) => r.state === "active" && r.refreshed).length, 1, "the second and later reads saw the first one's refresh");
    });
  });

  describe("isolation", () => {
    test("one learner's identifiers never reach another learner's data, across instances", async () => {
      const { a, b } = await twoInstances();
      const alice = await learnerAndSession(a);
      const bob = await learnerAndSession(b);

      await assert.rejects(b.list({ learnerId: bob.learner.id, sessionId: alice.session.id }), (e: StoreError) => e.code === "not-owner");
      await assert.rejects(a.record(attemptInput(alice.learner.id, bob.session.id, "x", "incorrect")), (e: StoreError) => e.code === "not-owner");
      assert.notEqual(alice.session.id, bob.session.id);
    });
  });

  describe("purging across instances", () => {
    test("two instances purging at once split the work: every expired learner is deleted once, with everything that belongs to it, and nobody else is touched", async () => {
      const { pg, both } = await twoInstances();
      const pool = pg;
      const alive = await learnerAndSession(both[0]);
      const doomed = await learnerAndSession(both[0]);
      await both[0].record(attemptInput(doomed.learner.id, doomed.session.id, "gone", "incorrect"));
      // 1,200 learners expired long ago (more than two purge batches), the one with data included.
      await pool.query(
        `INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at)
         SELECT 'bulk-' || n, lpad(to_hex(n + 1000000), 64, '0'), 1, 1, 1, 2, 3 FROM generate_series(1, 1200) AS n`,
      );
      await pool.query("UPDATE learners SET idle_expires_at = 2, absolute_expires_at = 3 WHERE id = $1", [doomed.learner.id]);

      const [first, second] = await Promise.all([both[0].purgeExpired(), both[1].purgeExpired()]);

      assert.equal(first + second, 1201, "no learner is counted twice and none is missed");
      const left = await pool.query("SELECT id FROM learners");
      assert.deepEqual(left.rows.map((r) => r.id), [alive.learner.id]);
      const children = await pool.query("SELECT (SELECT count(*)::int FROM challenge_sessions) AS sessions, (SELECT count(*)::int FROM diagnosis_attempts) AS attempts");
      assert.deepEqual({ ...children.rows[0] }, { sessions: 1, attempts: 0 }, "the purged learner's session and attempt went with it; the live learner's session stayed");
    });

    test("a learner past its grace period is `none` before any purge runs, and `expired` just inside it", async () => {
      const { pg, a } = await twoInstances();
      const pool = pg;
      const inGrace = issueSessionToken().tokenHash;
      const pastGrace = issueSessionToken().tokenHash;
      await a.create({ tokenHash: inGrace });
      await a.create({ tokenHash: pastGrace });
      const { rows } = await pool.query("SELECT (floor(extract(epoch from clock_timestamp()) * 1000))::bigint AS now");
      const now = Number(rows[0].now);
      const set = (tokenHash: string, expiredAgo: number) =>
        pool.query("UPDATE learners SET idle_expires_at = $2::bigint, absolute_expires_at = $2::bigint WHERE token_hash = $1", [tokenHash, now - expiredAgo]);
      await set(inGrace, DEFAULT_EXPIRY_POLICY.purgeGraceMs - 60_000);
      await set(pastGrace, DEFAULT_EXPIRY_POLICY.purgeGraceMs + 60_000);

      assert.equal((await a.findByTokenHash(inGrace)).state, "expired");
      assert.equal((await a.findByTokenHash(pastGrace)).state, "none", "treated as missing although its row is still there");
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM learners WHERE token_hash = $1", [pastGrace])).rows[0].n, 1);
      assert.equal((await a.touch(pastGrace, "write")).state, "none", "and it cannot be revived");
    });
  });
});
