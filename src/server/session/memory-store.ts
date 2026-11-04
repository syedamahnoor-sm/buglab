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
import { isTokenHash } from "./token";
import {
  StoreError,
  type AttemptOutcome,
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
  type RecordAttemptInput,
  type RecordAttemptResult,
  type RestartChallengeSession,
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

const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_SUBMISSION_ID_LENGTH = 128;
const OUTCOMES: readonly AttemptOutcome[] = ["correct", "incorrect"];

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

const isCount = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A frozen deep copy of a completion result, or a thrown invalid-input error if it is not one. */
function copyResult(result: unknown): CompletionResult {
  const r = result as Partial<CompletionResult> | null | undefined;
  const f = r?.feedback;
  const e = f?.evidenceSummary;
  const valid =
    typeof r === "object" && r !== null &&
    typeof r.resolutionSummary === "string" && r.resolutionSummary.length > 0 &&
    typeof f === "object" && f !== null &&
    typeof f.headline === "string" &&
    Array.isArray(f.hints) && f.hints.every((hint) => typeof hint === "string") &&
    typeof e === "object" && e !== null && isCount(e.total) && isCount(e.logs) && isCount(e.network);
  if (!valid) {
    throw new StoreError("invalid-input", "A completion result needs a resolution summary and feedback with a headline, hints and an evidence summary.");
  }
  return Object.freeze({
    resolutionSummary: r.resolutionSummary as string,
    feedback: Object.freeze({
      headline: f.headline,
      hints: Object.freeze([...f.hints]) as string[],
      evidenceSummary: Object.freeze({ total: e.total, logs: e.logs, network: e.network }),
    }),
  });
}

function toAttempt(entry: DiagnosisAttemptRecord): DiagnosisAttemptRecord {
  return Object.freeze({
    ...entry,
    evidence: Object.freeze(entry.evidence.map((ref) => Object.freeze({ ...ref }))),
  });
}

function toWindow(status: WindowStatus): WindowStatus {
  return Object.freeze({ ...status });
}

function assertTokenHash(value: unknown): asserts value is TokenHash {
  if (!isTokenHash(value)) {
    throw new StoreError("invalid-input", "Expected a SHA-256 token hash (64 lowercase hex characters).");
  }
}

function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StoreError("invalid-input", `${name} must be a non-empty string.`);
  }
}

function assertWindow(window: AttemptWindow): void {
  if (!Number.isInteger(window?.limit) || window.limit < 1 || !Number.isFinite(window?.windowMs) || window.windowMs <= 0) {
    throw new StoreError("invalid-input", "window needs an integer limit of at least 1 and a positive windowMs.");
  }
}

export class MemoryStore implements LearnerStore, ChallengeSessionStore, AttemptStore {
  // Learners are keyed by token hash. The raw token never reaches this class.
  private readonly learners = new Map<TokenHash, LearnerEntry>();
  private readonly learnerIds = new Set<string>();
  private readonly sessions = new Map<string, SessionEntry>();
  // "learnerId + challengeId" to session id: at most one session per learner and challenge.
  private readonly sessionIndex = new Map<string, string>();
  private readonly attempts = new Map<string, DiagnosisAttemptRecord[]>();
  private readonly policy: ExpiryPolicy;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor({ policy, now = Date.now, newId = randomUUID }: MemoryStoreOptions = {}) {
    this.policy = createExpiryPolicy(policy);
    this.now = now;
    this.newId = newId;
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

  private windowOf(attempts: readonly DiagnosisAttemptRecord[], window: AttemptWindow, now: number): WindowStatus {
    const counted = attempts.filter((attempt) => attempt.outcome === "incorrect" && attempt.createdAt > now - window.windowMs);
    if (counted.length === 0) return { used: 0, limit: window.limit };
    const oldest = Math.min(...counted.map((attempt) => attempt.createdAt));
    return { used: counted.length, limit: window.limit, resetsAt: oldest + window.windowMs };
  }

  async record(input: RecordAttemptInput): Promise<RecordAttemptResult> {
    const session = this.ownedSession(input);
    if (session.supersededAt !== undefined) {
      throw new StoreError("superseded", "This session was replaced by a restart and accepts no more attempts.");
    }
    assertNonEmpty(input.submissionId, "submissionId");
    if (input.submissionId.length > MAX_SUBMISSION_ID_LENGTH) {
      throw new StoreError("invalid-input", "submissionId is too long.");
    }
    if (!SHA256_HEX.test(input.requestHash)) {
      throw new StoreError("invalid-input", "requestHash must be a SHA-256 hash (64 lowercase hex characters).");
    }
    assertNonEmpty(input.rootCauseId, "rootCauseId");
    if (typeof input.explanation !== "string" || !Array.isArray(input.evidence)) {
      throw new StoreError("invalid-input", "A submission needs an explanation and an evidence list.");
    }
    if (!OUTCOMES.includes(input.outcome)) {
      throw new StoreError("invalid-input", "outcome must be correct or incorrect.");
    }
    // A correct outcome completes the session and must say what the learner was shown. Nothing else may carry a result.
    if (input.outcome === "incorrect" && input.result !== undefined) {
      throw new StoreError("invalid-input", "Only a correct outcome carries a completion result.");
    }
    const result = input.outcome === "correct" ? copyResult(input.result) : undefined;
    assertWindow(input.window);

    const history = this.attempts.get(session.id) ?? [];
    const now = this.now();
    const window = this.windowOf(history, input.window, now);

    // 1. A submission id already used in this session: a retry, or a reused id.
    const sameId = history.find((attempt) => attempt.submissionId === input.submissionId);
    if (sameId) {
      return sameId.requestHash === input.requestHash
        ? Object.freeze({ kind: "duplicate", attempt: toAttempt(sameId), session: toSession(session), window: toWindow(window) })
        : Object.freeze({ kind: "conflict" });
    }

    // 2. The session is already completed: nothing more is recorded.
    if (session.status === "completed") {
      const correct = history.find((attempt) => attempt.outcome === "correct");
      if (!correct) throw new StoreError("invalid-input", "A completed session has no correct attempt.");
      return Object.freeze({
        kind: "already-completed",
        attempt: toAttempt(correct),
        session: toSession(session),
        window: toWindow(window),
      });
    }

    // 3. The window is full of incorrect attempts: blocked, whatever this one would have been.
    if (window.used >= window.limit) {
      const retryAfterMs = Math.max(1, (window.resetsAt ?? now) - now);
      return Object.freeze({ kind: "rate-limited", retryAfterMs, window: toWindow(window) });
    }

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
      window: toWindow(this.windowOf(history, input.window, now)),
    });
  }

  async list(owner: AttemptOwner): Promise<readonly DiagnosisAttemptRecord[]> {
    const session = this.ownedSession(owner);
    return Object.freeze((this.attempts.get(session.id) ?? []).map(toAttempt));
  }

  async windowStatus(owner: AttemptOwner, window: AttemptWindow): Promise<WindowStatus> {
    const session = this.ownedSession(owner);
    assertWindow(window);
    return toWindow(this.windowOf(this.attempts.get(session.id) ?? [], window, this.now()));
  }
}
