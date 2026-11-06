/*
 * Fail-closed check for diagnosis submission claims (migration 0005).
 * Core verifySchema stays on 0002. This check is not called by persistence startup.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import pg from "pg";
import {
  REQUIRED_MIGRATION,
  SchemaOutOfDateError,
  SUBMISSION_CLAIMS_MIGRATION,
  SubmissionClaimsSchemaError,
  createPostgresPersistence,
  verifySubmissionClaimsSchema,
} from "@/server/db/persistence";
import { createTestDatabase, SKIP, type TestDatabase } from "./helpers";

const databases: TestDatabase[] = [];
const pools: pg.Pool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => (pool.ended ? Promise.resolve() : pool.end())));
  await Promise.all(databases.splice(0).map((db) => db.drop()));
});

function poolFor(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  pool.on("error", () => {});
  pools.push(pool);
  return pool;
}

async function publicTables(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return rows.map((row) => row.name);
}

async function recordedMigrations(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query<{ version: string }>(
    "SELECT version FROM buglab_schema_migrations ORDER BY version",
  );
  return rows.map((row) => row.version);
}

describe("submission claims schema verification", { skip: SKIP }, () => {
  test("required submission-claims schema passes and core verifySchema still stops at 0002", async () => {
    const db = await createTestDatabase({ through: SUBMISSION_CLAIMS_MIGRATION });
    databases.push(db);
    const pool = poolFor(db.url);
    const beforeTables = await publicTables(pool);
    const beforeVersions = await recordedMigrations(pool);
    const beforeClaims = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM diagnosis_submission_claims");

    await verifySubmissionClaimsSchema(pool);

    const persistence = createPostgresPersistence({ config: { connectionString: db.url, poolMax: 2 } });
    pools.push(persistence.pool);
    await persistence.verifySchema();
    assert.equal(REQUIRED_MIGRATION, "0002_rate_limit_buckets");

    assert.deepEqual(await publicTables(pool), beforeTables);
    assert.deepEqual(await recordedMigrations(pool), beforeVersions);
    const afterClaims = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM diagnosis_submission_claims");
    assert.equal(afterClaims.rows[0].n, beforeClaims.rows[0].n);
    assert.ok(beforeTables.includes("diagnosis_submission_claims"));
    assert.ok(!beforeTables.includes("diagnosis_submission_claims_lookalike"));
  });

  test("a missing claims table fails clearly and does not change core verifySchema or database state", async () => {
    const db = await createTestDatabase({ through: "0002_rate_limit_buckets" });
    databases.push(db);
    const pool = poolFor(db.url);
    await pool.query("CREATE TABLE diagnosis_submission_claims_lookalike (id integer)");
    const beforeTables = await publicTables(pool);
    const beforeVersions = await recordedMigrations(pool);

    const persistence = createPostgresPersistence({ config: { connectionString: db.url, poolMax: 2 } });
    pools.push(persistence.pool);
    await persistence.verifySchema();

    await assert.rejects(verifySubmissionClaimsSchema(pool), SubmissionClaimsSchemaError);
    await assert.rejects(verifySubmissionClaimsSchema(pool), (error: SubmissionClaimsSchemaError) => {
      assert.ok(error instanceof SubmissionClaimsSchemaError);
      assert.match(error.message, /public\.diagnosis_submission_claims is missing/);
      assert.match(error.message, /0005_diagnosis_submission_claims/);
      assert.match(error.message, /does not migrate/);
      assert.ok(error.missing.some((item) => item.includes("public.diagnosis_submission_claims is missing")));
      assert.ok(!error.message.includes("diagnosis_submission_claims_lookalike"));
      return true;
    });

    assert.deepEqual(await publicTables(pool), beforeTables);
    assert.deepEqual(await recordedMigrations(pool), beforeVersions);
    assert.deepEqual(beforeVersions, ["0001_learner_sessions", "0002_rate_limit_buckets"]);
  });

  test("a missing required column fails clearly without migrating", async () => {
    const db = await createTestDatabase({ through: SUBMISSION_CLAIMS_MIGRATION });
    databases.push(db);
    const pool = poolFor(db.url);
    await pool.query("ALTER TABLE diagnosis_submission_claims DROP COLUMN expires_at CASCADE");
    const beforeVersions = await recordedMigrations(pool);

    await assert.rejects(verifySubmissionClaimsSchema(pool), (error: SubmissionClaimsSchemaError) => {
      assert.ok(error instanceof SubmissionClaimsSchemaError);
      assert.match(error.message, /column expires_at is missing/);
      assert.match(error.message, /does not migrate/);
      return true;
    });
    assert.deepEqual(await recordedMigrations(pool), beforeVersions);

    const persistence = createPostgresPersistence({ config: { connectionString: db.url, poolMax: 2 } });
    pools.push(persistence.pool);
    await persistence.verifySchema();
  });

  test("a missing primary key fails clearly", async () => {
    const db = await createTestDatabase({ through: SUBMISSION_CLAIMS_MIGRATION });
    databases.push(db);
    const pool = poolFor(db.url);
    await pool.query("ALTER TABLE diagnosis_submission_claims DROP CONSTRAINT diagnosis_submission_claims_pkey");
    const beforeTables = await publicTables(pool);

    await assert.rejects(verifySubmissionClaimsSchema(pool), (error: SubmissionClaimsSchemaError) => {
      assert.ok(error instanceof SubmissionClaimsSchemaError);
      assert.match(error.message, /primary key must be \(session_id, submission_id\)/);
      return true;
    });
    assert.deepEqual(await publicTables(pool), beforeTables);
  });

  test("an empty database fails the claims check and still fails core verifySchema as 0002", async () => {
    const db = await createTestDatabase({ migrate: false });
    databases.push(db);
    const pool = poolFor(db.url);
    const beforeTables = await publicTables(pool);

    await assert.rejects(verifySubmissionClaimsSchema(pool), (error: SubmissionClaimsSchemaError) => {
      assert.ok(error instanceof SubmissionClaimsSchemaError);
      assert.match(error.message, /buglab_schema_migrations is missing/);
      assert.match(error.message, /public\.diagnosis_submission_claims is missing/);
      return true;
    });

    const persistence = createPostgresPersistence({ config: { connectionString: db.url, poolMax: 2 } });
    pools.push(persistence.pool);
    await assert.rejects(persistence.verifySchema(), SchemaOutOfDateError);
    await assert.rejects(persistence.verifySchema(), /0002_rate_limit_buckets has not been applied/);
    assert.deepEqual(await publicTables(pool), beforeTables);
  });

  test("misleading length checks that name the wrong column or bounds are rejected", async () => {
    const db = await createTestDatabase({ through: SUBMISSION_CLAIMS_MIGRATION });
    databases.push(db);
    const pool = poolFor(db.url);

    const lengthChecks = await pool.query<{ name: string; definition: string }>(
      `SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'diagnosis_submission_claims'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%length(submission_id)%'`,
    );
    assert.equal(lengthChecks.rows.length, 1);
    await pool.query(`ALTER TABLE diagnosis_submission_claims DROP CONSTRAINT ${lengthChecks.rows[0].name}`);

    // Wrong column bounds that still mention submission_id and contain 1 / 128 fragments elsewhere.
    await pool.query(`
      ALTER TABLE diagnosis_submission_claims
        ADD CONSTRAINT diagnosis_submission_claims_misleading_length
        CHECK (
          length(claim_token) >= 1
          AND length(claim_token) <= 128
          AND length(submission_id) IS NOT NULL
        )
    `);

    await assert.rejects(verifySubmissionClaimsSchema(pool), (error: SubmissionClaimsSchemaError) => {
      assert.ok(error instanceof SubmissionClaimsSchemaError);
      assert.match(error.message, /length\(submission_id\) between 1 and 128 is missing/);
      return true;
    });

    await pool.query("ALTER TABLE diagnosis_submission_claims DROP CONSTRAINT diagnosis_submission_claims_misleading_length");
    // Altered upper bound on the correct column must also fail.
    await pool.query(`
      ALTER TABLE diagnosis_submission_claims
        ADD CONSTRAINT diagnosis_submission_claims_wide_submission_id
        CHECK (length(submission_id) BETWEEN 1 AND 256)
    `);

    await assert.rejects(verifySubmissionClaimsSchema(pool), (error: SubmissionClaimsSchemaError) => {
      assert.ok(error instanceof SubmissionClaimsSchemaError);
      assert.match(error.message, /length\(submission_id\) between 1 and 128 is missing/);
      return true;
    });
  });

  test("suffix lookalike expires_at and request_hash checks are rejected", async () => {
    const db = await createTestDatabase({ through: SUBMISSION_CLAIMS_MIGRATION });
    databases.push(db);
    const pool = poolFor(db.url);

    const timeChecks = await pool.query<{ name: string }>(
      `SELECT c.conname AS name
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'diagnosis_submission_claims'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%expires_at%claimed_at%'`,
    );
    assert.equal(timeChecks.rows.length, 1);
    await pool.query(`ALTER TABLE diagnosis_submission_claims DROP CONSTRAINT ${timeChecks.rows[0].name}`);
    await pool.query(`
      ALTER TABLE diagnosis_submission_claims
        ADD COLUMN other_expires_at BIGINT NOT NULL DEFAULT 0
    `);
    await pool.query(`
      ALTER TABLE diagnosis_submission_claims
        ADD CONSTRAINT diagnosis_submission_claims_lookalike_expires
        CHECK (other_expires_at > claimed_at)
    `);

    await assert.rejects(verifySubmissionClaimsSchema(pool), (error: SubmissionClaimsSchemaError) => {
      assert.ok(error instanceof SubmissionClaimsSchemaError);
      assert.match(error.message, /expires_at > claimed_at is missing/);
      return true;
    });

    const hashChecks = await pool.query<{ name: string }>(
      `SELECT c.conname AS name
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'diagnosis_submission_claims'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%request_hash ~%'`,
    );
    assert.equal(hashChecks.rows.length, 1);
    await pool.query(`ALTER TABLE diagnosis_submission_claims DROP CONSTRAINT ${hashChecks.rows[0].name}`);
    await pool.query(`
      ALTER TABLE diagnosis_submission_claims
        ADD COLUMN my_request_hash TEXT NOT NULL DEFAULT repeat('a', 64)
    `);
    await pool.query(`
      ALTER TABLE diagnosis_submission_claims
        ADD CONSTRAINT diagnosis_submission_claims_lookalike_hash
        CHECK (my_request_hash ~ '^[0-9a-f]{64}$')
    `);

    await assert.rejects(verifySubmissionClaimsSchema(pool), (error: SubmissionClaimsSchemaError) => {
      assert.ok(error instanceof SubmissionClaimsSchemaError);
      assert.match(error.message, /request_hash is 64 lowercase hex characters is missing/);
      assert.match(error.message, /expires_at > claimed_at is missing/);
      return true;
    });
  });
});
