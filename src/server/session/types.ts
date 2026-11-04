/*
 * Contracts for anonymous learner sessions. Server-only.
 *
 * A session is identified by a random token that only the learner's browser and
 * the server ever see. The store never holds the token, only its SHA-256 hash,
 * and no type in this module is meant to reach the client: nothing here belongs
 * in src/types or in a response body.
 *
 * The SessionStore interface is deliberately storage-independent so an
 * in-memory store (development and tests) and a durable one (a database) can
 * satisfy the same contract without changing callers.
 */
import "server-only";

/** The raw cookie token. Created by token.ts and only ever handed to the caller that sets the cookie. */
export type SessionToken = string & { readonly __brand: "SessionToken" };

/** The SHA-256 of a SessionToken as 64 lowercase hex characters. The only form a store accepts. */
export type TokenHash = string & { readonly __brand: "TokenHash" };

/**
 * What the store knows about a session. Times are milliseconds since the Unix
 * epoch, read from the store's own clock. The token hash is deliberately not part
 * of the record: callers already hold it, and leaving it out keeps it from
 * travelling further than it has to.
 */
export interface SessionRecord {
  /** Internal identifier. Never sent to the client. */
  readonly id: string;
  readonly challengeId: string;
  /** Content version of the challenge when the session was created. Recorded, not enforced. */
  readonly challengeVersion: string;
  /** Starts at 0 and increases by one each time the store persists a change to the record. */
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** When the idle expiry was last refreshed. */
  readonly lastTouchedAt: number;
  /** The session ends here if the learner is inactive. Never later than absoluteExpiresAt. */
  readonly idleExpiresAt: number;
  /** The hard ceiling. Nothing ever extends it. */
  readonly absoluteExpiresAt: number;
}

export interface NewSession {
  readonly tokenHash: TokenHash;
  readonly challengeId: string;
  readonly challengeVersion: string;
}

/** Which of the two limits ended a session. When both have passed, `absolute` is reported. */
export type ExpiredBy = "idle" | "absolute";

/**
 * An expired session is reported without its record, so nothing about an expired
 * session can be served by accident. It stays `expired` for the purge grace
 * period, then becomes `none`, whether or not it has been physically deleted yet.
 */
export type SessionLookup =
  | { readonly state: "active"; readonly session: SessionRecord }
  | { readonly state: "expired"; readonly by: ExpiredBy }
  | { readonly state: "none" };

/**
 * What the learner's request was. A write (creating or resuming a session, and
 * later recording an attempt) always refreshes the idle expiry. A read refreshes
 * it at most once per touch interval.
 */
export type SessionActivity = "read" | "write";

export type SessionTouch =
  | { readonly state: "active"; readonly session: SessionRecord; readonly refreshed: boolean }
  | { readonly state: "expired"; readonly by: ExpiredBy }
  | { readonly state: "none" };

export type SessionStoreErrorCode = "invalid-input" | "duplicate-token";

/** A caller bug or a conflict, as opposed to a normal lookup outcome. */
export class SessionStoreError extends Error {
  readonly code: SessionStoreErrorCode;

  constructor(code: SessionStoreErrorCode, message: string) {
    super(message);
    this.name = "SessionStoreError";
    this.code = code;
  }
}

/**
 * Every method is atomic with respect to every other: when two calls overlap, the
 * outcome is the same as if one had run completely before the other. Implementations
 * own the clock and the expiry policy, so callers never pass in a time.
 *
 * Methods reject with SessionStoreError("invalid-input") for a malformed argument,
 * such as a string that is not a token hash. Normal outcomes (unknown, expired) are
 * returned, not thrown.
 */
export interface SessionStore {
  /**
   * Creates a session. Always a new record: it rejects with "duplicate-token" if
   * the hash already exists, even for an expired session, so a hash can never be
   * used to replace or revive a session.
   */
  create(input: NewSession): Promise<SessionRecord>;

  /** Looks a session up without changing anything. */
  findByTokenHash(tokenHash: TokenHash): Promise<SessionLookup>;

  /**
   * Records activity on an active session and refreshes its idle expiry according
   * to the policy. Never revives a session: an expired or unknown one is reported
   * as such and left exactly as it was.
   */
  touch(tokenHash: TokenHash, activity: SessionActivity): Promise<SessionTouch>;

  /**
   * Deletes sessions whose purge grace period has ended and returns how many it
   * deleted. This only reclaims storage. Lookups already treat such sessions as
   * `none`, so behaviour does not depend on when this runs.
   */
  purgeExpired(): Promise<number>;
}
