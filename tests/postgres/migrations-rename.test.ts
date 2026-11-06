/*
 * The rename of the migrations table from the generic `schema_migrations` to `buglab_schema_migrations`, and migration 0003,
 * on a CLEAN database and on an EXISTING development database that was migrated before the rename. Real PostgreSQL.
 *
 * The rule under test: the legacy table is renamed in place only when it is provably this application's own (the exact
 * columns the old runner created AND every recorded version in this application's NNNN_name form), after every recorded
 * migration has been checked. Any other table called `schema_migrations` belongs to some other tool and is never touched.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import pg from "pg";
import { MIGRATIONS_TABLE, migrate, readMigrations } from "../../scripts/db-migrate.mjs";
import { createTestDatabase, SKIP, type TestDatabase } from "./helpers";

const databases: TestDatabase[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.drop()));
});

type Migration = { version: string; checksum: string; sql: string };
const all = () => readMigrations() as Migration[];
/** Legacy rename / 0003 account-links cases stop here so 0004 is not required. */
const throughAccountLinks = { through: "0003_account_links" } as const;

async function newDatabase() {
  const db = await createTestDatabase({ migrate: false });
  databases.push(db);
  return db;
}

async function withClient<T>(db: TestDatabase, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: db.url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** A development database exactly as the OLD runner left it: `schema_migrations`, with only 0001 and 0002 applied. */
async function legacyDevelopmentDatabase() {
  const db = await newDatabase();
  await withClient(db, async (client) => {
    await client.query(`CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const migration of all().slice(0, 2)) {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [migration.version, migration.checksum]);
      await client.query("COMMIT");
    }
    // Real data from before the change: a learner with a credential, a session, a completed attempt.
    await client.query(
      `INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at)
       VALUES ('dev-learner', $1, 1000, 1000, 1000, 9000000000000, 9000000000001)`,
      ["c".repeat(64)],
    );
    await client.query(
      `INSERT INTO challenge_sessions (id, learner_id, challenge_id, challenge_version, status, revision, attempt_count, wrong_attempts, created_at, updated_at, completed_at, result)
       VALUES ('dev-session', 'dev-learner', 'challenge-001', 'v1', 'completed', 1, 1, 0, 1000, 1001, 1001, '{"resolutionSummary":"kept"}')`,
    );
    await client.query(
      `INSERT INTO diagnosis_attempts (id, session_id, challenge_id, seq, submission_id, request_hash, root_cause_id, explanation, evidence, outcome, created_at)
       VALUES ('dev-attempt', 'dev-session', 'challenge-001', 1, 'sub-1', $1, 'option-a', 'x', '[]', 'correct', 1001)`,
      ["d".repeat(64)],
    );
  });
  return db;
}

const tables = (db: TestDatabase) =>
  withClient(db, async (client) =>
    (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")).rows.map((row) => row.table_name as string),
  );

describe("the migrations table rename and migration 0003 (real PostgreSQL)", { skip: SKIP }, () => {
  describe("a clean database", () => {
    test("gets every migration, recorded in buglab_schema_migrations, and no generic schema_migrations table", async () => {
      const db = await newDatabase();
      const result = await migrate({ connectionString: db.url });

      assert.deepEqual(result.applied, all().map((m) => m.version));
      const names = await tables(db);
      assert.ok(names.includes(MIGRATIONS_TABLE));
      assert.ok(!names.includes("schema_migrations"), "the generic name is never created");
      assert.equal(MIGRATIONS_TABLE, "buglab_schema_migrations");
      assert.ok(names.includes("account_learner_links"));
    });

    test("migration 0003 stays on disk before any newer file; 0001 and 0002 are never edited", () => {
      const versions = all().map((m) => m.version);
      assert.deepEqual(versions.slice(0, 3), ["0001_learner_sessions", "0002_rate_limit_buckets", "0003_account_links"]);
      assert.ok(versions.includes("0003_account_links"));
      assert.ok(versions.indexOf("0004_learning_reflections") > versions.indexOf("0003_account_links"));
      assert.equal(versions.at(-1), "0005_diagnosis_submission_claims");
    });
  });

  describe("an existing development database from before the rename", () => {
    test("the legacy table is renamed in place, only 0003 is applied, and every earlier row of data survives", async () => {
      const db = await legacyDevelopmentDatabase();
      const before = await withClient(db, async (c) => (await c.query("SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version")).rows);

      const result = await migrate({ connectionString: db.url, ...throughAccountLinks });

      assert.deepEqual(result.applied, ["0003_account_links"]);
      assert.deepEqual(result.alreadyApplied, ["0001_learner_sessions", "0002_rate_limit_buckets"]);
      const names = await tables(db);
      assert.ok(!names.includes("schema_migrations"), "the legacy table is gone, renamed not copied");
      const after = await withClient(db, async (c) => (await c.query(`SELECT version, checksum, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY version`)).rows);
      assert.deepEqual(after.slice(0, 2), before, "the original rows, with their original timestamps, are the same rows");
      assert.equal(after.length, 3);

      await withClient(db, async (c) => {
        const learner = (await c.query("SELECT id, token_hash, idle_expires_at, absolute_expires_at FROM learners")).rows;
        assert.equal(learner.length, 1);
        assert.equal(learner[0].token_hash, "c".repeat(64), "the learner's credential is intact");
        const session = (await c.query("SELECT status, result FROM challenge_sessions")).rows[0];
        assert.deepEqual({ status: session.status, result: session.result }, { status: "completed", result: { resolutionSummary: "kept" } });
        assert.equal((await c.query("SELECT count(*)::int AS n FROM diagnosis_attempts")).rows[0].n, 1);
      });
    });

    test("the renamed table's primary key and other constraints are renamed too, so no trace of the old name remains", async () => {
      const db = await legacyDevelopmentDatabase();
      await migrate({ connectionString: db.url, ...throughAccountLinks });
      const constraints = await withClient(db, async (c) =>
        (await c.query("SELECT conname FROM pg_constraint WHERE conrelid = to_regclass($1)", [MIGRATIONS_TABLE])).rows.map((r) => r.conname as string),
      );
      assert.ok(constraints.includes("buglab_schema_migrations_pkey"));
      assert.ok(constraints.every((name) => name.startsWith("buglab_schema_migrations_")), `a constraint still has the old name: ${constraints.join(", ")}`);
    });

    test("running it again applies nothing", async () => {
      const db = await legacyDevelopmentDatabase();
      await migrate({ connectionString: db.url, ...throughAccountLinks });
      const again = await migrate({ connectionString: db.url, ...throughAccountLinks });
      assert.deepEqual(again.applied, []);
      assert.equal(again.alreadyApplied.length, 3);
    });

    test("a status check reports 0003 pending and renames nothing", async () => {
      const db = await legacyDevelopmentDatabase();
      const status = await migrate({ connectionString: db.url, dryRun: true, ...throughAccountLinks });

      assert.deepEqual(status.applied, ["0003_account_links"]);
      const names = await tables(db);
      assert.ok(names.includes("schema_migrations") && !names.includes(MIGRATIONS_TABLE), "a read-only check changes nothing");
    });

    test("two runners started together on a legacy database rename once and apply once", async () => {
      const db = await legacyDevelopmentDatabase();
      const results = await Promise.all([
        migrate({ connectionString: db.url, ...throughAccountLinks }),
        migrate({ connectionString: db.url, ...throughAccountLinks }),
      ]);

      assert.equal(results[0].applied.length + results[1].applied.length, 1, "0003 applied exactly once");
      assert.ok(!(await tables(db)).includes("schema_migrations"));
    });

    test("a legacy table whose recorded checksum no longer matches is refused BEFORE anything is renamed or applied", async () => {
      const db = await legacyDevelopmentDatabase();
      await withClient(db, (c) => c.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001_learner_sessions'"));

      await assert.rejects(migrate({ connectionString: db.url, ...throughAccountLinks }), /0001_learner_sessions was changed after it was applied/);

      const names = await tables(db);
      assert.ok(names.includes("schema_migrations") && !names.includes(MIGRATIONS_TABLE), "nothing was renamed");
      assert.ok(!names.includes("account_learner_links"), "and 0003 was not applied");
    });

    test("when both tables exist it refuses and changes nothing", async () => {
      const db = await legacyDevelopmentDatabase();
      await withClient(db, (c) =>
        c.query(`CREATE TABLE ${MIGRATIONS_TABLE} (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`),
      );
      await assert.rejects(migrate({ connectionString: db.url }), /Both schema_migrations .* and buglab_schema_migrations exist/);
      assert.ok(!(await tables(db)).includes("account_learner_links"));
    });
  });

  describe("a table called schema_migrations that is NOT this application's", () => {
    test("another tool's table (a different shape, timestamp versions) is never renamed, read or changed", async () => {
      const db = await newDatabase();
      await withClient(db, async (c) => {
        await c.query("CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY)");
        await c.query("INSERT INTO schema_migrations VALUES (20240101000000), (20240215123000)");
      });

      const result = await migrate({ connectionString: db.url });

      assert.equal(result.applied.length, all().length, "all of this application's migrations apply, on their own table");
      await withClient(db, async (c) => {
        const foreign = (await c.query("SELECT version::text AS v FROM schema_migrations ORDER BY version")).rows.map((r) => r.v);
        assert.deepEqual(foreign, ["20240101000000", "20240215123000"], "untouched");
        assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${MIGRATIONS_TABLE}`)).rows[0].n, all().length);
      });
    });

    test("a lookalike with this runner's exact columns but another tool's version numbers is also left alone", async () => {
      const db = await newDatabase();
      await withClient(db, async (c) => {
        await c.query("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
        await c.query("INSERT INTO schema_migrations (version, checksum) VALUES ('20240101000000', 'x')");
      });

      const result = await migrate({ connectionString: db.url });

      assert.equal(result.applied.length, all().length);
      await withClient(db, async (c) => {
        assert.deepEqual((await c.query("SELECT version FROM schema_migrations")).rows, [{ version: "20240101000000" }]);
      });
    });
  });

  describe("migration 0003 on a database with real data", () => {
    test("existing learners keep their credentials and still satisfy the new all-or-nothing rule", async () => {
      const db = await legacyDevelopmentDatabase();
      await migrate({ connectionString: db.url, ...throughAccountLinks });
      await withClient(db, async (c) => {
        const row = (await c.query("SELECT token_hash, last_touched_at, idle_expires_at, absolute_expires_at FROM learners WHERE id = 'dev-learner'")).rows[0];
        assert.ok(row.token_hash && row.last_touched_at && row.idle_expires_at && row.absolute_expires_at);
      });
    });
  });
});
