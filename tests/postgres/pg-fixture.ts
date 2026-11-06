/*
 * One shared, migrated database per test FILE, with pools and stores built on demand and closed in one place.
 * Not a test file itself (no `.test.ts` suffix), so the runner does not execute it.
 */
import { after } from "node:test";
import pg from "pg";
import { PostgresRateLimiter } from "@/server/db/postgres-rate-limiter";
import { PostgresStore, type PostgresStoreOptions } from "@/server/db/postgres-store";
import { createTestDatabase, type TestDatabase } from "./helpers";

export interface PgFixture {
  readonly db: TestDatabase;
  /** A new pool on the fixture database. Closed by the fixture. Each call is an independent set of connections. */
  newPool(max?: number): pg.Pool;
  newStore(options?: Omit<PostgresStoreOptions, "pool">, pool?: pg.Pool): PostgresStore;
  newLimiter(options?: { now?: () => number }, pool?: pg.Pool): PostgresRateLimiter;
  /** Runs one query on the fixture's shared pool, for assertions about what is really in the database. */
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<T>>;
  /** Empties every table, so the next test starts from nothing. */
  reset(): Promise<void>;
}

/** Creates the database lazily on first use and drops it when the file's tests are done. */
export function pgFixture(): () => Promise<PgFixture> {
  let pending: Promise<PgFixture> | undefined;
  const pools: pg.Pool[] = [];

  after(async () => {
    if (!pending) return;
    const fixture = await pending;
    await Promise.all(pools.filter((pool) => !pool.ended).map((pool) => pool.end()));
    await fixture.db.drop();
  });

  return () => {
    pending ??= (async () => {
      const db = await createTestDatabase();
      const newPool = (max = 10) => {
        const pool = new pg.Pool({ connectionString: db.url, max });
        pool.on("error", () => {});
        pools.push(pool);
        return pool;
      };
      const shared = newPool(20);
      return {
        db,
        newPool,
        newStore: (options = {}, pool = shared) => new PostgresStore({ pool, ...options }),
        newLimiter: (options = {}, pool = shared) => new PostgresRateLimiter({ pool, ...options }),
        query: (text, values) => shared.query(text, values),
        async reset() {
          await shared.query("TRUNCATE learners, rate_limit_buckets CASCADE");
        },
      };
    })();
    return pending;
  };
}
