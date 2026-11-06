/*
 * The port for a rate limiter whose counters live in SHARED storage. Server-only.
 *
 * Contrast with FixedWindowLimiter (src/server/diagnosis/attempt-limiter.ts): that one is a
 * synchronous counter in one process's memory. This port is asynchronous, so an implementation
 * can keep its counters in a database that every application instance reaches, which is what makes
 * a limit hold across instances and restarts.
 *
 * The algorithm is a FIXED WINDOW per (scope, key): the first hit starts a window of `windowMs`;
 * hits inside it are counted; the first hit after it ends starts a new one. It is the simplest
 * thing that can be made atomic in one statement, and it has one known property: a client can use
 * its full limit at the end of one window and again at the start of the next, so over a short span
 * it can briefly reach up to twice the limit. That is acceptable for abuse protection and is stated
 * in the documentation.
 */
import "server-only";

export interface RateLimitPolicy {
  /** How many hits a window admits. At least 1. */
  readonly limit: number;
  /** How long a window lasts, in milliseconds. */
  readonly windowMs: number;
}

export interface RateLimitResult {
  /** Whether THIS hit was admitted. */
  readonly allowed: boolean;
  /** Hits counted in the current window, never more than `limit`. */
  readonly used: number;
  readonly limit: number;
  /** When the current window ends, in milliseconds since the epoch. */
  readonly resetsAt: number;
  /** Whole seconds until a retry can succeed. 0 when `allowed`. Never less than 1 otherwise. */
  readonly retryAfterSeconds: number;
}

export interface DistributedRateLimiter {
  /**
   * Counts one hit for `key` within `scope`, atomically, and says whether it was admitted. A hit
   * that is refused is not counted beyond the limit and does not extend the window, so a client
   * that keeps retrying cannot keep itself locked out.
   *
   * `scope` names what is being limited; `key` identifies who. Both must be non-empty strings. A
   * caller must pass an opaque digest as `key`, never a raw address or identifier.
   */
  consume(scope: string, key: string, policy: RateLimitPolicy): Promise<RateLimitResult>;

  /**
   * Deletes counters whose window has ended and returns how many it deleted. This only reclaims
   * storage: an ended window is ignored by consume() whether or not it has been deleted yet.
   */
  purgeExpired(): Promise<number>;
}

/** Throws a TypeError for arguments no limiter can honour. Shared so every implementation refuses the same inputs. */
export function assertRateLimitInput(scope: unknown, key: unknown, policy: RateLimitPolicy): void {
  if (typeof scope !== "string" || scope.length < 1 || scope.length > 128) {
    throw new TypeError("scope must be a string of 1 to 128 characters.");
  }
  if (typeof key !== "string" || key.length < 1 || key.length > 256) {
    throw new TypeError("key must be a string of 1 to 256 characters.");
  }
  if (!Number.isInteger(policy?.limit) || policy.limit < 1 || policy.limit > 1_000_000) {
    throw new TypeError("policy.limit must be an integer from 1 to 1,000,000.");
  }
  if (!Number.isInteger(policy?.windowMs) || policy.windowMs < 1) {
    throw new TypeError("policy.windowMs must be a positive integer.");
  }
}

/** Builds the result from the counter state after a hit. `now` and `windowEnd` are milliseconds since the epoch. */
export function toRateLimitResult(hits: number, limit: number, windowEnd: number, now: number): RateLimitResult {
  const allowed = hits <= limit;
  return Object.freeze({
    allowed,
    used: Math.min(hits, limit),
    limit,
    resetsAt: windowEnd,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((windowEnd - now) / 1000)),
  });
}
