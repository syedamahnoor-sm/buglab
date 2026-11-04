/*
 * In-memory SessionStore. Server-only.
 *
 * DEVELOPMENT AND TEST ONLY: state lives in this process's memory, so it is lost
 * on restart and is not shared across processes, instances, serverless
 * invocations or separately bundled routes. It is not production-ready. Use it to
 * build and test the session flow, and run the same contract suite against the
 * durable store that replaces it.
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
  SessionStoreError,
  type NewSession,
  type SessionActivity,
  type SessionLookup,
  type SessionRecord,
  type SessionStore,
  type SessionTouch,
  type TokenHash,
} from "./types";

export interface MemorySessionStoreOptions {
  /** Expiry rules. Defaults to the centralized DEFAULT_EXPIRY_POLICY. */
  policy?: Partial<ExpiryPolicy>;
  /** The clock, in milliseconds since the epoch. Inject one in tests. */
  now?: () => number;
  /** Source of internal session ids. */
  newId?: () => string;
}

interface Entry {
  id: string;
  challengeId: string;
  challengeVersion: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  lastTouchedAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
}

/** A frozen copy, so callers can neither see nor change the store's own entry. */
function toRecord(entry: Entry): SessionRecord {
  return Object.freeze({
    id: entry.id,
    challengeId: entry.challengeId,
    challengeVersion: entry.challengeVersion,
    revision: entry.revision,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastTouchedAt: entry.lastTouchedAt,
    idleExpiresAt: entry.idleExpiresAt,
    absoluteExpiresAt: entry.absoluteExpiresAt,
  });
}

function assertTokenHash(value: unknown): asserts value is TokenHash {
  if (!isTokenHash(value)) {
    throw new SessionStoreError("invalid-input", "Expected a SHA-256 token hash (64 lowercase hex characters).");
  }
}

function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SessionStoreError("invalid-input", `${name} must be a non-empty string.`);
  }
}

export class MemorySessionStore implements SessionStore {
  // Keyed by token hash. The raw token never reaches this class.
  private readonly entries = new Map<TokenHash, Entry>();
  private readonly policy: ExpiryPolicy;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor({ policy, now = Date.now, newId = randomUUID }: MemorySessionStoreOptions = {}) {
    this.policy = createExpiryPolicy(policy);
    this.now = now;
    this.newId = newId;
  }

  async create(input: NewSession): Promise<SessionRecord> {
    assertTokenHash(input.tokenHash);
    assertNonEmpty(input.challengeId, "challengeId");
    assertNonEmpty(input.challengeVersion, "challengeVersion");
    if (this.entries.has(input.tokenHash)) {
      throw new SessionStoreError("duplicate-token", "A session already exists for this token hash.");
    }

    const now = this.now();
    const times = initialTimes(this.policy, now);
    const entry: Entry = {
      id: this.newId(),
      challengeId: input.challengeId,
      challengeVersion: input.challengeVersion,
      revision: 0,
      createdAt: times.createdAt,
      updatedAt: now,
      lastTouchedAt: times.lastTouchedAt,
      idleExpiresAt: times.idleExpiresAt,
      absoluteExpiresAt: times.absoluteExpiresAt,
    };
    this.entries.set(input.tokenHash, entry);
    return toRecord(entry);
  }

  async findByTokenHash(tokenHash: TokenHash): Promise<SessionLookup> {
    assertTokenHash(tokenHash);
    const entry = this.entries.get(tokenHash);
    if (!entry) return Object.freeze({ state: "none" });

    const now = this.now();
    if (isPurgeable(this.policy, entry, now)) return Object.freeze({ state: "none" });
    const expiry = expiryState(entry, now);
    if (expiry.state === "expired") return Object.freeze({ state: "expired", by: expiry.by });
    return Object.freeze({ state: "active", session: toRecord(entry) });
  }

  async touch(tokenHash: TokenHash, activity: SessionActivity): Promise<SessionTouch> {
    assertTokenHash(tokenHash);
    const entry = this.entries.get(tokenHash);
    if (!entry) return Object.freeze({ state: "none" });

    const now = this.now();
    if (isPurgeable(this.policy, entry, now)) return Object.freeze({ state: "none" });
    const expiry = expiryState(entry, now);
    // An expired session is never revived and is left exactly as it was.
    if (expiry.state === "expired") return Object.freeze({ state: "expired", by: expiry.by });

    if (!shouldRefresh(this.policy, entry, now, activity)) {
      return Object.freeze({ state: "active", session: toRecord(entry), refreshed: false });
    }
    entry.idleExpiresAt = refreshedIdleExpiry(this.policy, entry, now);
    entry.lastTouchedAt = now;
    entry.updatedAt = now;
    entry.revision += 1;
    return Object.freeze({ state: "active", session: toRecord(entry), refreshed: true });
  }

  async purgeExpired(): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const [tokenHash, entry] of this.entries) {
      if (isPurgeable(this.policy, entry, now)) {
        this.entries.delete(tokenHash);
        removed += 1;
      }
    }
    return removed;
  }
}
