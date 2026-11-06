/*
 * Migration 0004_learning_reflections (Learning Foundation Phase 1).
 *
 * APPLY PATH. scripts/db-migrate.mjs applies pending migrations in file order, so a bare
 * `--through 0004_learning_reflections` also applies optional account-linking migration 0003. The runner's
 * `exclude` option (CLI: `--exclude 0003_account_links`) is how the Learning Loop schema is applied WITHOUT 0003:
 *
 *   npm run db:migrate -- --through 0004_learning_reflections --exclude 0003_account_links
 *
 * These tests never apply anything to a shared database: createTestDatabase makes a throwaway one.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, describe, test } from "node:test";
import pg from "pg";
import { MigrationError, excludeArgs, migrate } from "../../scripts/db-migrate.mjs";
import { createTestDatabase, SKIP, type TestDatabase } from "./helpers";

const REFLECTIONS = "0004_learning_reflections";
const ACCOUNT_LINKS = "0003_account_links";
const CORE_THROUGH = "0002_rate_limit_buckets";
const databases: TestDatabase[] = [];
const clients: pg.Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end().catch(() => {})));
  await Promise.all(databases.splice(0).map((db) => db.drop()));
});

async function connect(db: TestDatabase): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: db.url });
  await client.connect();
  clients.push(client);
  return client;
}

/** The Learning Loop path: through 0004 with 0003 excluded. Never 0003. */
async function coreWithReflections() {
  const db = await createTestDatabase({ through: REFLECTIONS, exclude: [ACCOUNT_LINKS] });
  databases.push(db);
  return { db, client: await connect(db) };
}

let counter = 0;
const uid = (prefix: string) => `${prefix}-${++counter}`;

async function learner(client: pg.Client): Promise<string> {
  const id = uid("lrn");
  await client.query(
    `INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, 1, 1, 1, 10, 10)`,
    [id, String(counter).padStart(64, "0")],
  );
  return id;
}

async function completedSession(client: pg.Client, learnerId: string, challengeId: string): Promise<string> {
  const id = uid("ses");
  await client.query(
    `INSERT INTO challenge_sessions
       (id, learner_id, challenge_id, challenge_version, status, created_at, updated_at, completed_at, result)
     VALUES ($1, $2, $3, 'v1', 'completed', 1, 2, 2, '{"ok":true}'::jsonb)`,
    [id, learnerId, challengeId],
  );
  return id;
}

async function reflection(
  client: pg.Client,
  v: { learnerId: string; challengeId: string; sessionId: string; body?: string; createdAt?: number; deletedAt?: number | null },
): Promise<string> {
  const id = uid("ref");
  await client.query(
    `INSERT INTO learning_reflections
       (id, learner_id, challenge_id, challenge_session_id, body, created_at, updated_at, deleted_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 2)`,
    [id, v.learnerId, v.challengeId, v.sessionId, v.body ?? "what I learned", v.createdAt ?? 5, v.deletedAt ?? null],
  );
  return id;
}

const sqlState = (code: string) => (error: unknown) => (error as { code?: string }).code === code;
const FK_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";

describe("0004_learning_reflections migration", { skip: SKIP }, () => {
  test("creates learning_reflections and its indexes without requiring 0003", async () => {
    const { client } = await coreWithReflections();

    const present = await client.query(
      `SELECT to_regclass('public.learning_reflections') IS NOT NULL AS reflections,
              to_regclass('public.account_learner_links') IS NULL AS no_links`,
    );
    assert.equal(present.rows[0].reflections, true);
    assert.equal(present.rows[0].no_links, true);

    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    assert.ok(tables.rows.some((row) => row.table_name === "learning_reflections"));
    assert.ok(!tables.rows.some((row) => row.table_name === "account_learner_links"));

    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'learning_reflections'",
    );
    const active = indexes.rows.find((row) => row.indexname === "learning_reflections_active_uq");
    assert.ok(active, "partial unique index learning_reflections_active_uq exists");
    assert.match(active.indexdef, /UNIQUE/);
    assert.match(active.indexdef, /\(learner_id, challenge_id\)/);
    assert.match(active.indexdef, /WHERE \(deleted_at IS NULL\)/);
    assert.ok(indexes.rows.some((row) => row.indexname === "learning_reflections_learner_updated_idx"));

    const unique = await client.query(
      "SELECT 1 FROM pg_constraint WHERE conname = 'challenge_sessions_id_learner_challenge_uq' AND contype = 'u'",
    );
    assert.equal(unique.rowCount, 1);

    const versions = (
      await client.query<{ version: string }>("SELECT version FROM buglab_schema_migrations ORDER BY version")
    ).rows.map((row) => row.version);
    assert.deepEqual(versions, ["0001_learner_sessions", "0002_rate_limit_buckets", REFLECTIONS]);
  });

  test("apply path: --through 0004 --exclude 0003 applies 0004 without 0003 and leaves 0003 pending", async () => {
    const core = await createTestDatabase({ through: CORE_THROUGH });
    databases.push(core);
    const client = await connect(core);
    const names = async () =>
      (await client.query<{ n: string }>("SELECT tablename AS n FROM pg_tables WHERE schemaname = 'public'")).rows.map(
        (row) => row.n,
      );
    assert.ok(!(await names()).includes("learning_reflections"));
    assert.ok(!(await names()).includes("account_learner_links"));

    // A status run reports exactly what the real run would do.
    const status = await migrate({ connectionString: core.url, dryRun: true, through: REFLECTIONS, exclude: [ACCOUNT_LINKS] });
    assert.deepEqual(status.applied, [REFLECTIONS]);

    const { applied } = await migrate({ connectionString: core.url, through: REFLECTIONS, exclude: [ACCOUNT_LINKS] });
    assert.deepEqual(applied, [REFLECTIONS]);
    assert.ok((await names()).includes("learning_reflections"));
    assert.ok(!(await names()).includes("account_learner_links"), "account_learner_links must stay absent");

    // Re-running is a no-op, and 0003 is still not applied.
    const again = await migrate({ connectionString: core.url, through: REFLECTIONS, exclude: [ACCOUNT_LINKS] });
    assert.deepEqual(again.applied, []);
    assert.ok(!(await names()).includes("account_learner_links"));

    // 0003 was only skipped, never recorded: a later run without the exclusion still applies it.
    // 0005 is a later migration, so that same unrestricted run applies it too.
    const later = await migrate({ connectionString: core.url });
    assert.deepEqual(later.applied, [ACCOUNT_LINKS, "0005_diagnosis_submission_claims"]);
    assert.ok((await names()).includes("account_learner_links"));
    assert.ok((await names()).includes("diagnosis_submission_claims"));
  });

  test("regression: without --exclude, --through 0004 still applies 0003 first (migrations apply in order)", async () => {
    const core = await createTestDatabase({ through: CORE_THROUGH });
    databases.push(core);
    const { applied } = await migrate({ connectionString: core.url, through: REFLECTIONS });
    assert.deepEqual(applied, [ACCOUNT_LINKS, REFLECTIONS]);
  });

  test("the CLI accepts --exclude and reports it; 0003 stays absent", async () => {
    const core = await createTestDatabase({ through: CORE_THROUGH });
    databases.push(core);
    const run = spawnSync(
      process.execPath,
      ["scripts/db-migrate.mjs", "--through", REFLECTIONS, "--exclude", ACCOUNT_LINKS],
      { env: { ...process.env, BUGLAB_DATABASE_URL_DIRECT: core.url }, encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`applied: ${REFLECTIONS}\\b`));
    assert.match(run.stdout, new RegExp(`excluded: ${ACCOUNT_LINKS}`));
    const client = await connect(core);
    const { rows } = await client.query("SELECT to_regclass('public.account_learner_links') IS NULL AS absent");
    assert.equal(rows[0].absent, true);
  });

  test("completed sessions are immutable in the database: status, completed_at and result cannot change", async () => {
    const { client } = await coreWithReflections();
    const learnerId = await learner(client);
    const sessionId = await completedSession(client, learnerId, "challenge-001");
    const unchanged = async () =>
      (await client.query("SELECT status, completed_at, result FROM challenge_sessions WHERE id = $1", [sessionId])).rows[0];
    const before = await unchanged();
    assert.equal(before.status, "completed");

    const refused = (error: unknown) => (error as { code?: string }).code === RESTRICT_VIOLATION;
    // Even a statement that satisfies 0001's own CHECKs (completed <=> completed_at/result present) is refused.
    await assert.rejects(client.query("UPDATE challenge_sessions SET completed_at = 99 WHERE id = $1", [sessionId]), refused);
    await assert.rejects(
      client.query(`UPDATE challenge_sessions SET result = '{"ok":false}'::jsonb WHERE id = $1`, [sessionId]),
      refused,
    );
    await assert.rejects(
      client.query("UPDATE challenge_sessions SET status = 'active', completed_at = NULL, result = NULL WHERE id = $1", [sessionId]),
      refused,
    );
    assert.deepEqual(await unchanged(), before);

    // Everything else stays writable (the trigger guards only the completion), and unfinished sessions are not affected.
    await client.query("UPDATE challenge_sessions SET updated_at = 77, revision = revision + 1 WHERE id = $1", [sessionId]);
    const open = uid("ses");
    await client.query(
      `INSERT INTO challenge_sessions (id, learner_id, challenge_id, challenge_version, status, created_at, updated_at)
       VALUES ($1, $2, 'challenge-002', 'v1', 'active', 1, 1)`,
      [open, learnerId],
    );
    await client.query(
      `UPDATE challenge_sessions SET status = 'completed', completed_at = 5, result = '{"ok":true}'::jsonb WHERE id = $1`,
      [open],
    );
  });

  test("an unknown or malformed --exclude is refused before anything runs", async () => {
    await assert.rejects(
      migrate({ connectionString: "postgres://unused.invalid/none", exclude: ["9999_nothing"] }),
      (error: unknown) => error instanceof MigrationError && /Unknown --exclude migration "9999_nothing"/.test(error.message),
    );
    assert.deepEqual(excludeArgs(["--exclude", `${ACCOUNT_LINKS},0002_rate_limit_buckets`, "--exclude", REFLECTIONS]), [
      ACCOUNT_LINKS,
      "0002_rate_limit_buckets",
      REFLECTIONS,
    ]);
    assert.throws(() => excludeArgs(["--exclude"]), MigrationError);
    assert.throws(() => excludeArgs(["--exclude", "--status"]), MigrationError);
  });

  test("composite ownership FK accepts a matching learner, challenge and session", async () => {
    const { client } = await coreWithReflections();
    const learnerId = await learner(client);
    const sessionId = await completedSession(client, learnerId, "challenge-001");
    await reflection(client, { learnerId, challengeId: "challenge-001", sessionId });
    assert.equal((await client.query("SELECT count(*)::int AS n FROM learning_reflections")).rows[0].n, 1);
  });

  test("composite ownership FK rejects another learner's session or a different challenge", async () => {
    const { client } = await coreWithReflections();
    const owner = await learner(client);
    const other = await learner(client);
    const sessionId = await completedSession(client, owner, "challenge-001");

    await assert.rejects(
      reflection(client, { learnerId: other, challengeId: "challenge-001", sessionId }),
      sqlState(FK_VIOLATION),
    );
    await assert.rejects(
      reflection(client, { learnerId: owner, challengeId: "challenge-002", sessionId }),
      sqlState(FK_VIOLATION),
    );
    await assert.rejects(
      reflection(client, { learnerId: owner, challengeId: "challenge-001", sessionId: "missing-session" }),
      sqlState(FK_VIOLATION),
    );
    assert.equal((await client.query("SELECT count(*)::int AS n FROM learning_reflections")).rows[0].n, 0);
  });

  test("at most one active reflection per learner and challenge; soft delete frees the slot", async () => {
    const { client } = await coreWithReflections();
    const learnerId = await learner(client);
    const sessionId = await completedSession(client, learnerId, "challenge-001");
    const first = await reflection(client, { learnerId, challengeId: "challenge-001", sessionId });

    await assert.rejects(
      reflection(client, { learnerId, challengeId: "challenge-001", sessionId }),
      sqlState(UNIQUE_VIOLATION),
    );

    // A different challenge is independent.
    const otherSession = await completedSession(client, learnerId, "challenge-002");
    await reflection(client, { learnerId, challengeId: "challenge-002", sessionId: otherSession });

    await client.query("UPDATE learning_reflections SET deleted_at = 9 WHERE id = $1", [first]);
    await reflection(client, { learnerId, challengeId: "challenge-001", sessionId });
    const rows = await client.query(
      "SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS active, count(*)::int AS total FROM learning_reflections WHERE challenge_id = 'challenge-001'",
    );
    assert.deepEqual(rows.rows[0], { active: 1, total: 2 });
  });

  test("body, revision, id and deleted_at constraints are enforced", async () => {
    const { client } = await coreWithReflections();
    const learnerId = await learner(client);
    const sessionId = await completedSession(client, learnerId, "challenge-001");
    const base = { learnerId, sessionId };

    await assert.rejects(reflection(client, { ...base, challengeId: "challenge-001", body: "" }), sqlState(CHECK_VIOLATION));
    await assert.rejects(
      reflection(client, { ...base, challengeId: "challenge-001", body: "x".repeat(16385) }),
      sqlState(CHECK_VIOLATION),
    );
    await assert.rejects(
      reflection(client, { ...base, challengeId: "challenge-001", createdAt: 10, deletedAt: 9 }),
      sqlState(CHECK_VIOLATION),
    );
    const maxBody = await reflection(client, { ...base, challengeId: "challenge-001", body: "x".repeat(16384) });
    await assert.rejects(
      client.query("UPDATE learning_reflections SET revision = 0 WHERE id = $1", [maxBody]),
      sqlState(CHECK_VIOLATION),
    );
    // The 16384-byte limit is in OCTETS: 8193 two-byte characters is 16386 bytes.
    await assert.rejects(
      reflection(client, { ...base, challengeId: "challenge-001", body: "é".repeat(8193) }),
      sqlState(CHECK_VIOLATION),
    );
  });

  test("deleting a learner removes its reflections; a session with a reflection cannot be deleted alone", async () => {
    const { client } = await coreWithReflections();
    const learnerId = await learner(client);
    const sessionId = await completedSession(client, learnerId, "challenge-001");
    await reflection(client, { learnerId, challengeId: "challenge-001", sessionId });

    await assert.rejects(
      client.query("DELETE FROM challenge_sessions WHERE id = $1", [sessionId]),
      sqlState(FK_VIOLATION),
    );
    await client.query("DELETE FROM learners WHERE id = $1", [learnerId]);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM learning_reflections")).rows[0].n, 0);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM challenge_sessions")).rows[0].n, 0);
  });
});
