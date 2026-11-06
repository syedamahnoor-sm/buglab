/*
 * Small PostgreSQL helpers shared by the stores. Server-only.
 *
 * COMPATIBLE WITH A TRANSACTION-MODE POOLER. A connection pooler in transaction mode (what managed
 * providers put in front of the database for runtime traffic) hands a different server connection to
 * each transaction. So nothing here relies on session state: no session-level SET, no session
 * advisory locks, no named prepared statements, no LISTEN. Everything is either one statement or one
 * explicit transaction on one client, and the only settings changed are SET LOCAL, which end with
 * the transaction.
 */
import "server-only";
import type pg from "pg";

/** The database's own clock as milliseconds since the epoch. Every instance agrees on it. */
export const DB_NOW_MS_SQL = "(floor(extract(epoch from clock_timestamp()) * 1000))::bigint";

/** Anything that can run a query: the pool, or one client inside a transaction. */
export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

const LOCK_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 15_000;
const MAX_TRANSACTION_ATTEMPTS = 3;

/** PostgreSQL error classes that a retry of the whole transaction can cure. */
const RETRYABLE = new Set(["40001", "40P01"]);

interface PgErrorLike {
  code?: string;
  constraint?: string;
}

export const pgErrorCode = (error: unknown): string | undefined => (error as PgErrorLike | null)?.code;

/** True for a unique violation, optionally on one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  return pgErrorCode(error) === "23505" && (constraint === undefined || (error as PgErrorLike).constraint === constraint);
}

export const isForeignKeyViolation = (error: unknown): boolean => pgErrorCode(error) === "23503";

/**
 * Runs `work` in one transaction on one connection and commits it, or rolls everything back if `work`
 * throws. A deadlock or serialization failure re-runs the whole of `work` (up to three attempts), so
 * `work` must be safe to run again: it may do nothing outside the database.
 *
 * Locks wait at most five seconds and a statement runs at most fifteen, so a stuck peer fails this
 * request instead of holding a pooled connection indefinitely.
 */
export async function withTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    // A checked-out client has no listener from the pool. If its connection dies (a database restart, a failover, a killed
    // backend) it can emit an 'error' event of its own, and an 'error' event nobody listens for is an uncaught exception that
    // takes the whole process down. The failure still reaches this code as a rejected query; this only absorbs the event.
    const absorb = () => {};
    client.on("error", absorb);
    let discard = false;
    try {
      await client.query(`BEGIN; SET LOCAL lock_timeout = ${LOCK_TIMEOUT_MS}; SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is unusable. Do not hand it back to the pool.
        discard = true;
      }
      if (attempt < MAX_TRANSACTION_ATTEMPTS && RETRYABLE.has(pgErrorCode(error) ?? "")) continue;
      throw error;
    } finally {
      // A discarded connection keeps the listener: it is dead, and a late event from it must still be absorbed.
      if (!discard) client.removeListener("error", absorb);
      client.release(discard);
    }
  }
}

/** Reads a BIGINT column, which the driver returns as a string. Times are far below 2^53, so this is exact. */
export function toNumber(value: string | number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("A stored number is outside the safe integer range.");
  return number;
}
