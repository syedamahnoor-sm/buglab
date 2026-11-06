/*
 * In-memory implementation of the learner, challenge-session and attempt ports.
 * Server-only.
 *
 * DEVELOPMENT AND TEST ONLY: state lives in this process's memory, so it is lost
 * on restart and is not shared across processes, instances, serverless
 * invocations or separately bundled routes. It is not production-ready and it is
 * NOT durable persistence. Use it to build and test the flow, and run the same
 * contract suites against the durable store that replaces it.
 *
 * One class implements all three ports, so that recording an attempt and
 * completing the session happen in one step, and so that purging a learner also
 * removes everything that belongs to it.
 *
 * It is created explicitly by whoever needs one. There is deliberately no global
 * singleton here.
 *
 * Concurrency: every public method is an async function whose body contains no
 * `await`, so it runs to completion before any other call can start. That is the
 * only guarantee, and it holds only within this one process. Do not add an
 * `await` between a read and the write that depends on it.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import {
  createExpiryPolicy,
  expiryState,
  initialTimes,
  isPurgeable,
  refreshedIdleExpiry,
  shouldRefresh,
  type ExpiryPolicy,
} from "./expiry";
import {
  assertNonEmpty,
  assertWindow,
  assertTokenHash,
  decideClaim,
  decideRecordedAttempt,
  DEFAULT_CLAIM_LEASE_MS,
  toAttempt,
  toWindow,
  validateRecordInput,
  validateSubmissionIdentity,
  windowOf,
} from "./store-rules";
import {
  StoreError,
  type AttemptOwner,
  type AttemptStore,
  type AttemptWindow,
  type ChallengeSessionOwner,
  type ChallengeSessionRecord,
  type ChallengeSessionStore,
  type CompletionResult,
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
} from "./types";

export interface MemoryStoreOptions {
  /** Expiry rules for learners. Defaults to the centralized DEFAULT_EXPIRY_POLICY. */
  policy?: Partial<ExpiryPolicy>;
  /** The clock, in milliseconds since the epoch. Inject one in tests. */
  now?: () => number;
  /** Source of internal ids (learners, sessions and attempts). */
  newId?: () => string;
  /**
   * How long a submission claim is exclusively owned. After this, another caller may take it
   * and evaluate again. Defaults to DEFAULT_CLAIM_LEASE_MS.
   */
  claimLeaseMs?: number;
}

interface LearnerEntry {
  id: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  lastTouchedAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
}

interface SessionEntry {
  id: string;
  learnerId: string;
  challengeId: string;
  challengeVersion: string;
  status: "active" | "completed";
  revision: number;
  attemptCount: number;
  wrongAttempts: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: CompletionResult;
  supersededAt?: number;
}

/** Frozen copies, so callers can neither see nor change the store's own entries. */
function toLearner(entry: LearnerEntry): LearnerRecord {
  return Object.freeze({
    id: entry.id,
    revision: entry.revision,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastTouchedAt: entry.lastTouchedAt,
    idleExpiresAt: entry.idleExpiresAt,
    absoluteExpiresAt: entry.absoluteExpiresAt,
  });
}

function toSession(entry: SessionEntry): ChallengeSessionRecord {
  return Object.freeze({
    id: entry.id,
    learnerId: entry.learnerId,
    challengeId: entry.challengeId,
    challengeVersion: entry.challengeVersion,
    status: entry.status,
    revision: entry.revision,
    attemptCount: entry.attemptCount,
    wrongAttempts: entry.wrongAttempts,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(entry.completedAt === undefined ? {} : { completedAt: entry.completedAt }),
    // Already a frozen copy (see copyResult), so handing it out shares nothing mutable.
    ...(entry.result === undefined ? {} : { result: entry.result }),
    ...(entry.supersededAt === undefined ? {} : { supersededAt: entry.supersededAt }),
  });
}

export class MemoryStore implements LearnerStore, ChallengeSessionStore, AttemptStore {
  // Learners are keyed by token hash. The raw token never reaches this class.
  private readonly learners = new Map<TokenHash, LearnerEntry>();
  private readonly learnerIds = new Set<string>();
  private readonly sessions = new Map<string, SessionEntry>();
  // "learnerId + challengeId" to session id: at most one session per learner and challenge.
  private readonly sessionIndex = new Map<string, string>();
  private readonly attempts = new Map<string, DiagnosisAttemptRecord[]>();
  /** Live claims, keyed by session id and submission id. Not attempts, and not visible to list(). */
  private readonly claims = new Map<string, { requestHash: string; token: string; claimedAt: number; expiresAt: number }>();
  private readonly policy: ExpiryPolicy;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly claimLeaseMs: number;

  constructor({ policy, now = Date.now, newId = randomUUID, claimLeaseMs = DEFAULT_CLAIM_LEASE_MS }: MemoryStoreOptions = {}) {
    this.policy = createExpiryPolicy(policy);
    this.now = now;
    this.newId = newId;
    if (!Number.isFinite(claimLeaseMs) || claimLeaseMs < 1) {
      throw new StoreError("invalid-input", "claimLeaseMs must be a positive number of milliseconds.");
    }
    this.claimLeaseMs = claimLeaseMs;
  }

  /* ------------------------------ LearnerStore ----------------------------- */

  async create(input: NewLearner): Promise<LearnerRecord> {
    assertTokenHash(input.tokenHash);
    if (this.learners.has(input.tokenHash)) {
      throw new StoreError("duplicate-token", "A learner already exists for this token hash.");
    }

    const now = this.now();
    const times = initialTimes(this.policy, now);
    const entry: LearnerEntry = {
      id: this.newId(),
      revision: 0,
      createdAt: times.createdAt,
      updatedAt: now,
      lastTouchedAt: times.lastTouchedAt,
      idleExpiresAt: times.idleExpiresAt,
      absoluteExpiresAt: times.absoluteExpiresAt,
    };
    this.learners.set(input.tokenHash, entry);
    this.learnerIds.add(entry.id);
    return toLearner(entry);
  }

  async findByTokenHash(tokenHash: TokenHash): Promise<LearnerLookup> {
    assertTokenHash(tokenHash);
    const entry = this.learners.get(tokenHash);
    if (!entry) return Object.freeze({ state: "none" });

    const now = this.now();
    if (isPurgeable(this.policy, entry, now)) return Object.freeze({ state: "none" });
    const expiry = expiryState(entry, now);
    if (expiry.state === "expired") return Object.freeze({ state: "expired", by: expiry.by });
    return Object.freeze({ state: "active", learner: toLearner(entry) });
  }

  async touch(tokenHash: TokenHash, activity: LearnerActivity): Promise<LearnerTouch> {
    assertTokenHash(tokenHash);
    const entry = this.learners.get(tokenHash);
    if (!entry) return Object.freeze({ state: "none" });

    const now = this.now();
    if (isPurgeable(this.policy, entry, now)) return Object.freeze({ state: "none" });
    const expiry = expiryState(entry, now);
    // An expired learner is never revived and is left exactly as it was.
    if (expiry.state === "expired") return Object.freeze({ state: "expired", by: expiry.by });

    if (!shouldRefresh(this.policy, entry, now, activity)) {
      return Object.freeze({ state: "active", learner: toLearner(entry), refreshed: false });
    }
    entry.idleExpiresAt = refreshedIdleExpiry(this.policy, entry, now);
    entry.lastTouchedAt = now;
    entry.updatedAt = now;
    entry.revision += 1;
    return Object.freeze({ state: "active", learner: toLearner(entry), refreshed: true });
  }

  async purgeExpired(): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const [tokenHash, entry] of this.learners) {
      if (!isPurgeable(this.policy, entry, now)) continue;
      this.learners.delete(tokenHash);
      this.learnerIds.delete(entry.id);
      this.removeLearnerData(entry.id);
      removed += 1;
    }
    return removed;
  }

  /** Deletes a purged learner's sessions and attempts, so nothing is left behind. */
  private removeLearnerData(learnerId: string): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.learnerId !== learnerId) continue;
      this.sessions.delete(sessionId);
      this.sessionIndex.delete(this.indexKey(session));
      this.attempts.delete(sessionId);
      for (const key of this.claims.keys()) {
        if (key.startsWith(`${sessionId}\0`)) this.claims.delete(key);
      }
    }
  }

  /* -------------------------- ChallengeSessionStore ------------------------ */

  private indexKey(owner: ChallengeSessionOwner): string {
    return JSON.stringify([owner.learnerId, owner.challengeId]);
  }

  async start(input: StartChallengeSession): Promise<{ session: ChallengeSessionRecord; created: boolean }> {
    assertNonEmpty(input.learnerId, "learnerId");
    assertNonEmpty(input.challengeId, "challengeId");
    assertNonEmpty(input.challengeVersion, "challengeVersion");
    if (!this.learnerIds.has(input.learnerId)) {
      throw new StoreError("not-found", "No such learner.");
    }

    const existingId = this.sessionIndex.get(this.indexKey(input));
    const existing = existingId === undefined ? undefined : this.sessions.get(existingId);
    if (existing) return Object.freeze({ session: toSession(existing), created: false });

    return Object.freeze({ session: toSession(this.#openSession(input)), created: true });
  }

  /** A new active session, registered as the learner's current one for the challenge. */
  #openSession(input: StartChallengeSession): SessionEntry {
    const now = this.now();
    const entry: SessionEntry = {
      id: this.newId(),
      learnerId: input.learnerId,
      challengeId: input.challengeId,
      challengeVersion: input.challengeVersion,
      status: "active",
      revision: 0,
      attemptCount: 0,
      wrongAttempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(entry.id, entry);
    this.sessionIndex.set(this.indexKey(entry), entry.id);
    this.attempts.set(entry.id, []);
    return entry;
  }

  async restart(input: RestartChallengeSession): Promise<{ session: ChallengeSessionRecord; restarted: boolean }> {
    assertNonEmpty(input.learnerId, "learnerId");
    assertNonEmpty(input.challengeId, "challengeId");
    assertNonEmpty(input.challengeVersion, "challengeVersion");
    assertNonEmpty(input.supersedes, "supersedes");
    if (!this.learnerIds.has(input.learnerId)) {
      throw new StoreError("not-found", "No such learner.");
    }

    const currentId = this.sessionIndex.get(this.indexKey(input));
    const current = currentId === undefined ? undefined : this.sessions.get(currentId);
    if (!current) throw new StoreError("not-found", "No such session.");

    // Compare-and-set: only the session the caller found stale, only while it is unfinished, only to a different version.
    if (current.id !== input.supersedes || current.status !== "active" || current.challengeVersion === input.challengeVersion) {
      return Object.freeze({ session: toSession(current), restarted: false });
    }

    const now = this.now();
    current.supersededAt = now;
    current.updatedAt = now;
    current.revision += 1;
    return Object.freeze({ session: toSession(this.#openSession(input)), restarted: true });
  }

  async find(owner: ChallengeSessionOwner): Promise<ChallengeSessionRecord | null> {
    assertNonEmpty(owner.learnerId, "learnerId");
    assertNonEmpty(owner.challengeId, "challengeId");
    const id = this.sessionIndex.get(this.indexKey(owner));
    const entry = id === undefined ? undefined : this.sessions.get(id);
    return entry ? toSession(entry) : null;
  }

  async listCurrentCompleted(learnerId: string): Promise<readonly ChallengeSessionRecord[]> {
    assertNonEmpty(learnerId, "learnerId");
    const completed: SessionEntry[] = [];
    for (const entry of this.sessions.values()) {
      if (entry.learnerId === learnerId && entry.status === "completed" && entry.supersededAt === undefined) {
        completed.push(entry);
      }
    }
    completed.sort((a, b) => b.completedAt! - a.completedAt! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return Object.freeze(completed.map(toSession));
  }

  /* ------------------------------ AttemptStore ----------------------------- */

  /** The session, or a thrown error if it does not exist or belongs to another learner. */
  private ownedSession(owner: AttemptOwner): SessionEntry {
    assertNonEmpty(owner.learnerId, "learnerId");
    assertNonEmpty(owner.sessionId, "sessionId");
    const session = this.sessions.get(owner.sessionId);
    if (!session) throw new StoreError("not-found", "No such session.");
    if (session.learnerId !== owner.learnerId) {
      throw new StoreError("not-owner", "This session belongs to another learner.");
    }
    return session;
  }

  async record(input: RecordAttemptInput): Promise<RecordAttemptResult> {
    const session = this.ownedSession(input);
    if (session.supersededAt !== undefined) {
      throw new StoreError("superseded", "This session was replaced by a restart and accepts no more attempts.");
    }
    const result = validateRecordInput(input);

    const history = this.attempts.get(session.id) ?? [];
    const now = this.now();
    const blocked = refusal(session, history, input, now);
    if (blocked) return blocked;

    // 4. Record it. A correct outcome completes the session in the same step.
    const attempt: DiagnosisAttemptRecord = {
      id: this.newId(),
      sessionId: session.id,
      challengeId: session.challengeId,
      seq: history.length + 1,
      submissionId: input.submissionId,
      requestHash: input.requestHash,
      rootCauseId: input.rootCauseId,
      explanation: input.explanation,
      evidence: input.evidence.map((ref) => ({ ...ref })),
      outcome: input.outcome,
      createdAt: now,
    };
    history.push(attempt);
    this.attempts.set(session.id, history);

    session.attemptCount = history.length;
    session.updatedAt = now;
    session.revision += 1;
    if (input.outcome === "correct") {
      session.status = "completed";
      session.completedAt = now;
      session.result = result;
    } else {
      session.wrongAttempts += 1;
    }

    return Object.freeze({
      kind: "recorded",
      attempt: toAttempt(attempt),
      session: toSession(session),
      window: toWindow(windowOf(history, input.window, now)),
    });
  }

  async reserve(input: ReserveSubmissionInput): Promise<ReserveSubmissionResult> {
    const session = this.ownedSession(input);
    if (session.supersededAt !== undefined) {
      throw new StoreError("superseded", "This session was replaced by a restart and accepts no more attempts.");
    }
    validateSubmissionIdentity(input);
    const history = this.attempts.get(session.id) ?? [];
    const now = this.now();
    const blocked = refusal(session, history, input, now);
    if (blocked) return blocked;

    const key = claimKey(session.id, input.submissionId);
    const existing = this.claims.get(key);
    const decision = decideClaim(existing, input.requestHash, now);
    if (decision.kind === "in-progress") return Object.freeze({ kind: "in-progress", expiresAt: decision.expiresAt });
    if (decision.kind === "conflict") return Object.freeze({ kind: "conflict" });

    const claim = {
      requestHash: input.requestHash,
      token: this.newId(),
      claimedAt: now,
      expiresAt: now + this.claimLeaseMs,
    };
    this.claims.set(key, claim);
    return Object.freeze({ kind: "claimed", claim: toClaim(session.id, input.submissionId, claim) });
  }

  async finalize(input: FinalizeClaimInput): Promise<FinalizeClaimResult> {
    const session = this.ownedSession(input);
    if (session.supersededAt !== undefined) {
      throw new StoreError("superseded", "This session was replaced by a restart and accepts no more attempts.");
    }
    const key = claimKey(session.id, input.submissionId);
    const claim = this.claims.get(key);
    if (!claim || claim.token !== input.claimToken || claim.requestHash !== input.requestHash) {
      return Object.freeze({ kind: "claim-lost" });
    }
    const result = validateRecordInput(input);
    const history = this.attempts.get(session.id) ?? [];
    const now = this.now();
    const blocked = refusal(session, history, input, now);
    if (blocked) {
      this.claims.delete(key);
      return blocked;
    }

    // Apply the attempt and drop the claim together. Nothing above has mutated the session.
    const attempt: DiagnosisAttemptRecord = {
      id: this.newId(),
      sessionId: session.id,
      challengeId: session.challengeId,
      seq: history.length + 1,
      submissionId: input.submissionId,
      requestHash: input.requestHash,
      rootCauseId: input.rootCauseId,
      explanation: input.explanation,
      evidence: input.evidence.map((ref) => ({ ...ref })),
      outcome: input.outcome,
      createdAt: now,
    };
    history.push(attempt);
    this.attempts.set(session.id, history);
    this.claims.delete(key);
    session.attemptCount = history.length;
    session.updatedAt = now;
    session.revision += 1;
    if (input.outcome === "correct") {
      session.status = "completed";
      session.completedAt = now;
      session.result = result;
    } else {
      session.wrongAttempts += 1;
    }
    return Object.freeze({
      kind: "recorded",
      attempt: toAttempt(attempt),
      session: toSession(session),
      window: toWindow(windowOf(history, input.window, now)),
    });
  }

  async releaseClaim(input: ReleaseClaimInput): Promise<void> {
    assertNonEmpty(input.sessionId, "sessionId");
    assertNonEmpty(input.claimToken, "claimToken");
    for (const [key, claim] of this.claims) {
      if (key.startsWith(`${input.sessionId}\0`) && claim.token === input.claimToken) {
        this.claims.delete(key);
        return;
      }
    }
  }

  async list(owner: AttemptOwner): Promise<readonly DiagnosisAttemptRecord[]> {
    const session = this.ownedSession(owner);
    return Object.freeze((this.attempts.get(session.id) ?? []).map(toAttempt));
  }

  async windowStatus(owner: AttemptOwner, window: AttemptWindow): Promise<WindowStatus> {
    const session = this.ownedSession(owner);
    assertWindow(window);
    return toWindow(windowOf(this.attempts.get(session.id) ?? [], window, this.now()));
  }
}

/** Duplicate, conflict, completed and rate-limited, in the attempt-contract order. */
function refusal(
  session: SessionEntry,
  history: readonly DiagnosisAttemptRecord[],
  input: ReserveSubmissionInput,
  now: number,
): Exclude<ReserveSubmissionResult, { kind: "claimed" | "in-progress" }> | undefined {
  const decision = decideRecordedAttempt(history, session.status, input, now);
  const window = toWindow(windowOf(history, input.window, now));
  if (decision.kind === "duplicate") {
    const sameId = history.find((attempt) => attempt.submissionId === input.submissionId)!;
    return Object.freeze({ kind: "duplicate", attempt: toAttempt(sameId), session: toSession(session), window });
  }
  if (decision.kind === "conflict") return Object.freeze({ kind: "conflict" });
  if (decision.kind === "already-completed") {
    const correct = history.find((attempt) => attempt.outcome === "correct");
    if (!correct) throw new StoreError("invalid-input", "A completed session has no correct attempt.");
    return Object.freeze({ kind: "already-completed", attempt: toAttempt(correct), session: toSession(session), window });
  }
  if (decision.kind === "rate-limited") {
    return Object.freeze({ kind: "rate-limited", retryAfterMs: decision.retryAfterMs, window });
  }
  return undefined;
}

function claimKey(sessionId: string, submissionId: string): string {
  return `${sessionId}\0${submissionId}`;
}

function toClaim(
  sessionId: string,
  submissionId: string,
  claim: { requestHash: string; token: string; expiresAt: number },
): SubmissionClaim {
  return Object.freeze({
    token: claim.token,
    sessionId,
    submissionId,
    requestHash: claim.requestHash,
    expiresAt: claim.expiresAt,
  });
}
