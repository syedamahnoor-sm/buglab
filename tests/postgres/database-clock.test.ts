/*
 * Expiry on the DATABASE's own clock, in real time. The contract suites move a fake clock; these tests do not.
 * They use real, very short lifetimes and real waits, with no clock override, to show that:
 *
 *   - the time written and compared is the database's, and the application's clock cannot change it,
 *   - idle expiry, the grace period and purging all happen when the policy says, with no purge having run.
 *
 * Margins are deliberately generous (hundreds of milliseconds) so a slow machine does not make them flaky.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createExpiryPolicy } from "@/server/session/expiry";
import { issueSessionToken } from "@/server/session/token";
import { SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const fixture = pgFixture();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Idle 800 ms, absolute 5 s, grace 600 ms: an idle learner is expired at 0.8 s and gone at 1.4 s.
const POLICY = createExpiryPolicy({ idleTtlMs: 800, absoluteTtlMs: 5_000, touchIntervalMs: 100, purgeGraceMs: 600 });
const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;
});

async function databaseNow(pg: Awaited<ReturnType<typeof fixture>>) {
  const { rows } = await pg.query<{ now: string }>("SELECT (floor(extract(epoch from clock_timestamp()) * 1000))::bigint AS now");
  return Number(rows[0].now);
}

describe("the database's own clock", { skip: SKIP }, () => {
  test("times are written from the database's clock, whatever the application's clock says", async () => {
    const pg = await fixture();
    await pg.reset();
    const store = pg.newStore({ policy: POLICY });

    Date.now = () => realNow() + 10 * 365 * 24 * 3_600_000; // an application ten years in the future
    const learner = await store.create({ tokenHash: issueSessionToken().tokenHash });
    Date.now = realNow;

    const now = await databaseNow(pg);
    assert.ok(Math.abs(learner.createdAt - now) < 5_000, `created at the database's time, not the application's: ${learner.createdAt} vs ${now}`);
    assert.equal(learner.idleExpiresAt - learner.createdAt, POLICY.idleTtlMs);
    assert.equal(learner.absoluteExpiresAt - learner.createdAt, POLICY.absoluteTtlMs);
  });

  test("judging a learner ignores the application's clock entirely", async () => {
    const pg = await fixture();
    await pg.reset();
    const store = pg.newStore({ policy: POLICY });
    const { tokenHash } = issueSessionToken();
    await store.create({ tokenHash });

    for (const wrong of [0, realNow() + 10 * 365 * 24 * 3_600_000, Number.NaN]) {
      Date.now = () => wrong;
      assert.equal((await store.findByTokenHash(tokenHash)).state, "active", `with the application clock at ${wrong}`);
      assert.equal((await store.touch(tokenHash, "read")).state, "active");
    }
  });

  test("idle expiry, the grace period and `none` arrive on schedule, with no purge having run", async () => {
    const pg = await fixture();
    await pg.reset();
    const store = pg.newStore({ policy: POLICY });
    const { tokenHash } = issueSessionToken();
    await store.create({ tokenHash });

    assert.equal((await store.findByTokenHash(tokenHash)).state, "active");
    await sleep(1_000); // past idle (0.8 s), inside the grace period (until 1.4 s)
    const expired = await store.findByTokenHash(tokenHash);
    assert.deepEqual({ ...expired }, { state: "expired", by: "idle" });
    assert.equal((await store.touch(tokenHash, "write")).state, "expired", "an expired learner cannot be revived by activity");

    await sleep(700); // past the grace period
    assert.equal((await store.findByTokenHash(tokenHash)).state, "none", "missing, though its row is still in the table");
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n, 1);

    assert.equal(await store.purgeExpired(), 1);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n, 0);
  });

  test("activity keeps a learner alive past its original idle deadline, and stops mattering at the absolute one", async () => {
    const pg = await fixture();
    await pg.reset();
    const store = pg.newStore({ policy: createExpiryPolicy({ idleTtlMs: 800, absoluteTtlMs: 1_500, touchIntervalMs: 100, purgeGraceMs: 600 }) });
    const { tokenHash } = issueSessionToken();
    const created = await store.create({ tokenHash });

    await sleep(500);
    const refreshed = await store.touch(tokenHash, "write");
    assert.ok(refreshed.state === "active" && refreshed.refreshed);
    assert.ok(refreshed.learner.idleExpiresAt > created.idleExpiresAt, "a write moves the idle deadline forward");
    assert.ok(refreshed.learner.idleExpiresAt <= created.absoluteExpiresAt, "but never past the absolute one");

    await sleep(500); // 1.0 s: past the ORIGINAL idle deadline (0.8 s), still within the refreshed one
    assert.equal((await store.findByTokenHash(tokenHash)).state, "active");

    await sleep(700); // 1.7 s: past the absolute deadline (1.5 s), however recently it was touched
    const ended = await store.findByTokenHash(tokenHash);
    assert.deepEqual({ ...ended }, { state: "expired", by: "absolute" });
  });

  test("attempt windows are measured on the database's clock too", async () => {
    const pg = await fixture();
    await pg.reset();
    const store = pg.newStore({ policy: POLICY });
    const learner = await store.create({ tokenHash: issueSessionToken().tokenHash });
    const { session } = await store.start({ learnerId: learner.id, challengeId: "challenge-001", challengeVersion: "v1" });
    const window = { limit: 1, windowMs: 600 };
    const attempt = (id: string) => ({
      learnerId: learner.id,
      sessionId: session.id,
      submissionId: id,
      requestHash: id.padEnd(64, "0"),
      rootCauseId: "option-a",
      explanation: "x",
      evidence: [],
      outcome: "incorrect" as const,
      window,
    });

    assert.equal((await store.record(attempt("a"))).kind, "recorded");
    Date.now = () => 0; // the application's clock cannot unblock it
    assert.equal((await store.record(attempt("b"))).kind, "rate-limited");
    Date.now = realNow;

    await sleep(800);
    assert.equal((await store.record(attempt("c"))).kind, "recorded", "the window really did end");
  });
});
