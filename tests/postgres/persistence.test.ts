/*
 * createPostgresPersistence against a real database: the schema check, the combined purge and the scheduler.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createPostgresPersistence, SchemaOutOfDateError, startPeriodicPurge, type PostgresPersistence } from "@/server/db/persistence";
import { issueSessionToken } from "@/server/session/token";
import { createTestDatabase, SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const fixture = pgFixture();
const open: PostgresPersistence[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((persistence) => persistence.close()));
});

function persistenceFor(url: string) {
  const persistence = createPostgresPersistence({ config: { connectionString: url, poolMax: 3 } });
  open.push(persistence);
  return persistence;
}

describe("createPostgresPersistence (real PostgreSQL)", { skip: SKIP }, () => {
  test("verifySchema passes on a migrated database", async () => {
    const pg = await fixture();
    await persistenceFor(pg.db.url).verifySchema();
  });

  test("verifySchema fails clearly on a database that was never migrated, and on one missing the core migration", async () => {
    const empty = await createTestDatabase({ migrate: false });
    try {
      await assert.rejects(persistenceFor(empty.url).verifySchema(), SchemaOutOfDateError);
    } finally {
      await empty.drop();
    }

    const pg = await fixture();
    const persistence = persistenceFor(pg.db.url);
    await pg.query("DELETE FROM buglab_schema_migrations WHERE version = '0002_rate_limit_buckets'");
    try {
      await assert.rejects(persistence.verifySchema(), /0002_rate_limit_buckets has not been applied/);
    } finally {
      await pg.query("INSERT INTO buglab_schema_migrations (version, checksum) VALUES ('0002_rate_limit_buckets', 'restored') ON CONFLICT DO NOTHING");
    }
  });

  test("verifySchema succeeds when only core migrations 0001 and 0002 are applied", async () => {
    const core = await createTestDatabase({ through: "0002_rate_limit_buckets" });
    try {
      const persistence = persistenceFor(core.url);
      await persistence.verifySchema();
      const tables = (
        await persistence.pool.query<{ name: string }>(
          `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
        )
      ).rows.map((row) => row.name);
      assert.ok(tables.includes("learners"));
      assert.ok(tables.includes("rate_limit_buckets"));
      assert.ok(!tables.includes("account_learner_links"), "optional 0003 must not be required");
    } finally {
      await core.drop();
    }
  });

  test("purgeExpired clears expired learners (with their data) and ended rate-limit windows, and reports both", async () => {
    const pg = await fixture();
    await pg.reset();
    const persistence = persistenceFor(pg.db.url);
    const learner = await persistence.store.create({ tokenHash: issueSessionToken().tokenHash });
    await persistence.store.start({ learnerId: learner.id, challengeId: "challenge-001", challengeVersion: "v1" });
    await persistence.store.create({ tokenHash: issueSessionToken().tokenHash }); // stays
    await pg.query("UPDATE learners SET idle_expires_at = 2, absolute_expires_at = 3 WHERE id = $1", [learner.id]);
    await pg.query("INSERT INTO rate_limit_buckets (scope, bucket_key, window_started_at, hits, expires_at) VALUES ('s', 'old', 1, 1, 2), ('s', 'old2', 1, 1, 2)");
    await persistence.rateLimiter.consume("s", "alive", { limit: 5, windowMs: 3_600_000 });

    assert.deepEqual({ ...(await persistence.purgeExpired()) }, { learners: 1, rateLimitBuckets: 2 });
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n, 1);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM challenge_sessions")).rows[0].n, 0);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM rate_limit_buckets")).rows[0].n, 1);
    assert.deepEqual({ ...(await persistence.purgeExpired()) }, { learners: 0, rateLimitBuckets: 0 });
  });

  test("the scheduler really purges real rows, with no callbacks supplied", async () => {
    const pg = await fixture();
    await pg.reset();
    const persistence = persistenceFor(pg.db.url);
    const learner = await persistence.store.create({ tokenHash: issueSessionToken().tokenHash });
    await pg.query("UPDATE learners SET idle_expires_at = 2, absolute_expires_at = 3 WHERE id = $1", [learner.id]);

    const stop = startPeriodicPurge(persistence, { intervalMs: 50 });
    try {
      for (let i = 0; i < 40; i += 1) {
        if ((await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.fail("the scheduled purge never removed the expired learner");
    } finally {
      stop();
    }
  });

  test("the learner-creation guard from the persistence uses the shared limiter and the policy it is given", async () => {
    const pg = await fixture();
    await pg.reset();
    const persistence = persistenceFor(pg.db.url);
    const guard = persistence.learnerCreationGuard({ trustedProxyHops: 1, policy: { limit: 2, windowMs: 60_000 } });
    const request = () => new Request("http://localhost:3000/api/learner", { method: "POST", headers: { "x-forwarded-for": "203.0.113.5" } });

    assert.deepEqual([(await guard(request())).allowed, (await guard(request())).allowed, (await guard(request())).allowed], [true, true, false]);
    const refused = await guard(request());
    assert.ok(!refused.allowed && refused.retryAfterSeconds >= 1 && refused.retryAfterSeconds <= 60);
  });
});
