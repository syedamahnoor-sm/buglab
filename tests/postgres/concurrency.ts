/*
 * Helpers for tests that need REAL simultaneous requests against PostgreSQL. Not a test file.
 *
 * A race that only fails on an unlucky schedule proves little. An earlier version of the multi-instance tests
 * passed even with the row locks deleted, because cold connection pools staggered the requests so they never
 * overlapped. So races here (a) start from warmed pools, and (b) go through `stampede`, which holds the contended
 * row's lock while every contender is already in flight. With correct locking they queue and then run one at a
 * time. With the locking removed they all run at once on a stale view, which breaks the assertions every time.
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";

/** Opens every connection a pool may use, so a race starts with all of them ready rather than staggered by connection setup. */
export async function warm(pool: Pool, connections = 10): Promise<void> {
  await Promise.all(Array.from({ length: connections }, () => pool.query("SELECT pg_sleep(0.05)")));
}

/**
 * A stampede. Holds `lockSql` (a SELECT ... FOR UPDATE, or a LOCK TABLE, on what everyone will fight over) in an open
 * transaction, starts every contender while it is held, lets them all get in flight, then lets go.
 */
export async function stampede<T>(
  pool: Pool,
  lockSql: string,
  lockValues: unknown[],
  launch: () => Promise<T>[],
): Promise<PromiseSettledResult<T>[]> {
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(lockSql, lockValues);
    const contenders = launch();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await holder.query("COMMIT");
    return await Promise.allSettled(contenders);
  } finally {
    holder.release();
  }
}

/** The values of settled promises, failing the test with the real reason if any contender was rejected. */
export function fulfilled<T>(results: PromiseSettledResult<T>[]): T[] {
  return results.map((result) => {
    assert.equal(result.status, "fulfilled", result.status === "rejected" ? `a contender failed: ${String(result.reason)}` : "");
    return (result as PromiseFulfilledResult<T>).value;
  });
}
