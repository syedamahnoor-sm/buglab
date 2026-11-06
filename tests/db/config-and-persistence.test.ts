/*
 * Database configuration and the persistence wiring, without needing a database to be running. Nothing here
 * opens a connection that succeeds: pools are built against an address nothing listens on, which also shows
 * that building one connects to nothing.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_POOL_MAX, DatabaseConfigError, readDatabaseConfig } from "@/server/db/config";
import {
  REQUIRED_MIGRATION,
  SchemaOutOfDateError,
  createPostgresPersistence,
  startPeriodicPurge,
  type PurgeSummary,
} from "@/server/db/persistence";

const MIGRATIONS = join(fileURLToPath(new URL("../../", import.meta.url)), "db", "migrations");
// Nothing listens on port 1.
const UNREACHABLE = "postgres://app_user:s3cretpw@127.0.0.1:1/buglab";

describe("readDatabaseConfig", () => {
  test("reads the pooled runtime URL and defaults the pool size", () => {
    const config = readDatabaseConfig({ BUGLAB_DATABASE_URL: UNREACHABLE });
    assert.equal(config.connectionString, UNREACHABLE);
    assert.equal(config.poolMax, DEFAULT_POOL_MAX);
    assert.equal(Object.isFrozen(config), true);
  });

  test("accepts postgres:// and postgresql://, and trims whitespace", () => {
    assert.equal(readDatabaseConfig({ BUGLAB_DATABASE_URL: `  ${UNREACHABLE}  ` }).connectionString, UNREACHABLE);
    assert.doesNotThrow(() => readDatabaseConfig({ BUGLAB_DATABASE_URL: "postgresql://u:p@host.example/db?sslmode=require" }));
  });

  test("a missing, blank or malformed URL is refused, and the message never contains the value", () => {
    for (const value of [undefined, "", "   "]) {
      assert.throws(() => readDatabaseConfig({ BUGLAB_DATABASE_URL: value }), (e: Error) => e instanceof DatabaseConfigError && /BUGLAB_DATABASE_URL is not set/.test(e.message));
    }
    for (const value of ["not a url", "mysql://u:topsecret@host/db", "http://u:topsecret@host/db", "file:///etc/passwd"]) {
      assert.throws(
        () => readDatabaseConfig({ BUGLAB_DATABASE_URL: value }),
        (error: Error) => error instanceof DatabaseConfigError && !error.message.includes("topsecret") && !error.message.includes(value),
        value,
      );
    }
  });

  test("the pool size is a whole number from 1 to 100", () => {
    assert.equal(readDatabaseConfig({ BUGLAB_DATABASE_URL: UNREACHABLE, BUGLAB_DATABASE_POOL_MAX: " 12 " }).poolMax, 12);
    assert.equal(readDatabaseConfig({ BUGLAB_DATABASE_URL: UNREACHABLE, BUGLAB_DATABASE_POOL_MAX: "" }).poolMax, DEFAULT_POOL_MAX);
    for (const value of ["0", "-1", "101", "1.5", "ten", "1e1", "0x5"]) {
      assert.throws(() => readDatabaseConfig({ BUGLAB_DATABASE_URL: UNREACHABLE, BUGLAB_DATABASE_POOL_MAX: value }), /BUGLAB_DATABASE_POOL_MAX/, value);
    }
  });

  test("never reads the direct (migration) URL: the running application cannot use it by accident", () => {
    const config = readDatabaseConfig({ BUGLAB_DATABASE_URL: UNREACHABLE, BUGLAB_DATABASE_URL_DIRECT: "postgres://direct/db" });
    assert.equal(config.connectionString, UNREACHABLE);
    assert.deepEqual(Object.keys(config).sort(), ["connectionString", "poolMax"]);
  });
});

describe("createPostgresPersistence", () => {
  test("building it opens no connection, and closing is safe to repeat", async () => {
    const persistence = createPostgresPersistence({ config: { connectionString: UNREACHABLE, poolMax: 2 } });
    assert.equal(persistence.pool.totalCount, 0, "nothing connected at construction");
    await persistence.close();
    await persistence.close();
    assert.equal(persistence.pool.ended, true);
  });

  test("an unreachable database fails a query with a connection error and does not crash the process", async () => {
    const persistence = createPostgresPersistence({ config: { connectionString: UNREACHABLE, poolMax: 1 } });
    try {
      await assert.rejects(persistence.verifySchema(), (error: Error) => !(error instanceof SchemaOutOfDateError));
    } finally {
      await persistence.close();
    }
  });

  test("an error on an IDLE pooled connection is absorbed instead of becoming an uncaught exception", async () => {
    const persistence = createPostgresPersistence({ config: { connectionString: UNREACHABLE, poolMax: 1 } });
    try {
      assert.ok(persistence.pool.listenerCount("error") >= 1);
      assert.doesNotThrow(() => persistence.pool.emit("error", new Error("terminating connection due to administrator command")));
    } finally {
      await persistence.close();
    }
  });

  test("REQUIRED_MIGRATION is a core migration on disk; verifySchema stops at 0002", () => {
    const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort();
    assert.ok(files.includes(`${REQUIRED_MIGRATION}.sql`), "core persistence must name a migration that exists");
    assert.ok(files.includes("0001_learner_sessions.sql"));
    assert.ok(files.includes("0002_rate_limit_buckets.sql"));
    assert.equal(REQUIRED_MIGRATION, "0002_rate_limit_buckets", "core verifySchema stops at 0002; 0003 is optional and not required here");
    // Optional later account-linking migration may exist locally or in a follow-up PR; core must not require it.
    if (files.includes("0003_account_links.sql")) {
      assert.ok(files.indexOf("0003_account_links.sql") > files.indexOf("0002_rate_limit_buckets.sql"));
    }
    // Learning Loop 0004 is also optional for core; it has its own verifyLearningLoopSchema gate.
    if (files.includes("0004_learning_reflections.sql")) {
      assert.ok(files.indexOf("0004_learning_reflections.sql") > files.indexOf("0002_rate_limit_buckets.sql"));
    }
    if (files.includes("0005_diagnosis_submission_claims.sql")) {
      assert.ok(files.indexOf("0005_diagnosis_submission_claims.sql") > files.indexOf("0002_rate_limit_buckets.sql"));
    }

    const persistenceSource = readFileSync(join(fileURLToPath(new URL("../../", import.meta.url)), "src/server/db/persistence.ts"), "utf8");
    const verifyStart = persistenceSource.indexOf("async verifySchema()");
    const verifyEnd = persistenceSource.indexOf("async purgeExpired()");
    const verifyBody = persistenceSource.slice(verifyStart, verifyEnd);
    assert.match(verifyBody, /REQUIRED_MIGRATION/);
    assert.doesNotMatch(verifyBody, /verifySubmissionClaimsSchema|0005_diagnosis_submission_claims/);
    assert.match(persistenceSource, /export async function verifySubmissionClaimsSchema/);
  });
});

describe("startPeriodicPurge", () => {
  const SUMMARY: PurgeSummary = { learners: 1, rateLimitBuckets: 2 };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test("purges at once, then repeatedly, until stopped", async () => {
    let runs = 0;
    const seen: PurgeSummary[] = [];
    const stop = startPeriodicPurge(
      { purgeExpired: async () => { runs += 1; return SUMMARY; } },
      { intervalMs: 30, onPurge: (summary) => seen.push(summary) },
    );
    await sleep(140);
    stop();
    const atStop = runs;
    assert.ok(atStop >= 3, `ran repeatedly (${atStop})`);
    assert.deepEqual(seen[0], SUMMARY);
    await sleep(100);
    assert.equal(runs, atStop, "and not at all after stop()");
  });

  test("a failing purge is reported and never stops the schedule", async () => {
    let runs = 0;
    const errors: unknown[] = [];
    const stop = startPeriodicPurge(
      { purgeExpired: async () => { runs += 1; if (runs === 1) throw new Error("transient"); return SUMMARY; } },
      { intervalMs: 30, onError: (error) => errors.push(error) },
    );
    await sleep(120);
    stop();
    assert.equal(errors.length, 1);
    assert.ok(runs >= 2, "it carried on after the failure");
  });

  test("a purge that is still running is not overlapped by the next tick", async () => {
    let concurrent = 0;
    let peak = 0;
    const stop = startPeriodicPurge(
      {
        purgeExpired: async () => {
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          await sleep(80);
          concurrent -= 1;
          return SUMMARY;
        },
      },
      { intervalMs: 20 },
    );
    await sleep(250);
    stop();
    await sleep(100);
    assert.equal(peak, 1);
  });

  test("works without callbacks (nothing is logged by default) and rejects a nonsense interval", () => {
    const stop = startPeriodicPurge({ purgeExpired: async () => { throw new Error("ignored"); } }, { intervalMs: 1000 });
    stop();
    for (const intervalMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => startPeriodicPurge({ purgeExpired: async () => SUMMARY }, { intervalMs }), RangeError, String(intervalMs));
    }
  });
});
