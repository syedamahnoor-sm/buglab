/*
 * Core anonymous persistence against a database that has ONLY migrations 0001 and 0002.
 *
 * Proves Syeda's Option 2: durable learner sessions and rate limiting do not require account-linking
 * migration 0003. Account-linking behaviour (unavailable APIs, later apply of 0003) is covered by the
 * separate account-linking test suites, not here.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";
import { issueSessionToken } from "@/server/session/token";
import { createTestDatabase, SKIP, type TestDatabase } from "./helpers";

const open: PostgresPersistence[] = [];
const databases: TestDatabase[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.close()));
  await Promise.all(databases.splice(0).map((db) => db.drop()));
});

async function coreOnly() {
  const db = await createTestDatabase({ through: "0002_rate_limit_buckets" });
  databases.push(db);
  const persistence = createPostgresPersistence({ config: { connectionString: db.url, poolMax: 5 } });
  open.push(persistence);
  return { db, persistence, store: persistence.store, limiter: persistence.rateLimiter };
}

const tables = async (persistence: PostgresPersistence) =>
  (
    await persistence.pool.query<{ name: string }>(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
  ).rows.map((row) => row.name);

describe("core schema only (migrations 0001 and 0002)", { skip: SKIP }, () => {
  test("initialization and verifySchema succeed without account_learner_links", async () => {
    const { persistence } = await coreOnly();
    await persistence.verifySchema();
    const names = await tables(persistence);
    assert.ok(names.includes("learners"));
    assert.ok(names.includes("challenge_sessions"));
    assert.ok(names.includes("diagnosis_attempts"));
    assert.ok(names.includes("rate_limit_buckets"));
    assert.ok(names.includes("buglab_schema_migrations"));
    assert.ok(!names.includes("account_learner_links"));
    const versions = (
      await persistence.pool.query<{ version: string }>("SELECT version FROM buglab_schema_migrations ORDER BY version")
    ).rows.map((row) => row.version);
    assert.deepEqual(versions, ["0001_learner_sessions", "0002_rate_limit_buckets"]);
  });

  test("learner creation, lookup, sessions and diagnosis attempts work", async () => {
    const { store } = await coreOnly();
    const tokenHash = issueSessionToken().tokenHash;
    const learner = await store.create({ tokenHash });
    assert.equal((await store.findByTokenHash(tokenHash)).state, "active");

    const { session, created } = await store.start({
      learnerId: learner.id,
      challengeId: "challenge-001",
      challengeVersion: "v1",
    });
    assert.equal(created, true);

    const recorded = await store.record({
      learnerId: learner.id,
      sessionId: session.id,
      submissionId: "sub-1",
      requestHash: "a".repeat(64),
      rootCauseId: "option-a",
      explanation: "because",
      evidence: [{ kind: "log", logId: "log-01" }],
      outcome: "incorrect",
      window: { limit: 3, windowMs: 600_000 },
    });
    assert.equal(recorded.kind, "recorded");
    assert.equal((await store.list({ learnerId: learner.id, sessionId: session.id })).length, 1);
  });

  test("rate limiting works without migration 0003", async () => {
    const { limiter } = await coreOnly();
    const policy = { limit: 2, windowMs: 60_000 };
    assert.equal((await limiter.consume("learner-creation", "client-a", policy)).allowed, true);
    assert.equal((await limiter.consume("learner-creation", "client-a", policy)).allowed, true);
    assert.equal((await limiter.consume("learner-creation", "client-a", policy)).allowed, false);
  });

  test("core purge removes expired anonymous learners and never queries account_learner_links", async () => {
    const { persistence, store } = await coreOnly();
    const keep = await store.create({ tokenHash: issueSessionToken().tokenHash });
    const drop = await store.create({ tokenHash: issueSessionToken().tokenHash });
    await store.start({ learnerId: drop.id, challengeId: "challenge-001", challengeVersion: "v1" });
    await persistence.pool.query("UPDATE learners SET idle_expires_at = 2, absolute_expires_at = 3 WHERE id = $1", [drop.id]);

    // Prove the link table is absent: any reference would fail the purge if the core store still depended on it.
    assert.equal(
      (await persistence.pool.query("SELECT to_regclass('public.account_learner_links') IS NULL AS missing")).rows[0].missing,
      true,
    );
    assert.deepEqual({ ...(await persistence.purgeExpired()) }, { learners: 1, rateLimitBuckets: 0 });
    assert.equal((await persistence.pool.query("SELECT count(*)::int AS n FROM learners")).rows[0].n, 1);
    assert.equal((await persistence.pool.query("SELECT id FROM learners")).rows[0].id, keep.id);
    assert.equal((await persistence.pool.query("SELECT count(*)::int AS n FROM challenge_sessions")).rows[0].n, 0);
  });

  test("core verifySchema remains satisfied after ordinary learner use", async () => {
    const { persistence, store } = await coreOnly();
    const tokenHash = issueSessionToken().tokenHash;
    await store.create({ tokenHash });
    assert.equal((await store.findByTokenHash(tokenHash)).state, "active");
    await persistence.verifySchema();
    assert.ok(!(await tables(persistence)).includes("account_learner_links"));
  });
});
