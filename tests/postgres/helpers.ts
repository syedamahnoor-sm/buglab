/*
 * Helpers for the PostgreSQL integration tests. They need a REAL server: `npm run test:db`
 * provisions a throwaway one and sets BUGLAB_TEST_DATABASE_URL. Without that variable every
 * integration test is reported as skipped, with the reason, instead of passing vacuously.
 *
 * Each test FILE gets its own freshly created database (migrated with the real migration runner),
 * so files can run in parallel and never see each other's rows. The database is dropped afterwards.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrate } from "../../scripts/db-migrate.mjs";

export const TEST_DATABASE_URL = process.env.BUGLAB_TEST_DATABASE_URL;

/** Pass as `{ skip: SKIP }` to a describe/test: a reason string when no database is configured, otherwise false. */
export const SKIP: string | false = TEST_DATABASE_URL
  ? false
  : "BUGLAB_TEST_DATABASE_URL is not set; run `npm run test:db` to test against a real PostgreSQL";

export interface TestDatabase {
  /** Connection string for the fresh, migrated database. */
  readonly url: string;
  /** Connection string for the server's maintenance database, for tests that need the admin view. */
  readonly adminUrl: string;
  drop(): Promise<void>;
}

function withDatabase(base: string, name: string): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * Creates `buglab_test_<random>`, applies migrations, and returns how to reach and drop it.
 *
 * - `migrate: false` — empty database, no schema.
 * - `through: "0002_rate_limit_buckets"` — core anonymous schema only (no account_learner_links).
 * - `through` + `exclude` — up to a version, skipping named migrations. The Learning Loop path is
 *   `{ through: "0004_learning_reflections", exclude: ["0003_account_links"] }` (never 0003).
 * - default — every migration on disk, including optional 0003 when present.
 */
/**
 * TEST ONLY. Installs pgcrypto on a throwaway test database so Learning Loop activity digests work.
 * Production/ops must run `CREATE EXTENSION IF NOT EXISTS pgcrypto;` as a DBA step; the application
 * never installs the extension (see `PGCRYPTO_PROVISIONING_SQL` in learning-loop/postgres-store.ts).
 */
export async function ensureTestPgcrypto(pool: Pick<pg.Pool, "query">): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
}

export async function createTestDatabase(
  options: { migrate?: boolean; through?: string; exclude?: readonly string[] } = {},
): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error(SKIP as string);
  const name = `buglab_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(TEST_DATABASE_URL, name);
  if (options.migrate !== false) await migrate({ connectionString: url, through: options.through, exclude: options.exclude });

  return {
    url,
    adminUrl: TEST_DATABASE_URL,
    async drop() {
      const cleanup = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
