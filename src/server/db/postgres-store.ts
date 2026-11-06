/*
 * PostgreSQL implementation of the learner, challenge-session and attempt ports. Server-only.
 *
 * This is the durable, shared store. State lives in the database, so it survives a restart and is the
 * same for every application instance that connects to it. It satisfies the same three store contract
 * suites as MemoryStore, unchanged (tests/postgres/postgres-store.test.ts).
 *
 * WHAT MAKES IT SAFE UNDER CONCURRENCY. Every port method is atomic with respect to every other, as
 * the contracts require, using the database rather than a process-local guarantee:
 *
 *   create        one INSERT. A unique constraint on the token hash decides a race: one wins, the rest
 *                 get "duplicate-token".
 *   start         INSERT ... ON CONFLICT DO NOTHING against a partial unique index (one CURRENT session
 *                 per learner and challenge). Racing starts produce one session; the losers read it.
 *   restart       one transaction that locks the current session row, checks the compare-and-set, marks it
 *                 superseded and inserts the replacement. Racing restarts serialise on the row lock, so
 *                 only the first replaces and the rest see the new session.
 *   record        one transaction that locks the SESSION row. Every attempt on a session therefore runs
 *                 one at a time: the idempotency check, the completed check, the window check, the insert
 *                 and the completion happen as one step, so a duplicate submission, two different
 *                 submissions racing for the last attempt, and two correct answers racing to complete
 *                 all resolve exactly as they would in sequence. Unique indexes (one submission id per
 *                 session, one sequence number per session, one correct attempt per session) are the
 *                 backstop behind the lock, not the mechanism.
 *   touch         the common case (nothing to refresh) is one plain SELECT. A refresh locks the learner
 *                 row, re-reads it and decides again, so concurrent refreshes cannot lose an update.
 *   purgeExpired  deletes in small batches with FOR UPDATE SKIP LOCKED, so concurrent purges on several
 *                 instances split the work and never deadlock or double-count. Deleting a learner
 *                 cascades to its sessions and attempts.
 *
 * LOCK LEVEL. Row locks are taken FOR NO KEY UPDATE, which does not conflict with the key-share locks
 * that foreign-key checks take, so writing attempts and starting sessions never blocks on a learner touch.
 *
 * TIME COMES FROM THE DATABASE. "Now" is the database server's clock (clock_timestamp()), read once per
 * operation, so every instance agrees on it however far its own clock has drifted. The expiry RULES stay
 * in expiry.ts (pure and clock-free); this store only supplies the time. `now` in the options replaces the
 * database clock and exists for TESTS ONLY, so the shared contract suites can move time forward.
 *
 * EXPIRED MEANS MISSING, PURGED OR NOT. findByTokenHash and touch judge every row against the database
 * clock at the moment they read it. A learner past its purge grace period is reported as `none` even if
 * the purge has not run; one past expiry but inside grace is `expired`. Purging only reclaims storage.
 *
 * NOT LOGGED, NOT CAUGHT. Nothing here logs. Database errors propagate unchanged, and the service and
 * handlers turn them into a plain 500 with no detail. Only the errors the contract names (StoreError) are
 * produced here.
 *
 * Times are BIGINT milliseconds since the epoch, ids are opaque text, and the raw token never reaches this
 * class: only its hash.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  createExpiryPolicy,
  expiryState,
  initialTimes,
  isPurgeable,
  refreshedIdleExpiry,
  shouldRefresh,
  type ExpiryPolicy,
} from "@/server/session/expiry";
import {
  assertNonEmpty,
  assertTokenHash,
  assertWindow,
  copyResult,
  decideClaim,
  decideRecordedAttempt,
  DEFAULT_CLAIM_LEASE_MS,
  toAttempt,
  toWindow,
  validateRecordInput,
  validateSubmissionIdentity,
  windowOf,
} from "@/server/session/store-rules";
import {
  StoreError,
  type AttemptOwner,
  type AttemptStore,
  type AttemptWindow,
  type ChallengeSessionOwner,
  type ChallengeSessionRecord,
  type ChallengeSessionStore,
  type DiagnosisAttemptRecord,
  type LearnerActivity,
  type LearnerLookup,
  type LearnerRecord,
  type LearnerStore,
  type LearnerTouch,
  type NewLearner,
  type FinalizeClaimInput,
  type FinalizeClaimResult,
  type RecordAttemptInput,
  type RecordAttemptResult,
  type ReleaseClaimInput,
  type ReserveSubmissionInput,
  type ReserveSubmissionResult,
  type RestartChallengeSession,
  type SubmissionClaim,
  type StartChallengeSession,
  type TokenHash,
  type WindowStatus,
} from "@/server/session/types";
import { DB_NOW_MS_SQL, isForeignKeyViolation, isUniqueViolation, toNumber, withTransaction, type Queryable } from "./sql";

export interface PostgresStoreOptions {
  /** A pool built from the POOLED runtime connection string. The caller owns it and closes it. */
  pool: pg.Pool;
  /** Expiry rules for learners. Defaults to the centralized DEFAULT_EXPIRY_POLICY. */
  policy?: Partial<ExpiryPolicy>;
  /**
   * TEST ONLY. Replaces the database clock, in milliseconds since the epoch. Leave it unset in
   * production: with it set, instances would trust their own clocks instead of the database's.
   */
  now?: () => number;
  /** Source of internal ids (learners, sessions and attempts). */
  newId?: () => string;
  /**
   * How long a submission claim is exclusively owned. After this, another caller may take it
   * and evaluate again. Defaults to DEFAULT_CLAIM_LEASE_MS. TEST AND PRODUCTION: the lease is
   * measured on the same clock as the rest of the store (the database clock, unless `now` is set).
   */
  claimLeaseMs?: number;
}

/** Learners deleted per purge transaction. Shared with the account-linking purge helper. */
export const PURGE_BATCH = 500;

export const LEARNER_COLUMNS =
  "id, revision, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at";
const SESSION_COLUMNS =
  "id, learner_id, challenge_id, challenge_version, status, revision, attempt_count, wrong_attempts, created_at, updated_at, completed_at, result, superseded_at";
const ATTEMPT_COLUMNS =
  "id, session_id, challenge_id, seq, submission_id, request_hash, root_cause_id, explanation, evidence, outcome, created_at";

export interface LearnerRow {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  last_touched_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
}

interface SessionRow {
  id: string;
  learner_id: string;
  challenge_id: string;
  challenge_version: string;
  status: "active" | "completed";
  revision: number;
  attempt_count: number;
  wrong_attempts: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  result: unknown;
  superseded_at: string | null;
}

interface AttemptRow {
  id: string;
  session_id: string;
  challenge_id: string;
  seq: number;
  submission_id: string;
  request_hash: string;
  root_cause_id: string;
  explanation: string;
  evidence: DiagnosisAttemptRecord["evidence"];
  outcome: "correct" | "incorrect";
  created_at: string;
}

export const learnerOf = (row: LearnerRow): LearnerRecord =>
  Object.freeze({
    id: row.id,
    revision: row.revision,
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    lastTouchedAt: toNumber(row.last_touched_at),
    idleExpiresAt: toNumber(row.idle_expires_at),
    absoluteExpiresAt: toNumber(row.absolute_expires_at),
  });

const sessionOf = (row: SessionRow): ChallengeSessionRecord =>
  Object.freeze({
    id: row.id,
    learnerId: row.learner_id,
    challengeId: row.challenge_id,
    challengeVersion: row.challenge_version,
    status: row.status,
    revision: row.revision,
    attemptCount: row.attempt_count,
    wrongAttempts: row.wrong_attempts,
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    ...(row.completed_at === null ? {} : { completedAt: toNumber(row.completed_at) }),
    // Rebuilt and validated by the same function that checked it on the way in, so what comes back is a frozen copy.
    ...(row.result === null || row.result === undefined ? {} : { result: copyResult(row.result) }),
    ...(row.superseded_at === null ? {} : { supersededAt: toNumber(row.superseded_at) }),
  });

const attemptOf = (row: AttemptRow): DiagnosisAttemptRecord =>
  toAttempt({
    id: row.id,
    sessionId: row.session_id,
    challengeId: row.challenge_id,
    seq: row.seq,
    submissionId: row.submission_id,
    requestHash: row.request_hash,
    rootCauseId: row.root_cause_id,
    explanation: row.explanation,
    evidence: row.evidence,
    outcome: row.outcome,
    createdAt: toNumber(row.created_at),
  });

export class PostgresStore implements LearnerStore, ChallengeSessionStore, AttemptStore {
  private readonly pool: pg.Pool;
  private readonly policy: ExpiryPolicy;
  private readonly clock: (() => number) | undefined;
  private readonly newId: () => string;
  private readonly claimLeaseMs: number;

  constructor({ pool, policy, now, newId = randomUUID, claimLeaseMs = DEFAULT_CLAIM_LEASE_MS }: PostgresStoreOptions) {
    this.pool = pool;
    this.policy = createExpiryPolicy(policy);
    this.clock = now;
    this.newId = newId;
    if (!Number.isFinite(claimLeaseMs) || claimLeaseMs < 1) {
      throw new StoreError("invalid-input", "claimLeaseMs must be a positive number of milliseconds.");
    }
    this.claimLeaseMs = claimLeaseMs;
  }

  /* ---------------------------------- Clock --------------------------------- */

  /** The time for one operation: the database's clock, or the test override. */
  private async now(queryable: Queryable): Promise<number> {
    if (this.clock) return this.clock();
    const { rows } = await queryable.query<{ now: string }>(`SELECT ${DB_NOW_MS_SQL} AS now`);
    return toNumber(rows[0].now);
  }

  /** SQL for "now" inside a statement that also returns it, so a read needs one round trip. Adds a value when overridden. */
  private nowSql(values: unknown[]): string {
    if (this.clock) {
      values.push(this.clock());
      return `$${values.length}::bigint`;
    }
    return DB_NOW_MS_SQL;
  }

  /* ------------------------------ LearnerStore ------------------------------ */

  async create(input: NewLearner): Promise<LearnerRecord> {
    assertTokenHash(input.tokenHash);
    const now = await this.now(this.pool);
    const times = initialTimes(this.policy, now);
    try {
      const { rows } = await this.pool.query<LearnerRow>(
        `INSERT INTO learners (id, token_hash, revision, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, 0, $3::bigint, $3::bigint, $4::bigint, $5::bigint, $6::bigint)
         RETURNING ${LEARNER_COLUMNS}`,
        [this.newId(), input.tokenHash, times.createdAt, times.lastTouchedAt, times.idleExpiresAt, times.absoluteExpiresAt],
      );
      return learnerOf(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error, "learners_token_hash_key")) {
        throw new StoreError("duplicate-token", "A learner already exists for this token hash.");
      }
      throw error;
    }
  }

  /** Where a learner stands at `now`: gone, expired, or active. The same judgement MemoryStore makes. */
  private judge(row: LearnerRow, now: number): LearnerLookup {
    const learner = learnerOf(row);
    if (isPurgeable(this.policy, learner, now)) return Object.freeze({ state: "none" });
    const expiry = expiryState(learner, now);
    if (expiry.state === "expired") return Object.freeze({ state: "expired", by: expiry.by });
    return Object.freeze({ state: "active", learner });
  }

  /** One plain read of a learner, with the database's time in the same statement. */
  private async read(tokenHash: TokenHash): Promise<{ row: LearnerRow; now: number } | null> {
    const values: unknown[] = [tokenHash];
    const nowSql = this.nowSql(values);
    const { rows } = await this.pool.query<LearnerRow & { db_now: string }>(
      `SELECT ${LEARNER_COLUMNS}, ${nowSql} AS db_now FROM learners WHERE token_hash = $1`,
      values,
    );
    return rows[0] ? { row: rows[0], now: toNumber(rows[0].db_now) } : null;
  }

  async findByTokenHash(tokenHash: TokenHash): Promise<LearnerLookup> {
    assertTokenHash(tokenHash);
    const found = await this.read(tokenHash);
    return found ? this.judge(found.row, found.now) : Object.freeze({ state: "none" });
  }

  async touch(tokenHash: TokenHash, activity: LearnerActivity): Promise<LearnerTouch> {
    assertTokenHash(tokenHash);
    const found = await this.read(tokenHash);
    if (!found) return Object.freeze({ state: "none" });

    // Expired or gone is final (a learner is never revived), and "nothing to refresh" cannot be undone by a
    // concurrent request either, so both are answered from this one read without taking a lock.
    const verdict = this.judge(found.row, found.now);
    if (verdict.state !== "active") return verdict;
    if (!shouldRefresh(this.policy, verdict.learner, found.now, activity)) {
      return Object.freeze({ state: "active", learner: verdict.learner, refreshed: false });
    }

    // A refresh: lock the row, read it again and decide again on what is really there.
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query<LearnerRow>(
        `SELECT ${LEARNER_COLUMNS} FROM learners WHERE token_hash = $1 FOR NO KEY UPDATE`,
        [tokenHash],
      );
      if (!locked.rows[0]) return Object.freeze({ state: "none" } as const);

      const now = await this.now(client);
      const current = this.judge(locked.rows[0], now);
      if (current.state !== "active") return current;
      if (!shouldRefresh(this.policy, current.learner, now, activity)) {
        return Object.freeze({ state: "active", learner: current.learner, refreshed: false } as const);
      }

      const updated = await client.query<LearnerRow>(
        `UPDATE learners
            SET idle_expires_at = $2::bigint, last_touched_at = $3::bigint, updated_at = $3::bigint, revision = revision + 1
          WHERE id = $1
        RETURNING ${LEARNER_COLUMNS}`,
        [current.learner.id, refreshedIdleExpiry(this.policy, current.learner, now), now],
      );
      return Object.freeze({ state: "active", learner: learnerOf(updated.rows[0]), refreshed: true } as const);
    });
  }

  /**
   * Deletes anonymous learners whose credential expired more than the grace period ago, with their sessions and attempts
   * (ON DELETE CASCADE). Uses only the core schema (migrations 0001 and 0002): it never queries account-linking tables.
   *
   * Each batch is one transaction:
   *  1. CLAIM eligible rows FOR UPDATE SKIP LOCKED (other purges / mid-link locks are skipped, not waited on).
   *  2. DELETE those claimed ids that still carry an anonymous credential.
   *
   * Learners with no anonymous credential (`token_hash IS NULL`, after a future account-link retirement) are never
   * eligible. When account linking is introduced, linked-learner retention must use the account-linking purge
   * (`purgeExpiredExcludingLinked` in postgres-account-links.ts), not this core method.
   */
  async purgeExpired(): Promise<number> {
    let removed = 0;
    for (;;) {
      const now = await this.now(this.pool);
      const claimed = await withTransaction(this.pool, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT l.id FROM learners l
            WHERE l.token_hash IS NOT NULL
              AND LEAST(l.idle_expires_at, l.absolute_expires_at) <= $1::bigint - $2::bigint
            ORDER BY l.id
            LIMIT $3
              FOR UPDATE OF l SKIP LOCKED`,
          [now, this.policy.purgeGraceMs, PURGE_BATCH],
        );
        if (rows.length === 0) return { claimed: 0, deleted: 0 };
        const { rowCount } = await client.query(
          `DELETE FROM learners l
            WHERE l.id = ANY($1::text[])
              AND l.token_hash IS NOT NULL`,
          [rows.map((row) => row.id)],
        );
        return { claimed: rows.length, deleted: rowCount ?? 0 };
      });
      removed += claimed.deleted;
      if (claimed.claimed < PURGE_BATCH) return removed;
    }
  }

  /* -------------------------- ChallengeSessionStore ------------------------- */

  async start(input: StartChallengeSession): Promise<{ session: ChallengeSessionRecord; created: boolean }> {
    assertNonEmpty(input.learnerId, "learnerId");
    assertNonEmpty(input.challengeId, "challengeId");
    assertNonEmpty(input.challengeVersion, "challengeVersion");

    const now = await this.now(this.pool);
    try {
      const inserted = await this.insertSession(this.pool, input, now, true);
      if (inserted) return Object.freeze({ session: inserted, created: true });
    } catch (error) {
      if (isForeignKeyViolation(error)) throw new StoreError("not-found", "No such learner.");
      throw error;
    }

    // Someone already has a current session for this learner and challenge: resume it, unchanged.
    const existing = await this.currentSession(this.pool, input);
    if (!existing) throw new StoreError("not-found", "No such learner.");
    return Object.freeze({ session: sessionOf(existing), created: false });
  }

  /** Inserts a new active session. With `ignoreConflict`, returns null instead of failing when the learner already has a current one. */
  private async insertSession(
    queryable: Queryable,
    input: StartChallengeSession,
    now: number,
    ignoreConflict: boolean,
  ): Promise<ChallengeSessionRecord | null> {
    const { rows } = await queryable.query<SessionRow>(
      `INSERT INTO challenge_sessions
         (id, learner_id, challenge_id, challenge_version, status, revision, attempt_count, wrong_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', 0, 0, 0, $5::bigint, $5::bigint)
       ${ignoreConflict ? "ON CONFLICT (learner_id, challenge_id) WHERE superseded_at IS NULL DO NOTHING" : ""}
       RETURNING ${SESSION_COLUMNS}`,
      [this.newId(), input.learnerId, input.challengeId, input.challengeVersion, now],
    );
    return rows[0] ? sessionOf(rows[0]) : null;
  }

  private async currentSession(queryable: Queryable, owner: ChallengeSessionOwner, lock = false): Promise<SessionRow | undefined> {
    const { rows } = await queryable.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM challenge_sessions
        WHERE learner_id = $1 AND challenge_id = $2 AND superseded_at IS NULL
        ${lock ? "FOR NO KEY UPDATE" : ""}`,
      [owner.learnerId, owner.challengeId],
    );
    return rows[0];
  }

  /**
   * The current session, locked. Under READ COMMITTED a locking SELECT that had to WAIT re-checks its WHERE clause
   * when the lock is released, and a row that was superseded in the meantime no longer matches, so it returns
   * NOTHING, even though the replacement session now exists. That is not "no session": look again. Each attempt
   * is a fresh statement and sees what has been committed since, so a second one finds the replacement. A few
   * attempts cover back-to-back restarts; a learner with no session at all still ends as null.
   */
  private async lockCurrentSession(client: Queryable, owner: ChallengeSessionOwner): Promise<SessionRow | undefined> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const row = await this.currentSession(client, owner, true);
      if (row) return row;
    }
    return undefined;
  }

  async restart(input: RestartChallengeSession): Promise<{ session: ChallengeSessionRecord; restarted: boolean }> {
    assertNonEmpty(input.learnerId, "learnerId");
    assertNonEmpty(input.challengeId, "challengeId");
    assertNonEmpty(input.challengeVersion, "challengeVersion");
    assertNonEmpty(input.supersedes, "supersedes");

    return withTransaction(this.pool, async (client) => {
      // Locking the current row makes racing restarts take turns: the first replaces, the rest find the new session.
      const current = await this.lockCurrentSession(client, input);
      if (!current) throw new StoreError("not-found", "No such session.");

      // Compare-and-set: only the session the caller found stale, only while it is unfinished, only to a different version.
      if (current.id !== input.supersedes || current.status !== "active" || current.challenge_version === input.challengeVersion) {
        return Object.freeze({ session: sessionOf(current), restarted: false });
      }

      const now = await this.now(client);
      // Marked superseded BEFORE the replacement is inserted, so the partial unique index never sees two current sessions.
      await client.query(
        "UPDATE challenge_sessions SET superseded_at = $2::bigint, updated_at = $2::bigint, revision = revision + 1 WHERE id = $1",
        [current.id, now],
      );
      const replacement = await this.insertSession(client, input, now, false);
      return Object.freeze({ session: replacement as ChallengeSessionRecord, restarted: true });
    });
  }

  async find(owner: ChallengeSessionOwner): Promise<ChallengeSessionRecord | null> {
    assertNonEmpty(owner.learnerId, "learnerId");
    assertNonEmpty(owner.challengeId, "challengeId");
    const row = await this.currentSession(this.pool, owner);
    return row ? sessionOf(row) : null;
  }

  async listCurrentCompleted(learnerId: string): Promise<readonly ChallengeSessionRecord[]> {
    assertNonEmpty(learnerId, "learnerId");
    // COLLATE "C": the id tie-break must match the memory store's code-unit order, whatever the database collation is.
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM challenge_sessions
        WHERE learner_id = $1 AND status = 'completed' AND superseded_at IS NULL
        ORDER BY completed_at DESC, id COLLATE "C"`,
      [learnerId],
    );
    return Object.freeze(rows.map(sessionOf));
  }

  /* ------------------------------ AttemptStore ------------------------------ */

  /** The session row, optionally locked, or a thrown error if it does not exist or belongs to another learner. */
  private async ownedSession(queryable: Queryable, owner: AttemptOwner, lock: boolean): Promise<SessionRow> {
    assertNonEmpty(owner.learnerId, "learnerId");
    assertNonEmpty(owner.sessionId, "sessionId");
    const { rows } = await queryable.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM challenge_sessions WHERE id = $1 ${lock ? "FOR NO KEY UPDATE" : ""}`,
      [owner.sessionId],
    );
    const session = rows[0];
    if (!session) throw new StoreError("not-found", "No such session.");
    if (session.learner_id !== owner.learnerId) {
      throw new StoreError("not-owner", "This session belongs to another learner.");
    }
    return session;
  }

  private async attemptsOf(queryable: Queryable, sessionId: string): Promise<DiagnosisAttemptRecord[]> {
    const { rows } = await queryable.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM diagnosis_attempts WHERE session_id = $1 ORDER BY seq`,
      [sessionId],
    );
    return rows.map(attemptOf);
  }

  async record(input: RecordAttemptInput): Promise<RecordAttemptResult> {
    return withTransaction(this.pool, async (client) => {
      // The session row lock serialises every attempt on this session, across every instance.
      const session = await this.ownedSession(client, input, true);
      if (session.superseded_at !== null) {
        throw new StoreError("superseded", "This session was replaced by a restart and accepts no more attempts.");
      }
      const result = validateRecordInput(input);

      const history = await this.attemptsOf(client, session.id);
      const now = await this.now(client);
      const blocked = this.blocked(session, history, input, now);
      if (blocked) return blocked;

      // 4. Record it. A correct outcome completes the session in the same transaction.
      const attempt: DiagnosisAttemptRecord = {
        id: this.newId(),
        sessionId: session.id,
        challengeId: session.challenge_id,
        seq: history.length + 1,
        submissionId: input.submissionId,
        requestHash: input.requestHash,
        rootCauseId: input.rootCauseId,
        explanation: input.explanation,
        evidence: input.evidence.map((ref) => ({ ...ref })),
        outcome: input.outcome,
        createdAt: now,
      };
      await client.query(
        `INSERT INTO diagnosis_attempts
           (id, session_id, challenge_id, seq, submission_id, request_hash, root_cause_id, explanation, evidence, outcome, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::bigint)`,
        [
          attempt.id,
          attempt.sessionId,
          attempt.challengeId,
          attempt.seq,
          attempt.submissionId,
          attempt.requestHash,
          attempt.rootCauseId,
          attempt.explanation,
          JSON.stringify(attempt.evidence),
          attempt.outcome,
          attempt.createdAt,
        ],
      );

      const completes = input.outcome === "correct";
      const updated = await client.query<SessionRow>(
        `UPDATE challenge_sessions
            SET attempt_count = $2,
                wrong_attempts = wrong_attempts + $3,
                updated_at = $4::bigint,
                revision = revision + 1,
                status = $5,
                completed_at = $6::bigint,
                result = $7::jsonb
          WHERE id = $1
        RETURNING ${SESSION_COLUMNS}`,
        [
          session.id,
          history.length + 1,
          completes ? 0 : 1,
          now,
          completes ? "completed" : "active",
          completes ? now : null,
          completes ? JSON.stringify(result) : null,
        ],
      );

      return Object.freeze({
        kind: "recorded",
        attempt: toAttempt(attempt),
        session: sessionOf(updated.rows[0]),
        window: toWindow(windowOf([...history, attempt], input.window, now)),
      } as const);
    });
  }

  async reserve(input: ReserveSubmissionInput): Promise<ReserveSubmissionResult> {
    return withTransaction(this.pool, async (client) => {
      const session = await this.ownedSession(client, input, true);
      if (session.superseded_at !== null) {
        throw new StoreError("superseded", "This session was replaced by a restart and accepts no more attempts.");
      }
      validateSubmissionIdentity(input);
      const history = await this.attemptsOf(client, session.id);
      const now = await this.now(client);
      const blocked = this.blocked(session, history, input, now);
      if (blocked) return blocked;

      const existing = await this.claimOf(client, session.id, input.submissionId);
      const decision = decideClaim(
        existing ? { requestHash: existing.request_hash, expiresAt: toNumber(existing.expires_at) } : undefined,
        input.requestHash,
        now,
      );
      if (decision.kind === "in-progress") return Object.freeze({ kind: "in-progress", expiresAt: decision.expiresAt });
      if (decision.kind === "conflict") return Object.freeze({ kind: "conflict" });

      const token = this.newId();
      const expiresAt = now + this.claimLeaseMs;
      if (existing) {
        await client.query(
          `UPDATE diagnosis_submission_claims
              SET request_hash = $3, claim_token = $4, claimed_at = $5::bigint, expires_at = $6::bigint
            WHERE session_id = $1 AND submission_id = $2`,
          [session.id, input.submissionId, input.requestHash, token, now, expiresAt],
        );
      } else {
        await client.query(
          `INSERT INTO diagnosis_submission_claims
             (session_id, submission_id, request_hash, claim_token, claimed_at, expires_at)
           VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint)`,
          [session.id, input.submissionId, input.requestHash, token, now, expiresAt],
        );
      }
      const claim: SubmissionClaim = Object.freeze({
        token,
        sessionId: session.id,
        submissionId: input.submissionId,
        requestHash: input.requestHash,
        expiresAt,
      });
      return Object.freeze({ kind: "claimed", claim });
    });
  }

  async finalize(input: FinalizeClaimInput): Promise<FinalizeClaimResult> {
    return withTransaction(this.pool, async (client) => {
      const session = await this.ownedSession(client, input, true);
      if (session.superseded_at !== null) {
        throw new StoreError("superseded", "This session was replaced by a restart and accepts no more attempts.");
      }
      const claim = await this.claimOf(client, session.id, input.submissionId);
      if (!claim || claim.claim_token !== input.claimToken || claim.request_hash !== input.requestHash) {
        return Object.freeze({ kind: "claim-lost" });
      }
      const result = validateRecordInput(input);
      const history = await this.attemptsOf(client, session.id);
      const now = await this.now(client);
      const blocked = this.blocked(session, history, input, now);
      if (blocked) {
        await this.deleteClaim(client, session.id, input.claimToken);
        return blocked;
      }

      const attempt: DiagnosisAttemptRecord = {
        id: this.newId(),
        sessionId: session.id,
        challengeId: session.challenge_id,
        seq: history.length + 1,
        submissionId: input.submissionId,
        requestHash: input.requestHash,
        rootCauseId: input.rootCauseId,
        explanation: input.explanation,
        evidence: input.evidence.map((ref) => ({ ...ref })),
        outcome: input.outcome,
        createdAt: now,
      };
      await client.query(
        `INSERT INTO diagnosis_attempts
           (id, session_id, challenge_id, seq, submission_id, request_hash, root_cause_id, explanation, evidence, outcome, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::bigint)`,
        [
          attempt.id,
          attempt.sessionId,
          attempt.challengeId,
          attempt.seq,
          attempt.submissionId,
          attempt.requestHash,
          attempt.rootCauseId,
          attempt.explanation,
          JSON.stringify(attempt.evidence),
          attempt.outcome,
          attempt.createdAt,
        ],
      );
      const completes = input.outcome === "correct";
      const updated = await client.query<SessionRow>(
        `UPDATE challenge_sessions
            SET attempt_count = $2,
                wrong_attempts = wrong_attempts + $3,
                updated_at = $4::bigint,
                revision = revision + 1,
                status = $5,
                completed_at = $6::bigint,
                result = $7::jsonb
          WHERE id = $1
        RETURNING ${SESSION_COLUMNS}`,
        [
          session.id,
          history.length + 1,
          completes ? 0 : 1,
          now,
          completes ? "completed" : "active",
          completes ? now : null,
          completes ? JSON.stringify(result) : null,
        ],
      );
      await this.deleteClaim(client, session.id, input.claimToken);
      return Object.freeze({
        kind: "recorded",
        attempt: toAttempt(attempt),
        session: sessionOf(updated.rows[0]),
        window: toWindow(windowOf([...history, attempt], input.window, now)),
      });
    });
  }

  async releaseClaim(input: ReleaseClaimInput): Promise<void> {
    assertNonEmpty(input.sessionId, "sessionId");
    assertNonEmpty(input.claimToken, "claimToken");
    await this.pool.query(
      `DELETE FROM diagnosis_submission_claims WHERE session_id = $1 AND claim_token = $2`,
      [input.sessionId, input.claimToken],
    );
  }

  private async claimOf(
    queryable: Queryable,
    sessionId: string,
    submissionId: string,
  ): Promise<{ request_hash: string; claim_token: string; expires_at: string } | undefined> {
    const { rows } = await queryable.query<{ request_hash: string; claim_token: string; expires_at: string }>(
      `SELECT request_hash, claim_token, expires_at
         FROM diagnosis_submission_claims
        WHERE session_id = $1 AND submission_id = $2
        FOR UPDATE`,
      [sessionId, submissionId],
    );
    return rows[0];
  }

  private async deleteClaim(queryable: Queryable, sessionId: string, claimToken: string): Promise<void> {
    await queryable.query(
      `DELETE FROM diagnosis_submission_claims WHERE session_id = $1 AND claim_token = $2`,
      [sessionId, claimToken],
    );
  }

  /** Duplicate, conflict, completed and rate-limited, in the attempt-contract order. */
  private blocked(
    session: SessionRow,
    history: readonly DiagnosisAttemptRecord[],
    input: ReserveSubmissionInput,
    now: number,
  ): Exclude<ReserveSubmissionResult, { kind: "claimed" | "in-progress" }> | undefined {
    const decision = decideRecordedAttempt(history, session.status, input, now);
    const window = toWindow(windowOf(history, input.window, now));
    const view = sessionOf(session);
    if (decision.kind === "duplicate") {
      const sameId = history.find((attempt) => attempt.submissionId === input.submissionId)!;
      return Object.freeze({ kind: "duplicate", attempt: sameId, session: view, window });
    }
    if (decision.kind === "conflict") return Object.freeze({ kind: "conflict" });
    if (decision.kind === "already-completed") {
      const correct = history.find((attempt) => attempt.outcome === "correct");
      if (!correct) throw new StoreError("invalid-input", "A completed session has no correct attempt.");
      return Object.freeze({ kind: "already-completed", attempt: correct, session: view, window });
    }
    if (decision.kind === "rate-limited") {
      return Object.freeze({ kind: "rate-limited", retryAfterMs: decision.retryAfterMs, window });
    }
    return undefined;
  }

  async list(owner: AttemptOwner): Promise<readonly DiagnosisAttemptRecord[]> {
    const session = await this.ownedSession(this.pool, owner, false);
    return Object.freeze(await this.attemptsOf(this.pool, session.id));
  }

  async windowStatus(owner: AttemptOwner, window: AttemptWindow): Promise<WindowStatus> {
    const session = await this.ownedSession(this.pool, owner, false);
    assertWindow(window);
    const history = await this.attemptsOf(this.pool, session.id);
    return toWindow(windowOf(history, window, await this.now(this.pool)));
  }
}
