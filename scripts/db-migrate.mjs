/*
 * Versioned SQL migrations for the durable learner-session store.
 *
 *   npm run db:migrate            apply every pending migration in db/migrations
 *   npm run db:migrate -- --status   list applied and pending migrations, change nothing
 *   npm run db:migrate -- --through 0002_rate_limit_buckets
 *                                 apply pending migrations only up to and including that version
 *                                 (core anonymous persistence needs 0001 and 0002; 0003 is account linking)
 *   npm run db:migrate -- --through 0004_learning_reflections --exclude 0003_account_links
 *                                 the Learning Loop path: applies 0004 WITHOUT the optional 0003 (account linking).
 *                                 --exclude skips the named pending migration(s); repeat the flag or comma-separate.
 *                                 Without --exclude, --through 0004 applies 0003 as well (migrations apply in order).
 *
 * CONNECTION. Migrations use a DIRECT connection, never the pooled runtime one:
 *
 *   BUGLAB_DATABASE_URL_DIRECT   a direct (unpooled) PostgreSQL connection string
 *
 * A pooler in transaction mode does not keep one session for the whole run, which breaks the
 * advisory lock below and DDL that expects one. The runtime application uses BUGLAB_DATABASE_URL
 * (pooled) instead. Neither value is ever printed, logged or written anywhere by this script.
 *
 * SAFETY.
 *   * One run at a time: a session advisory lock makes concurrent runners (two deploys, two
 *     instances) wait for each other instead of racing.
 *   * Each migration runs in its own transaction together with the row that records it, so it is
 *     applied completely or not at all.
 *   * An applied migration is identified by its file name and the SHA-256 of its text (line endings
 *     normalised, so a Windows checkout matches a Linux one). If an applied file has changed, or the
 *     database holds a migration this checkout does not have, the run stops and changes nothing.
 *     Fix the schema with a NEW migration, never by editing an old one.
 *
 * Migration files are plain SQL named NNNN_description.sql. They must not contain a top-level BEGIN or COMMIT
 * (a BEGIN inside a dollar-quoted function body is fine).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

/** The table that records which migrations have run. Named for the application, so it cannot collide with another tool's. */
export const MIGRATIONS_TABLE = "buglab_schema_migrations";
/** What this table was called before it was renamed. Only ever renamed, and only when it is provably this application's. */
export const LEGACY_MIGRATIONS_TABLE = "schema_migrations";

const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const OUR_VERSION = /^\d{4}_[a-z0-9_]+$/;
// An arbitrary constant, shared by every runner of this application, naming its migration lock.
const LOCK_KEY = 7_417_240_001;

export class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationError";
  }
}

const checksumOf = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

/**
 * The migrations on disk, in order.
 *
 * @param {string} [dir]
 * @returns {{ version: string, name: string, checksum: string, sql: string }[]}
 */
export function readMigrations(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
  const seen = new Set();
  return files.map((file) => {
    const match = FILE_NAME.exec(file);
    if (!match) throw new MigrationError(`Migration file "${file}" must be named NNNN_description.sql.`);
    if (seen.has(match[1])) throw new MigrationError(`Two migrations share the number ${match[1]}.`);
    seen.add(match[1]);
    const sql = readFileSync(join(dir, file), "utf8");
    // Only top-level statements count: a plpgsql body (dollar-quoted) legitimately starts with BEGIN.
    const topLevel = sql.replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, "");
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/im.test(topLevel)) {
      throw new MigrationError(`Migration "${file}" must not manage its own transaction.`);
    }
    return { version: file.slice(0, -".sql".length), name: match[2], checksum: checksumOf(sql), sql };
  });
}


async function tableExists(client, name) {
  return (await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [name])).rows[0].present;
}

/**
 * Whether `schema_migrations` is this application's own old table, and not some other tool's table of the same name.
 * Both must hold: the exact columns this runner created (version, checksum, applied_at), and every recorded version in
 * this application's NNNN_name form. An empty table of that shape is ours too. Anything else is left strictly alone.
 */
async function legacyTableIsOurs(client) {
  const columns = (
    await client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = to_regclass($1))
          AND table_name = $1
        ORDER BY column_name`,
      [LEGACY_MIGRATIONS_TABLE],
    )
  ).rows;
  const shape = JSON.stringify(columns.map((column) => [column.column_name, column.data_type, column.is_nullable]));
  const expected = JSON.stringify([
    ["applied_at", "timestamp with time zone", "NO"],
    ["checksum", "text", "NO"],
    ["version", "text", "NO"],
  ]);
  if (shape !== expected) return false;
  const { rows } = await client.query(`SELECT version FROM ${LEGACY_MIGRATIONS_TABLE}`);
  return rows.every((row) => OUR_VERSION.test(row.version));
}

/**
 * Applies every pending migration, optionally only up to `through` (inclusive). Returns
 * { applied, alreadyApplied }, each a list of versions. `dryRun` reports what would be applied and
 * changes nothing (no table is even created).
 *
 * Core anonymous persistence needs 0001 and 0002. Migration 0003 (account linking) is optional: leave
 * it pending until that milestone is approved, then run without `--through` (or with
 * `--through 0003_account_links`) so it applies. Already-applied migrations are never re-run; checksums
 * are still verified for every recorded version this checkout knows.
 *
 * `exclude` names pending migrations to SKIP, so a later one can be applied without an earlier optional
 * one. The Learning Loop schema (0004) needs only 0001, so it is applied with
 * `{ through: "0004_learning_reflections", exclude: ["0003_account_links"] }`. An excluded migration is
 * left pending (never recorded) and is applied by a later run that does not exclude it.
 *
 * @param {{ connectionString?: string, dir?: string, dryRun?: boolean, through?: string, exclude?: readonly string[] }} [options]
 * @returns {Promise<{ applied: string[], alreadyApplied: string[] }>}
 */
export async function migrate({ connectionString, dir = MIGRATIONS_DIR, dryRun = false, through, exclude = [] } = {}) {
  if (typeof connectionString !== "string" || connectionString === "") {
    throw new MigrationError("A direct connection string is required (BUGLAB_DATABASE_URL_DIRECT).");
  }
  const migrations = readMigrations(dir);
  const known = migrations.map((migration) => migration.version);
  if (through !== undefined) {
    if (typeof through !== "string" || !known.includes(through)) {
      throw new MigrationError(`Unknown --through migration "${through}". Expected one of: ${known.join(", ")}.`);
    }
  }
  if (!Array.isArray(exclude)) throw new MigrationError("exclude must be a list of migration versions.");
  for (const version of exclude) {
    if (typeof version !== "string" || !known.includes(version)) {
      throw new MigrationError(`Unknown --exclude migration "${version}". Expected one of: ${known.join(", ")}.`);
    }
  }
  const excluded = new Set(exclude);
  const client = new pg.Client({ connectionString });
  client.on("error", () => {});
  try {
    await client.connect();
  } catch (error) {
    // The message of a connection error can include the host, never the password, but say nothing more than needed.
    throw new MigrationError(`Could not connect to the database (${error?.code ?? "no code"}).`);
  }

  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);

    // Where this run reads what has been applied. Normally the current table. For a development database from before the
    // rename it is the legacy table, which is validated FIRST and then renamed in place (never copied), unless this is
    // only a status check. A table that is not provably this application's is never touched, renamed or read.
    let source = MIGRATIONS_TABLE;
    let renameLegacy = false;
    if ((await tableExists(client, LEGACY_MIGRATIONS_TABLE)) && (await legacyTableIsOurs(client))) {
      if (await tableExists(client, MIGRATIONS_TABLE)) {
        throw new MigrationError(
          `Both ${LEGACY_MIGRATIONS_TABLE} (this application's old table) and ${MIGRATIONS_TABLE} exist. Nothing was changed. ` +
            `Compare them and drop the one that is wrong.`,
        );
      }
      source = LEGACY_MIGRATIONS_TABLE;
      renameLegacy = !dryRun;
    }

    const sourceExists = await tableExists(client, source);
    if (!sourceExists && !dryRun) {
      await client.query(`CREATE TABLE ${MIGRATIONS_TABLE} (
        version    TEXT        PRIMARY KEY,
        checksum   TEXT        NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    }
    const recorded = sourceExists || !dryRun
      ? (await client.query(`SELECT version, checksum FROM ${source} ORDER BY version`)).rows
      : [];

    const onDisk = new Map(migrations.map((migration) => [migration.version, migration]));
    for (const row of recorded) {
      const known = onDisk.get(row.version);
      if (!known) {
        throw new MigrationError(`The database has migration ${row.version}, which this checkout does not contain. Nothing was changed.`);
      }
      if (known.checksum !== row.checksum) {
        throw new MigrationError(`Migration ${row.version} was changed after it was applied. Revert it and add a new migration instead. Nothing was changed.`);
      }
    }

    // Only now, with every recorded migration checked, is the legacy table renamed.
    if (renameLegacy) {
      await client.query("BEGIN");
      try {
        await client.query(`ALTER TABLE ${LEGACY_MIGRATIONS_TABLE} RENAME TO ${MIGRATIONS_TABLE}`);
        // The primary key, and on PostgreSQL 18 and later the NOT NULL constraints, are named objects that carry the old
        // table name. Rename each, so no trace of the generic name is left. The names are generated by PostgreSQL, never input.
        const { rows: constraints } = await client.query(
          "SELECT conname FROM pg_constraint WHERE conrelid = to_regclass($1) AND conname LIKE $2",
          [MIGRATIONS_TABLE, `${LEGACY_MIGRATIONS_TABLE}\\_%`],
        );
        for (const { conname } of constraints) {
          const renamed = `${MIGRATIONS_TABLE}${conname.slice(LEGACY_MIGRATIONS_TABLE.length)}`;
          await client.query(`ALTER TABLE ${MIGRATIONS_TABLE} RENAME CONSTRAINT "${conname}" TO "${renamed}"`);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw new MigrationError(`Renaming ${LEGACY_MIGRATIONS_TABLE} to ${MIGRATIONS_TABLE} failed and was rolled back: ${error?.message ?? "unknown error"}`);
      }
    }

    const done = new Set(recorded.map((row) => row.version));
    const applied = [];
    for (const migration of migrations) {
      if (through !== undefined && migration.version > through) break;
      if (done.has(migration.version) || excluded.has(migration.version)) continue;
      if (!dryRun) {
        try {
          await client.query("BEGIN");
          await client.query(migration.sql);
          await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (version, checksum) VALUES ($1, $2)`, [migration.version, migration.checksum]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw new MigrationError(`Migration ${migration.version} failed and was rolled back: ${error?.message ?? "unknown error"}`);
        }
      }
      applied.push(migration.version);
    }
    return { applied, alreadyApplied: [...done] };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    await client.end().catch(() => {});
  }
}

function throughArg(argv) {
  const index = argv.indexOf("--through");
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw new MigrationError("--through requires a migration version (for example 0002_rate_limit_buckets).");
  }
  return value;
}

/** Every `--exclude` value; the flag may repeat and each value may be comma-separated. */
export function excludeArgs(argv) {
  const versions = [];
  argv.forEach((arg, index) => {
    if (arg !== "--exclude") return;
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new MigrationError("--exclude requires a migration version (for example 0003_account_links).");
    }
    versions.push(...value.split(",").map((part) => part.trim()).filter(Boolean));
  });
  return versions;
}

async function main() {
  const dryRun = process.argv.includes("--status");
  try {
    const through = throughArg(process.argv);
    const exclude = excludeArgs(process.argv);
    const { applied, alreadyApplied } = await migrate({
      connectionString: process.env.BUGLAB_DATABASE_URL_DIRECT,
      dryRun,
      through,
      exclude,
    });
    const verb = dryRun ? "pending" : "applied";
    process.stdout.write(`already applied: ${alreadyApplied.length === 0 ? "none" : alreadyApplied.join(", ")}\n`);
    process.stdout.write(`${verb}: ${applied.length === 0 ? "none" : applied.join(", ")}\n`);
    if (through) process.stdout.write(`through: ${through}\n`);
    if (exclude.length > 0) process.stdout.write(`excluded: ${exclude.join(", ")}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Migration failed."}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
