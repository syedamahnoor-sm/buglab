/*
 * Session expiry rules. Server-only, pure, and clock-free: every function takes
 * the current time as an argument, so the rules can be tested without waiting.
 *
 * Two limits apply to every session:
 *  - idle expiry: the session ends if the learner is inactive. Activity moves it
 *    forward, but never past the absolute expiry.
 *  - absolute expiry: a hard ceiling set at creation. Nothing moves it.
 *
 * A session is valid only while now < min(idleExpiresAt, absoluteExpiresAt).
 * All numeric values live in DEFAULT_EXPIRY_POLICY and nowhere else.
 */
import "server-only";

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;

export interface ExpiryPolicy {
  /** How long a session lasts without activity. */
  readonly idleTtlMs: number;
  /** The hard lifetime of a session, whatever the activity. */
  readonly absoluteTtlMs: number;
  /** A read refreshes the idle expiry at most once per this interval. */
  readonly touchIntervalMs: number;
  /** How long an expired session is still reported as expired, rather than unknown. */
  readonly purgeGraceMs: number;
}

/**
 * Provisional values from the architecture proposal (OD-7), not requirements.
 * Idle and absolute are a judgement: long enough to return to a half-finished
 * incident, short enough to bound retained data. The other two are operational.
 */
export const DEFAULT_EXPIRY_POLICY: ExpiryPolicy = Object.freeze({
  idleTtlMs: 30 * DAY_MS,
  absoluteTtlMs: 90 * DAY_MS,
  touchIntervalMs: 1 * DAY_MS,
  purgeGraceMs: 7 * DAY_MS,
});

function isPositiveDuration(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Returns the defaults with any overrides applied, or throws if the result is not coherent. */
export function createExpiryPolicy(overrides: Partial<ExpiryPolicy> = {}): ExpiryPolicy {
  const policy = { ...DEFAULT_EXPIRY_POLICY, ...overrides };
  const { idleTtlMs, absoluteTtlMs, touchIntervalMs, purgeGraceMs } = policy;

  if (!isPositiveDuration(idleTtlMs)) throw new RangeError("idleTtlMs must be a positive number");
  if (!isPositiveDuration(absoluteTtlMs)) throw new RangeError("absoluteTtlMs must be a positive number");
  if (!isPositiveDuration(touchIntervalMs)) throw new RangeError("touchIntervalMs must be a positive number");
  if (!Number.isFinite(purgeGraceMs) || purgeGraceMs < 0) {
    throw new RangeError("purgeGraceMs must be zero or more");
  }
  if (idleTtlMs > absoluteTtlMs) throw new RangeError("idleTtlMs must not exceed absoluteTtlMs");
  // Otherwise a session that is read often could still expire between refreshes.
  if (touchIntervalMs >= idleTtlMs) throw new RangeError("touchIntervalMs must be shorter than idleTtlMs");

  return Object.freeze(policy);
}

/** The timestamps the rules need. A LearnerRecord satisfies this. */
export interface SessionTimes {
  readonly lastTouchedAt: number;
  readonly idleExpiresAt: number;
  readonly absoluteExpiresAt: number;
}

export type ExpiryState =
  | { readonly state: "active" }
  | { readonly state: "expired"; readonly by: "idle" | "absolute" };

/** The idle deadline for activity at `now`: a full idle period, but never past the absolute expiry. */
function idleDeadline(policy: ExpiryPolicy, now: number, absoluteExpiresAt: number): number {
  return Math.min(now + policy.idleTtlMs, absoluteExpiresAt);
}

/** The timestamps of a session created at `now`. */
export function initialTimes(policy: ExpiryPolicy, now: number): SessionTimes & { readonly createdAt: number } {
  const absoluteExpiresAt = now + policy.absoluteTtlMs;
  return {
    createdAt: now,
    lastTouchedAt: now,
    idleExpiresAt: idleDeadline(policy, now, absoluteExpiresAt),
    absoluteExpiresAt,
  };
}

/** Whether the session is still valid at `now`. The expiry instant itself counts as expired. */
export function expiryState(times: SessionTimes, now: number): ExpiryState {
  if (now >= times.absoluteExpiresAt) return { state: "expired", by: "absolute" };
  if (now >= times.idleExpiresAt) return { state: "expired", by: "idle" };
  return { state: "active" };
}

/** Whether activity of this kind refreshes the idle expiry. Writes always do; reads are throttled. */
export function shouldRefresh(
  policy: ExpiryPolicy,
  times: SessionTimes,
  now: number,
  activity: "read" | "write",
): boolean {
  return activity === "write" || now - times.lastTouchedAt >= policy.touchIntervalMs;
}

/** The idle expiry after a refresh at `now`. Never later than the absolute expiry. */
export function refreshedIdleExpiry(policy: ExpiryPolicy, times: SessionTimes, now: number): number {
  return idleDeadline(policy, now, times.absoluteExpiresAt);
}

/**
 * Whether an expired session has been expired for longer than the purge grace
 * period. Such a session is treated as unknown and may be deleted.
 */
export function isPurgeable(policy: ExpiryPolicy, times: SessionTimes, now: number): boolean {
  return now >= Math.min(times.idleExpiresAt, times.absoluteExpiresAt) + policy.purgeGraceMs;
}

/**
 * The cookie Max-Age, in whole seconds, for a session whose idle expiry was just
 * written. It never outlives the session, and so never outlives the absolute expiry.
 */
export function cookieMaxAgeSeconds(times: SessionTimes, now: number): number {
  const remainingMs = Math.min(times.idleExpiresAt, times.absoluteExpiresAt) - now;
  return Math.max(0, Math.floor(remainingMs / SECOND_MS));
}
