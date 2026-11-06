/*
 * PostgreSQL-backed DistributedRateLimiter. Server-only.
 *
 * The counters live in the rate_limit_buckets table, so a limit holds across every application instance
 * that shares the database and across restarts. See src/server/ratelimit/types.ts for the algorithm (a
 * fixed window per scope and key) and its one known property (up to twice the limit across a window
 * boundary).
 *
 * ATOMICITY. consume() is ONE statement: an INSERT ... ON CONFLICT DO UPDATE on the (scope, key) row. The
 * first hit inserts the row; any concurrent hit conflicts on it and waits for the row lock, then updates
 * the committed value. So N simultaneous hits yield exactly the counts 1..N, never a lost update and never
 * more than `limit` admitted per window, however many instances send them. There is no read-then-write
 * for another request to slip between, and no application-side lock.
 *
 * THE WINDOW. A window runs from window_started_at to expires_at, both from the DATABASE clock. A hit at
 * or after expires_at starts a new window in the same row, so an expired row never needs purging for the
 * limiter to be right. A refused hit leaves the window's end alone, and the counter is capped at limit + 1,
 * so retrying cannot extend a lockout and the counter cannot grow without bound.
 *
 * PURGE. purgeExpired() deletes rows whose window has ended, in batches, skipping rows another purge holds.
 *
 * `now` in the options is for TESTS ONLY; it replaces the database clock.
 */
import "server-only";
import type pg from "pg";
import {
  assertRateLimitInput,
  toRateLimitResult,
  type DistributedRateLimiter,
  type RateLimitPolicy,
  type RateLimitResult,
} from "@/server/ratelimit/types";
import { DB_NOW_MS_SQL, toNumber } from "./sql";

export interface PostgresRateLimiterOptions {
  /** A pool built from the pooled runtime connection string. The caller owns it and closes it. */
  pool: pg.Pool;
  /** TEST ONLY. Replaces the database clock, in milliseconds since the epoch. */
  now?: () => number;
}

const PURGE_BATCH = 1_000;

export class PostgresRateLimiter implements DistributedRateLimiter {
  private readonly pool: pg.Pool;
  private readonly clock: (() => number) | undefined;

  constructor({ pool, now }: PostgresRateLimiterOptions) {
    this.pool = pool;
    this.clock = now;
  }

  private nowSql(values: unknown[]): string {
    if (this.clock) {
      values.push(this.clock());
      return `$${values.length}::bigint`;
    }
    return DB_NOW_MS_SQL;
  }

  async consume(scope: string, key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    assertRateLimitInput(scope, key, policy);
    // $4 is limit + 1: the counter is capped there, which is already "over the limit".
    const values: unknown[] = [scope, key, policy.windowMs, policy.limit + 1];
    const nowSql = this.nowSql(values);

    const { rows } = await this.pool.query<{ hits: number; expires_at: string; now: string }>(
      `WITH clock AS (SELECT ${nowSql} AS now)
       INSERT INTO rate_limit_buckets AS b (scope, bucket_key, window_started_at, hits, expires_at)
       SELECT $1::text, $2::text, clock.now, 1, clock.now + $3::bigint FROM clock
       ON CONFLICT (scope, bucket_key) DO UPDATE SET
         hits = CASE WHEN b.expires_at <= EXCLUDED.window_started_at THEN 1 ELSE LEAST(b.hits + 1, $4::int) END,
         window_started_at = CASE WHEN b.expires_at <= EXCLUDED.window_started_at THEN EXCLUDED.window_started_at ELSE b.window_started_at END,
         expires_at = CASE WHEN b.expires_at <= EXCLUDED.window_started_at THEN EXCLUDED.expires_at ELSE b.expires_at END
       RETURNING b.hits, b.expires_at, (SELECT now FROM clock) AS now`,
      values,
    );
    const row = rows[0];
    return toRateLimitResult(row.hits, policy.limit, toNumber(row.expires_at), toNumber(row.now));
  }

  async purgeExpired(): Promise<number> {
    let removed = 0;
    for (;;) {
      const values: unknown[] = [PURGE_BATCH];
      const nowSql = this.nowSql(values);
      const { rowCount } = await this.pool.query(
        `DELETE FROM rate_limit_buckets
          WHERE (scope, bucket_key) IN (
            SELECT scope, bucket_key FROM rate_limit_buckets
             WHERE expires_at <= ${nowSql}
             ORDER BY expires_at
             LIMIT $1
               FOR UPDATE SKIP LOCKED)`,
        values,
      );
      removed += rowCount ?? 0;
      if ((rowCount ?? 0) < PURGE_BATCH) return removed;
    }
  }
}
