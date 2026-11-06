/*
 * Learning Loop schema gate vs core verifySchema, and pgcrypto infrastructure preflight.
 *
 * Core persistence must succeed on 0001+0002 alone (0003 and 0004 optional).
 * Learning Loop PostgreSQL initialization requires 0004 and learning_reflections, never 0003.
 * pgcrypto is an ops prerequisite: the factory verifies digest() and never CREATE EXTENSION.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import pg from "pg";
import { createPostgresPersistence } from "@/server/db/persistence";
import {
  activityDigestAvailable,
  createPostgresLearningLoopStore,
  LEARNING_LOOP_REQUIRED_MIGRATION,
  LearningLoopInfrastructureError,
  LearningLoopSchemaOutOfDateError,
  learningLoopSchemaPresent,
  PGCRYPTO_PROVISIONING_SQL,
  PostgresLearningLoopStore,
  verifyActivityDigest,
  verifyLearningLoopSchema,
} from "@/server/learning-loop/postgres-store";
import { createTestDatabase, ensureTestPgcrypto, SKIP, type TestDatabase } from "./helpers";

const REFLECTIONS = "0004_learning_reflections";
const ACCOUNT_LINKS = "0003_account_links";
const databases: TestDatabase[] = [];
const pools: pg.Pool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => (pool.ended ? Promise.resolve() : pool.end())));
  await Promise.all(databases.splice(0).map((db) => db.drop()));
});

function poolFor(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  pool.on("error", () => {});
  pools.push(pool);
  return pool;
}

describe("Learning Loop schema verification", { skip: SKIP }, () => {
  test("core verifySchema succeeds without 0004; Learning Loop verification fails clearly", async () => {
    const db = await createTestDatabase({ through: "0002_rate_limit_buckets" });
    databases.push(db);
    const persistence = createPostgresPersistence({ config: { connectionString: db.url, poolMax: 3 } });
    pools.push(persistence.pool);

    await persistence.verifySchema();
    assert.equal(await learningLoopSchemaPresent(persistence.pool), false);
    await assert.rejects(verifyLearningLoopSchema(persistence.pool), LearningLoopSchemaOutOfDateError);
    await assert.rejects(verifyLearningLoopSchema(persistence.pool), /0004_learning_reflections has not been applied/);
    await assert.rejects(createPostgresLearningLoopStore({ pool: persistence.pool }), LearningLoopSchemaOutOfDateError);

    const tables = (
      await persistence.pool.query<{ name: string }>(
        `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      )
    ).rows.map((row) => row.name);
    assert.ok(!tables.includes("learning_reflections"));
    assert.ok(!tables.includes("account_learner_links"), "0003 must not be required for core or Learning Loop gates");
  });

  test("Learning Loop verification succeeds with 0004 and never requires 0003", async () => {
    const db = await createTestDatabase({ through: REFLECTIONS, exclude: [ACCOUNT_LINKS] });
    databases.push(db);
    const pool = poolFor(db.url);

    await verifyLearningLoopSchema(pool);
    assert.equal(await learningLoopSchemaPresent(pool), true);
    assert.equal(LEARNING_LOOP_REQUIRED_MIGRATION, REFLECTIONS);

    await ensureTestPgcrypto(pool);
    const store = await createPostgresLearningLoopStore({ pool });
    assert.ok(store);

    const present = await pool.query(
      `SELECT to_regclass('public.learning_reflections') IS NOT NULL AS reflections,
              to_regclass('public.account_learner_links') IS NULL AS no_links,
              EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS pgcrypto`,
    );
    assert.equal(present.rows[0].reflections, true);
    assert.equal(present.rows[0].no_links, true);
    assert.equal(present.rows[0].pgcrypto, true);

    const versions = (
      await pool.query<{ version: string }>("SELECT version FROM buglab_schema_migrations ORDER BY version")
    ).rows.map((row) => row.version);
    assert.deepEqual(versions, ["0001_learner_sessions", "0002_rate_limit_buckets", REFLECTIONS]);
    assert.ok(!versions.includes(ACCOUNT_LINKS));

    const persistence = createPostgresPersistence({ config: { connectionString: db.url, poolMax: 2 } });
    pools.push(persistence.pool);
    await persistence.verifySchema();
  });

  test("Learning Loop verification fails on an empty database", async () => {
    const db = await createTestDatabase({ migrate: false });
    databases.push(db);
    const pool = poolFor(db.url);
    await assert.rejects(verifyLearningLoopSchema(pool), LearningLoopSchemaOutOfDateError);
  });
});

describe("Learning Loop pgcrypto infrastructure", { skip: SKIP }, () => {
  test("PGCRYPTO_PROVISIONING_SQL is the documented CREATE EXTENSION statement", () => {
    assert.equal(PGCRYPTO_PROVISIONING_SQL, "CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  });

  test("createPostgresLearningLoopStore fails clearly when digest() is missing and never installs pgcrypto", async () => {
    const db = await createTestDatabase({ through: REFLECTIONS, exclude: [ACCOUNT_LINKS] });
    databases.push(db);
    const pool = poolFor(db.url);

    assert.equal(await activityDigestAvailable(pool), false);
    await assert.rejects(verifyActivityDigest(pool), LearningLoopInfrastructureError);
    await assert.rejects(verifyActivityDigest(pool), /CREATE EXTENSION IF NOT EXISTS pgcrypto/);
    await assert.rejects(createPostgresLearningLoopStore({ pool }), LearningLoopInfrastructureError);

    const extensions = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS pgcrypto`,
    );
    assert.equal(extensions.rows[0].pgcrypto, false, "factory must not CREATE EXTENSION");
  });

  test("after DBA provisioning, createPostgresLearningLoopStore succeeds", async () => {
    const db = await createTestDatabase({ through: REFLECTIONS, exclude: [ACCOUNT_LINKS] });
    databases.push(db);
    const pool = poolFor(db.url);
    await ensureTestPgcrypto(pool);
    await verifyActivityDigest(pool);
    assert.ok(await createPostgresLearningLoopStore({ pool }));
  });

  test("direct PostgresLearningLoopStore construction: listActivity maps missing digest to infrastructure error", async () => {
    const db = await createTestDatabase({ through: REFLECTIONS, exclude: [ACCOUNT_LINKS] });
    databases.push(db);
    const pool = poolFor(db.url);
    const store = new PostgresLearningLoopStore({ pool });
    await assert.rejects(store.listActivity("any-learner"), LearningLoopInfrastructureError);
    await assert.rejects(store.listActivity("any-learner"), /digest\(\)/);
  });

  test("core persistence does not require pgcrypto", async () => {
    const db = await createTestDatabase({ through: "0002_rate_limit_buckets" });
    databases.push(db);
    const persistence = createPostgresPersistence({ config: { connectionString: db.url, poolMax: 2 } });
    pools.push(persistence.pool);
    await persistence.verifySchema();
    assert.equal(await activityDigestAvailable(persistence.pool), false);
  });
});
