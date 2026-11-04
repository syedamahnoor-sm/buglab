/*
 * Contracts for the anonymous learner, a learner's challenge sessions and their
 * diagnosis attempts. Server-only.
 *
 * Three things, three ports:
 *
 *  - A LEARNER is one anonymous identity for the whole product. It is identified
 *    by a random token that only the learner's browser and the server ever see.
 *    The store never holds the token, only its SHA-256 hash. The learner has the
 *    idle and absolute expiry (expiry.ts) and nothing else does.
 *  - A CHALLENGE SESSION is one learner's run at one challenge. A learner has at
 *    most one per challenge. It has no token and no expiry of its own: it lives
 *    and dies with its learner, and it is reached only through the learner.
 *  - A DIAGNOSIS ATTEMPT is one evaluated submission inside a challenge session.
 *
 * No type in this module is meant to reach the client: nothing here belongs in
 * src/types or in a response body. Internal ids and token hashes stay on the
 * server; snapshots.ts is the allow-list of what a learner may see.
 *
 * The ports are deliberately storage-independent, so an in-memory store
 * (development and tests) and a durable one (a database) can satisfy the same
 * contract without changing callers.
 */
import "server-only";
import type { DiagnosisFeedback } from "@/types/diagnosis";
import type { EvidenceRef } from "@/types/investigation";

/** The raw cookie token. Created by token.ts and only ever handed to the caller that sets the cookie. */
export type SessionToken = string & { readonly __brand: "SessionToken" };

/** The SHA-256 of a SessionToken as 64 lowercase hex characters. The only form a store accepts. */
export type TokenHash = string & { readonly __brand: "TokenHash" };

/* -------------------------------------------------------------------------- */
/* Learner                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What the store knows about a learner. Times are milliseconds since the Unix
 * epoch, read from the store's own clock. The token hash is deliberately not part
 * of the record: callers already hold it, and leaving it out keeps it from
 * travelling further than it has to.
 */
export interface LearnerRecord {
  /** Internal identifier. Never sent to the client. */
  readonly id: string;
  /** Starts at 0 and increases by one each time the store persists a change to the record. */
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** When the idle expiry was last refreshed. */
  readonly lastTouchedAt: number;
  /** The learner ends here if inactive. Never later than absoluteExpiresAt. */
  readonly idleExpiresAt: number;
  /** The hard ceiling. Nothing ever extends it. */
  readonly absoluteExpiresAt: number;
}

export interface NewLearner {
  readonly tokenHash: TokenHash;
}

/** Which of the two limits ended a learner. When both have passed, `absolute` is reported. */
export type ExpiredBy = "idle" | "absolute";

/**
 * An expired learner is reported without its record, so nothing about an expired
 * learner can be served by accident. It stays `expired` for the purge grace
 * period, then becomes `none`, whether or not it has been physically deleted yet.
 */
export type LearnerLookup =
  | { readonly state: "active"; readonly learner: LearnerRecord }
  | { readonly state: "expired"; readonly by: ExpiredBy }
  | { readonly state: "none" };

/**
 * What the learner's request was. A write (creating or resuming an identity,
 * starting a challenge, recording an attempt) always refreshes the idle expiry.
 * A read refreshes it at most once per touch interval.
 */
export type LearnerActivity = "read" | "write";

export type LearnerTouch =
  | { readonly state: "active"; readonly learner: LearnerRecord; readonly refreshed: boolean }
  | { readonly state: "expired"; readonly by: ExpiredBy }
  | { readonly state: "none" };

/**
 * "superseded": an attempt was recorded against a challenge session that a restart has since replaced.
 * The caller held a stale session; nothing was recorded.
 */
export type StoreErrorCode = "invalid-input" | "duplicate-token" | "not-found" | "not-owner" | "superseded";

/** A caller bug or a conflict, as opposed to a normal lookup outcome. */
export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

/**
 * Every method of every port is atomic with respect to every other: when two
 * calls overlap, the outcome is the same as if one had run completely before the
 * other. Implementations own the clock and the expiry policy, so callers never
 * pass in a time.
 *
 * Methods reject with StoreError("invalid-input") for a malformed argument, such
 * as a string that is not a token hash. Normal outcomes (unknown, expired) are
 * returned, not thrown.
 */
export interface LearnerStore {
  /**
   * Creates a learner. Always a new record: it rejects with "duplicate-token" if
   * the hash already exists, even for an expired learner, so a hash can never be
   * used to replace or revive an identity.
   */
  create(input: NewLearner): Promise<LearnerRecord>;

  /** Looks a learner up without changing anything. */
  findByTokenHash(tokenHash: TokenHash): Promise<LearnerLookup>;

  /**
   * Records activity on an active learner and refreshes its idle expiry according
   * to the policy. Never revives a learner: an expired or unknown one is reported
   * as such and left exactly as it was.
   */
  touch(tokenHash: TokenHash, activity: LearnerActivity): Promise<LearnerTouch>;

  /**
   * Deletes learners whose purge grace period has ended, together with their
   * challenge sessions and attempts, and returns how many learners it deleted.
   * This only reclaims storage. Lookups already treat such learners as `none`, so
   * behaviour does not depend on when this runs.
   */
  purgeExpired(): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/* Challenge session                                                          */
/* -------------------------------------------------------------------------- */

export type ChallengeSessionStatus = "active" | "completed";

/**
 * What the learner was shown when they completed the challenge, kept exactly as it was shown. It is
 * stored so that a completed result survives a change to the challenge: the answer key may be
 * corrected later, but the learner's completed session must still show what they actually earned.
 * It is released to the owning learner only once the session is completed, which is when the
 * diagnosis response already gave it to them.
 */
export interface CompletionResult {
  readonly resolutionSummary: string;
  readonly feedback: DiagnosisFeedback;
}

export interface ChallengeSessionRecord {
  /** Internal identifier. Never sent to the client. */
  readonly id: string;
  /** The owning learner's internal id. Never sent to the client. */
  readonly learnerId: string;
  readonly challengeId: string;
  /**
   * The challenge's content version when the session started: `<registry revision>+<public content
   * hash>`, taken from the challenge registry. An unfinished session is only valid while this equals
   * the current version; see service.ts (the version policy). A completed session keeps it forever.
   */
  readonly challengeVersion: string;
  /** `completed` once a correct attempt has been recorded. Nothing else sets it. */
  readonly status: ChallengeSessionStatus;
  /** Starts at 0 and increases by one each time the store persists a change to the record. */
  readonly revision: number;
  /** How many attempts have been recorded, of any outcome. */
  readonly attemptCount: number;
  /** Lifetime count of incorrect attempts. */
  readonly wrongAttempts: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Set exactly when `status` is `completed`, from the store's clock. */
  readonly completedAt?: number;
  /** Set exactly when `status` is `completed`: the result the learner was shown. */
  readonly result?: CompletionResult;
  /**
   * Set when a restart replaced this session. A superseded session is kept, with its attempts, as
   * history, but it is never returned by find() and it accepts no further attempts.
   */
  readonly supersededAt?: number;
}

export interface StartChallengeSession {
  readonly learnerId: string;
  readonly challengeId: string;
  readonly challengeVersion: string;
}

export interface RestartChallengeSession {
  readonly learnerId: string;
  readonly challengeId: string;
  /** The content version the new session starts at. */
  readonly challengeVersion: string;
  /** The session the caller found out of date. A restart replaces only this one, never a newer one. */
  readonly supersedes: string;
}

export interface ChallengeSessionOwner {
  readonly learnerId: string;
  readonly challengeId: string;
}

export interface ChallengeSessionStore {
  /**
   * Starts the learner's session for a challenge, or returns the one that already
   * exists, unchanged (`created: false`). A learner has at most one session per
   * challenge, and different learners never share one. Rejects with "not-found" if
   * the learner does not exist.
   */
  start(input: StartChallengeSession): Promise<{ readonly session: ChallengeSessionRecord; readonly created: boolean }>;

  /** The learner's CURRENT session for the challenge, or null. Never another learner's, never a superseded one. */
  find(owner: ChallengeSessionOwner): Promise<ChallengeSessionRecord | null>;

  /**
   * Replaces an unfinished session with a fresh one at a new content version, atomically. It is a
   * compare-and-set on `supersedes`, so two requests that both noticed the same stale session
   * produce one new session, not two, and it can never discard work that is not the named session:
   *
   *  - the current session is `supersedes`, is `active`, and has a different version:
   *    it is marked superseded (kept, with its attempts, as history) and a new `active` session with
   *    zero attempts and its own empty attempt window is started: `restarted: true`;
   *  - otherwise nothing changes and the current session is returned: `restarted: false`. That covers a
   *    completed session (a completed result is never restarted), a session that someone else already
   *    replaced, and a session whose version already matches.
   *
   * Rejects with "not-found" if the learner has no session for the challenge.
   */
  restart(input: RestartChallengeSession): Promise<{ readonly session: ChallengeSessionRecord; readonly restarted: boolean }>;
}

/* -------------------------------------------------------------------------- */
/* Diagnosis attempts                                                         */
/* -------------------------------------------------------------------------- */

export type AttemptOutcome = "correct" | "incorrect";

/**
 * One recorded attempt: what the learner submitted and what the server decided.
 * It holds no answer-key data and no response body.
 */
export interface DiagnosisAttemptRecord {
  /** Internal identifier. Never sent to the client. */
  readonly id: string;
  readonly sessionId: string;
  readonly challengeId: string;
  /** 1 for the first attempt in the session, then one more each time. */
  readonly seq: number;
  /** The idempotency key: unique within the session. */
  readonly submissionId: string;
  /** SHA-256 of the canonical submission, to tell a retry from a reused id. */
  readonly requestHash: string;
  readonly rootCauseId: string;
  readonly explanation: string;
  readonly evidence: readonly EvidenceRef[];
  readonly outcome: AttemptOutcome;
  readonly createdAt: number;
}

/** How many incorrect attempts are allowed inside a sliding window of time. */
export interface AttemptWindow {
  readonly limit: number;
  readonly windowMs: number;
}

/** The incorrect attempts currently inside the window. Times are milliseconds since the epoch. */
export interface WindowStatus {
  readonly used: number;
  readonly limit: number;
  /** When the oldest counted attempt leaves the window, so a slot frees up. Absent when none is counted. */
  readonly resetsAt?: number;
}

export interface RecordAttemptInput {
  readonly learnerId: string;
  readonly sessionId: string;
  readonly submissionId: string;
  readonly requestHash: string;
  readonly rootCauseId: string;
  readonly explanation: string;
  readonly evidence: readonly EvidenceRef[];
  /** Decided by the server's evaluation, never by the client. */
  readonly outcome: AttemptOutcome;
  /**
   * What the learner is shown for a correct outcome, stored on the session when it completes.
   * Required exactly when `outcome` is `correct`, and refused otherwise.
   */
  readonly result?: CompletionResult;
  readonly window: AttemptWindow;
}

/**
 * What recording an attempt did. The checks run in this order, all inside one
 * atomic step:
 *
 *  1. The submission id was already used in this session: `duplicate` when the
 *     content is the same (nothing is recorded), `conflict` when it differs.
 *  2. The session is already completed: `already-completed`, with the stored
 *     correct attempt. Nothing is recorded.
 *  3. The window is full of incorrect attempts: `rate-limited`. Nothing is
 *     recorded, whatever the outcome would have been.
 *  4. Otherwise `recorded`. A correct outcome completes the session in the same step.
 */
export type RecordAttemptResult =
  | {
      readonly kind: "recorded";
      readonly attempt: DiagnosisAttemptRecord;
      readonly session: ChallengeSessionRecord;
      readonly window: WindowStatus;
    }
  | {
      readonly kind: "duplicate";
      readonly attempt: DiagnosisAttemptRecord;
      /** The session as it is now, so a replay can use its stored result without a second read. */
      readonly session: ChallengeSessionRecord;
      readonly window: WindowStatus;
    }
  | {
      readonly kind: "already-completed";
      readonly attempt: DiagnosisAttemptRecord;
      readonly session: ChallengeSessionRecord;
      readonly window: WindowStatus;
    }
  | { readonly kind: "conflict" }
  | { readonly kind: "rate-limited"; readonly retryAfterMs: number; readonly window: WindowStatus };

export interface AttemptOwner {
  readonly learnerId: string;
  readonly sessionId: string;
}

export interface AttemptStore {
  /**
   * Records an attempt atomically. See RecordAttemptResult. Rejects with "not-owner" for another
   * learner's session, and with "superseded" for a session a restart has replaced.
   */
  record(input: RecordAttemptInput): Promise<RecordAttemptResult>;

  /** The session's attempts in order. Rejects with "not-owner" for another learner's session. */
  list(owner: AttemptOwner): Promise<readonly DiagnosisAttemptRecord[]>;

  /** The current window of incorrect attempts. Rejects with "not-owner" for another learner's session. */
  windowStatus(owner: AttemptOwner, window: AttemptWindow): Promise<WindowStatus>;
}
