/*
 * The migration runner and the CORE schema it builds (migrations 0001 and 0002), against a real PostgreSQL.
 *
 * Account-linking migration 0003 is optional and is covered by the separate account-linking test suites
 * (for example migrations-rename and account-links), not by this core suite.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { MIGRATIONS_DIR, MigrationError, migrate, readMigrations } from "../../scripts/db-migrate.mjs";
import { createTestDatabase, SKIP, type TestDatabase } from "./helpers";

const LEARNER_COLUMNS = "id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at";
const SESSION_COLUMNS = "id, learner_id, challenge_id, challenge_version, status, created_at, updated_at";

/** Core anonymous persistence stops here. Optional later migrations are out of scope for this suite. */
const CORE_THROUGH = "0002_rate_limit_buckets";
const CORE_VERSIONS = ["0001_learner_sessions", "0002_rate_limit_buckets"] as const;
const isCoreMigrationFile = (file: string) => file.startsWith("0001_") || file.startsWith("0002_");

describe("migrations (real PostgreSQL)", { skip: SKIP }, () => {
  let db: TestDatabase;
  /** Temporary migration directories made by these tests. Every one is removed afterwards. */
  const tempDirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "buglab-mig-"));
    tempDirs.push(dir);
    return dir;
  };
  before(async () => {
    db = await createTestDatabase({ migrate: false });
  });
  after(async () => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    await db.drop();
  });

  async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
    const client = new pg.Client({ connectionString: db.url });
    await client.connect();
    try {
      return (await client.query<T>(text, values)).rows;
    } finally {
      await client.end();
    }
  }

  /** A copy of the CORE migrations only (0001 and 0002), with `edit` applied (null drops the file). */
  function copyCoreMigrations(edit: (file: string, text: string) => string | null = (_file, text) => text) {
    const dir = tempDir();
    for (const file of readdirSync(MIGRATIONS_DIR).filter(isCoreMigrationFile).sort()) {
      const edited = edit(file, readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      if (edited !== null) writeFileSync(join(dir, file), edited);
    }
    return dir;
  }

  test("an empty database gets every core migration, in order, and records each one", async () => {
    const result = await migrate({ connectionString: db.url, through: CORE_THROUGH });

    assert.deepEqual(result.applied, [...CORE_VERSIONS]);
    assert.deepEqual(result.alreadyApplied, []);
    const recorded = await query<{ version: string }>("SELECT version FROM buglab_schema_migrations ORDER BY version");
    assert.deepEqual(recorded.map((row) => row.version), [...CORE_VERSIONS]);
  });

  test("running it again through 0002 applies nothing", async () => {
    const result = await migrate({ connectionString: db.url, through: CORE_THROUGH });
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.alreadyApplied, [...CORE_VERSIONS]);
  });

  test("a status run on a core-migrated database reports nothing pending through 0002", async () => {
    const result = await migrate({ connectionString: db.url, dryRun: true, through: CORE_THROUGH });
    assert.deepEqual(result.applied, []);
  });

  test("the core schema has the tables, the partial unique indexes and the cascades the store relies on", async () => {
    const tables = await query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    assert.deepEqual(tables.map((row) => row.table_name), [
      "buglab_schema_migrations",
      "challenge_sessions",
      "diagnosis_attempts",
      "learners",
      "rate_limit_buckets",
    ]);
    assert.ok(!tables.some((row) => row.table_name === "account_learner_links"));

    const indexes = await query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'",
    );
    const current = indexes.find((row) => row.indexname === "challenge_sessions_current_uq");
    assert.match(current?.indexdef ?? "", /UNIQUE.*\(learner_id, challenge_id\).*WHERE \(superseded_at IS NULL\)/);
    const correct = indexes.find((row) => row.indexname === "diagnosis_attempts_one_correct_uq");
    assert.match(correct?.indexdef ?? "", /UNIQUE.*\(session_id\).*WHERE \(outcome = 'correct'::text\)/);

    const cascades = await query<{ delete_rule: string; table_name: string }>(
      `SELECT rc.delete_rule, tc.table_name FROM information_schema.referential_constraints rc
       JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
       WHERE tc.table_schema = 'public' ORDER BY tc.table_name`,
    );
    assert.deepEqual(cascades, [
      { delete_rule: "CASCADE", table_name: "challenge_sessions" },
      { delete_rule: "CASCADE", table_name: "diagnosis_attempts" },
    ]);
  });

  test("the database refuses states the application must never produce", async () => {
    const rejects = (sql: string, values: unknown[] = []) =>
      assert.rejects(query(sql, values), (error: { code?: string }) => ["23514", "23505", "23503"].includes(error.code ?? ""));
    const learner = (id: string, hash: string, idle: number, absolute: number): [string, unknown[]] => [
      `INSERT INTO learners (${LEARNER_COLUMNS}) VALUES ($1, $2, 1, 1, 1, $3, $4)`,
      [id, hash, idle, absolute],
    ];

    await query(...learner("l1", "a".repeat(64), 10, 20));
    // A token hash must be 64 lowercase hex characters, and unique.
    await rejects(...learner("l2", "nope", 10, 20));
    await rejects(...learner("l3", "a".repeat(64), 10, 20));
    // Idle expiry can never be later than absolute expiry.
    await rejects(...learner("l4", "b".repeat(64), 30, 20));
    // A session is completed only with a completion time and a result.
    await rejects(`INSERT INTO challenge_sessions (${SESSION_COLUMNS}) VALUES ('s1', 'l1', 'c', 'v', 'completed', 1, 1)`);
    // A completed session is never superseded.
    await rejects(
      `INSERT INTO challenge_sessions (${SESSION_COLUMNS}, completed_at, result, superseded_at) VALUES ('s2', 'l1', 'c', 'v', 'completed', 1, 1, 1, '{}', 2)`,
    );
    // A session needs a learner.
    await rejects(`INSERT INTO challenge_sessions (${SESSION_COLUMNS}) VALUES ('s3', 'ghost', 'c', 'v', 'active', 1, 1)`);
  });

  test("a changed migration that was already applied is refused", async () => {
    const dir = copyCoreMigrations((file, text) => (file.startsWith("0001") ? `${text}\n-- tampered\n` : text));
    await assert.rejects(migrate({ connectionString: db.url, dir }), (error: Error) => {
      assert.ok(error instanceof MigrationError);
      assert.match(error.message, /0001_learner_sessions was changed after it was applied/);
      return true;
    });
  });

  test("line endings do not count as a change, so a Windows checkout matches a Linux one", async () => {
    const dir = copyCoreMigrations((_file, text) => text.replace(/\r?\n/g, "\r\n"));
    const result = await migrate({ connectionString: db.url, dir });
    assert.deepEqual(result.applied, []);
  });

  test("a database ahead of the checkout is refused", async () => {
    const dir = copyCoreMigrations((file, text) => (file.startsWith("0001") ? text : null));
    await assert.rejects(migrate({ connectionString: db.url, dir }), /0002_rate_limit_buckets, which this checkout does not contain/);
  });

  test("a failing migration rolls back completely and records nothing", async () => {
    const fresh = await createTestDatabase({ migrate: false });
    try {
      const dir = tempDir();
      writeFileSync(join(dir, "0001_good_then_bad.sql"), "CREATE TABLE half_done (id INTEGER);\nSELECT 1/0;\n");
      await assert.rejects(migrate({ connectionString: fresh.url, dir }), /0001_good_then_bad failed and was rolled back/);

      const client = new pg.Client({ connectionString: fresh.url });
      await client.connect();
      try {
        const present = await client.query("SELECT to_regclass('half_done') IS NOT NULL AS present");
        assert.equal(present.rows[0].present, false, "the table created before the failure was rolled back");
        const recorded = await client.query("SELECT count(*)::int AS n FROM buglab_schema_migrations");
        assert.equal(recorded.rows[0].n, 0);
      } finally {
        await client.end();
      }
    } finally {
      await fresh.drop();
    }
  });

  test("two runners started together apply each core migration exactly once", async () => {
    const fresh = await createTestDatabase({ migrate: false });
    try {
      const [first, second] = await Promise.all([
        migrate({ connectionString: fresh.url, through: CORE_THROUGH }),
        migrate({ connectionString: fresh.url, through: CORE_THROUGH }),
      ]);
      assert.equal(first.applied.length + second.applied.length, CORE_VERSIONS.length);
    } finally {
      await fresh.drop();
    }
  });

  test("core migration files are numbered, named and free of their own transactions", () => {
    const onDisk = readMigrations() as { version: string }[];
    for (const version of CORE_VERSIONS) {
      assert.ok(onDisk.some((migration) => migration.version === version), `${version} must be on disk`);
    }
    const core = onDisk.filter((migration) => (CORE_VERSIONS as readonly string[]).includes(migration.version));
    assert.equal(core.length, CORE_VERSIONS.length);
    core.forEach((migration, index) => assert.equal(migration.version.slice(0, 4), String(index + 1).padStart(4, "0")));
    assert.throws(
      () => readMigrations(copyCoreMigrations((file, text) => (file.startsWith("0001") ? `BEGIN;\n${text}` : text))),
      /must not manage its own transaction/,
    );
  });

  test("a bad connection string fails without echoing it", async () => {
    await assert.rejects(migrate({ connectionString: "postgres://user:s3cretpw@127.0.0.1:1/none" }), (error: Error) => {
      assert.ok(error instanceof MigrationError);
      assert.ok(!error.message.includes("s3cretpw"));
      return true;
    });
  });

  test("it refuses to run without a connection string", async () => {
    await assert.rejects(migrate({ connectionString: "" }), /BUGLAB_DATABASE_URL_DIRECT/);
  });
});
