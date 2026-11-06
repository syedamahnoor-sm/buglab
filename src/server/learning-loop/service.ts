/*
 * The Learning Loop service: reflection CRUD plus the derived journal and activity reads. Server-only.
 *
 * Mirrors the identity rules of LearnerSessionService without extending it:
 *
 *  1. Identity comes only from the learner cookie: parseSessionToken -> hashSessionToken -> learner
 *     store touch. No method accepts a learner id or a challenge session id from a caller; the
 *     session a reflection is tied to is resolved here, from the learner's own completed session.
 *  2. The publication gate is the challenge registry (the same gated registry the session service
 *     gets) and applies to CREATING a reflection only: an unpublished challenge is an unknown
 *     challenge, refused BEFORE the learner is looked up, so it is not an oracle and nothing is
 *     refreshed. A reflection that already exists is the learner's own text: it stays readable,
 *     listable, editable and deletable (and in the journal and activity feed) whether or not its
 *     challenge is still published.
 *  3. The public Reflection never contains challengeSessionId, learnerId or deletedAt.
 *
 * The journal (active reflections) pages in the store with a keyset condition. The activity feed
 * (current completions + active reflections) pages in the store when the store implements
 * `listActivity` (PostgreSQL: one UNION query with keyset + LIMIT). Memory stores omit that method;
 * the service then merges the two sources in process with the same order and cursor rules. Nothing is
 * stored for either view. Pure helpers are in derive.ts.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import type { IssuedCookie } from "../session/cookie";
import { cookieMaxAgeSeconds } from "../session/expiry";
import { hashSessionToken, parseSessionToken } from "../session/token";
import type { ChallengeSessionStore, LearnerRecord, LearnerStore, SessionToken } from "../session/types";
import { findReflectionEligibleSession, listCompletions } from "./completion-read";
import { decodeActivityCursor, decodeJournalCursor, encodeActivityCursor, encodeJournalCursor } from "./cursors";
import {
  activityRowFromStore,
  compareActivity,
  completionRow,
  journalKeyOf,
  parseKinds,
  readPageRequest,
  reflectionRow,
  takePage,
  toJournalEntry,
  type ActivityItem,
  type ActivityRow,
  type JournalEntry,
  type PageOptions,
} from "./derive";
import { normalizeReflectionBody } from "./store-rules";
import { LearningLoopStoreError, type LearningLoopStore, type LearningReflectionRecord } from "./types";

export type { ActivityItem, JournalEntry, PageOptions } from "./derive";

/** The publication gate: whether a challenge id is published. Consulted when a reflection is created. */
export interface PublishedChallenges {
  has(challengeId: string): boolean;
}

export interface LearningLoopServiceDeps {
  learners: LearnerStore;
  sessions: Pick<ChallengeSessionStore, "find" | "listCurrentCompleted">;
  store: LearningLoopStore;
  registry: PublishedChallenges;
  /** Share the learner store's clock in tests so cookie lifetimes agree with expiry. Defaults to the real clock. */
  now?: () => number;
  /** Source of reflection ids. Defaults to `refl_<uuid>`. */
  newId?: () => string;
}

/** Active reflection as the API returns it. Times are ISO-8601 UTC. */
export type Reflection = {
  readonly id: string;
  readonly challengeId: string;
  readonly completedAt: string;
  readonly body: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** What DELETE returns. */
export type SoftDeletedReflection = {
  readonly id: string;
  readonly challengeId: string;
  readonly revision: number;
  readonly deleted: true;
  /** When it was soft-deleted (ISO-8601 UTC). Additive (J6). */
  readonly deletedAt: string;
};

export type LearningLoopRejectionCode =
  | "learner-missing"
  | "learner-expired"
  | "unknown-challenge"
  | "completion-required"
  | "not-found"
  | "validation-failed"
  | "reflection-already-exists"
  | "revision-conflict"
  | "invalid-cursor";

export interface LearningLoopRejection {
  readonly status: "rejected";
  readonly code: LearningLoopRejectionCode;
  readonly currentRevision?: number;
  readonly existingReflectionId?: string;
}

type WriteResult<T> = LearningLoopRejection | ({ readonly status: "ok"; readonly cookie: IssuedCookie } & T);
type ReadResult<T> = LearningLoopRejection | ({ readonly status: "ok"; readonly cookie?: IssuedCookie } & T);

export type CreateReflectionResult = WriteResult<{ readonly reflection: Reflection }>;
export type ListReflectionsResult = ReadResult<{ readonly reflections: readonly Reflection[] }>;
export type GetReflectionResult = ReadResult<{ readonly reflection: Reflection }>;
export type UpdateReflectionResult = WriteResult<{ readonly reflection: Reflection }>;
export type DeleteReflectionResult = WriteResult<{ readonly reflection: SoftDeletedReflection }>;

export type ListJournalResult = ReadResult<{ readonly entries: readonly JournalEntry[]; readonly nextCursor: string | null }>;
export type ListActivityResult = ReadResult<{ readonly items: readonly ActivityItem[]; readonly nextCursor: string | null }>;

export type ActivityOptions = PageOptions & { kinds?: readonly string[] };

type Authenticated =
  | { readonly state: "active"; readonly learner: LearnerRecord; readonly token: SessionToken; readonly refreshed: boolean }
  | { readonly state: "missing" }
  | { readonly state: "expired" };

const reject = (
  code: LearningLoopRejectionCode,
  extra: { currentRevision?: number; existingReflectionId?: string } = {},
): LearningLoopRejection => ({ status: "rejected", code, ...extra });

const MAX_CHALLENGE_ID = 128;
const isChallengeId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= MAX_CHALLENGE_ID;
const isRevision = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const isBody = (v: unknown): v is string => typeof v === "string";

export function toReflection(record: LearningReflectionRecord): Reflection {
  return {
    id: record.id,
    challengeId: record.challengeId,
    completedAt: new Date(record.completedAt).toISOString(),
    body: record.body,
    revision: record.revision,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
}

export class LearningLoopService {
  private readonly learners: LearnerStore;
  private readonly sessions: Pick<ChallengeSessionStore, "find" | "listCurrentCompleted">;
  private readonly store: LearningLoopStore;
  private readonly registry: PublishedChallenges;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(deps: LearningLoopServiceDeps) {
    this.learners = deps.learners;
    this.sessions = deps.sessions;
    this.store = deps.store;
    this.registry = deps.registry;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => `refl_${randomUUID()}`);
  }

  /** Creates the learner's single active reflection for a challenge they have completed. */
  async createReflection(cookieValue: unknown, input: { challengeId: unknown; body: unknown }): Promise<CreateReflectionResult> {
    const challengeId = input?.challengeId;
    if (!isChallengeId(challengeId)) return reject("validation-failed");
    if (!this.registry.has(challengeId)) return reject("unknown-challenge");
    const auth = await this.authenticate(cookieValue, "write");
    if (auth.state !== "active") return this.unauthorized(auth);

    if (!isBody(input.body)) return reject("validation-failed");
    const body = this.validBody(input.body);
    if (body === null) return reject("validation-failed");

    const eligible = await findReflectionEligibleSession(this.sessions, auth.learner.id, challengeId);
    if (!eligible) return reject("completion-required");

    try {
      const record = await this.store.createReflection({
        learnerId: auth.learner.id,
        challengeId,
        challengeSessionId: eligible.sessionId,
        body,
        completedAt: eligible.completedAt,
        now: this.now(),
        newId: this.newId,
      });
      return { status: "ok", reflection: toReflection(record), cookie: this.cookieFor(auth) };
    } catch (error) {
      return this.mapStoreError(error);
    }
  }

  /** The learner's active reflections, optionally for one challenge. Publication does not hide them. */
  async listReflections(cookieValue: unknown, options: { challengeId?: string } = {}): Promise<ListReflectionsResult> {
    const filter = options.challengeId;
    if (filter !== undefined && !isChallengeId(filter)) return reject("validation-failed");
    const auth = await this.authenticate(cookieValue, "read");
    if (auth.state !== "active") return this.unauthorized(auth);

    const records = await this.store.listActiveReflections(auth.learner.id, filter === undefined ? {} : { challengeId: filter });
    return { status: "ok", reflections: records.map(toReflection), ...this.refreshedCookie(auth) };
  }

  async getReflection(cookieValue: unknown, reflectionId: string): Promise<GetReflectionResult> {
    const auth = await this.authenticate(cookieValue, "read");
    if (auth.state !== "active") return this.unauthorized(auth);
    const record = await this.visible(auth.learner.id, reflectionId);
    if (!record) return reject("not-found");
    return { status: "ok", reflection: toReflection(record), ...this.refreshedCookie(auth) };
  }

  async updateReflection(
    cookieValue: unknown,
    reflectionId: string,
    input: { body: unknown; revision: unknown },
  ): Promise<UpdateReflectionResult> {
    const auth = await this.authenticate(cookieValue, "write");
    if (auth.state !== "active") return this.unauthorized(auth);
    if (!isBody(input?.body) || !isRevision(input.revision)) return reject("validation-failed");
    const body = this.validBody(input.body);
    if (body === null) return reject("validation-failed");
    if (!(await this.visible(auth.learner.id, reflectionId))) return reject("not-found");

    try {
      const record = await this.store.updateReflection({
        learnerId: auth.learner.id,
        reflectionId,
        body,
        revision: input.revision,
        now: this.now(),
      });
      return { status: "ok", reflection: toReflection(record), cookie: this.cookieFor(auth) };
    } catch (error) {
      return this.mapStoreError(error);
    }
  }

  /** Soft-deletes. Completion is untouched and there is no restore. */
  async deleteReflection(cookieValue: unknown, reflectionId: string, input: { revision: unknown }): Promise<DeleteReflectionResult> {
    const auth = await this.authenticate(cookieValue, "write");
    if (auth.state !== "active") return this.unauthorized(auth);
    if (!isRevision(input?.revision)) return reject("validation-failed");
    if (!(await this.visible(auth.learner.id, reflectionId))) return reject("not-found");

    let record: LearningReflectionRecord;
    try {
      record = await this.store.softDeleteReflection({
        learnerId: auth.learner.id,
        reflectionId,
        revision: input.revision,
        now: this.now(),
      });
    } catch (error) {
      return this.mapStoreError(error);
    }
    // The store owns the soft-delete time (it may be later than `now` under clock skew, never earlier than createdAt).
    // A store that returns a deleted record without one is broken: that is an internal error, never a made-up time.
    if (record.deletedAt === null) throw new Error("LearningLoopStore.softDeleteReflection returned a record without deletedAt.");
    return {
      status: "ok",
      reflection: {
        id: record.id,
        challengeId: record.challengeId,
        revision: record.revision,
        deleted: true,
        deletedAt: new Date(record.deletedAt).toISOString(),
      },
      cookie: this.cookieFor(auth),
    };
  }

  /**
   * The learner's active reflections as journal entries: updatedAt DESC, challengeId ASC, id ASC.
   * Paged in the store (keyset WHERE + LIMIT), one row beyond the page to tell whether more remain.
   * Reflections of since-unpublished challenges are still the learner's own and stay in the journal.
   */
  async listJournal(cookieValue: unknown, options: PageOptions = {}): Promise<ListJournalResult> {
    const request = readPageRequest(options, decodeJournalCursor);
    if ("refused" in request) return reject(request.refused);
    const auth = await this.authenticate(cookieValue, "read");
    if (auth.state !== "active") return this.unauthorized(auth);

    const records = await this.store.listActiveReflections(auth.learner.id, {
      limit: request.limit + 1,
      ...(request.after ? { after: request.after } : {}),
    });
    const { page, last } = takePage(records, request.limit);
    return {
      status: "ok",
      entries: page.map(toJournalEntry),
      nextCursor: last ? encodeJournalCursor(journalKeyOf(last)) : null,
      ...this.refreshedCookie(auth),
    };
  }

  /**
   * Derived timeline: the learner's CURRENT completed sessions (unaffected by reflection
   * soft-delete, and by whether the challenge is still published) plus their active reflections.
   * occurredAt DESC, kindRank ASC, sourceId ASC.
   * Recall kinds are accepted in `kinds` but contribute nothing (no recall persistence exists);
   * a recall-only filter therefore yields an empty list, never a substitute.
   *
   * When the store implements `listActivity` (PostgreSQL), paging is a single keyset query. Otherwise
   * (Memory) both sources are loaded, merged, and sliced here with the same cursor rules.
   */
  async listActivity(cookieValue: unknown, options: ActivityOptions = {}): Promise<ListActivityResult> {
    const request = readPageRequest(options, decodeActivityCursor);
    if ("refused" in request) return reject(request.refused);
    const kinds = parseKinds(options.kinds);
    if (kinds === null) return reject("validation-failed");
    const auth = await this.authenticate(cookieValue, "read");
    if (auth.state !== "active") return this.unauthorized(auth);

    const includeCompletions = kinds.has("challenge.completed");
    const includeReflections = kinds.has("reflection.updated");
    const rows = await this.activityRows(auth.learner.id, {
      includeCompletions,
      includeReflections,
      after: request.after,
      limit: request.limit + 1,
    });
    const { page, last } = takePage(rows, request.limit);
    return {
      status: "ok",
      items: page.map((row) => row.item),
      nextCursor: last ? encodeActivityCursor(last.key) : null,
      ...this.refreshedCookie(auth),
    };
  }

  /* -------------------------------- Helpers -------------------------------- */

  /**
   * Store-level activity page when available; otherwise the Memory merge (load both sources, sort, keyset-filter).
   * Always asks the store for at most `limit` rows when the store pages; Memory may load more before slicing.
   */
  private async activityRows(
    learnerId: string,
    options: {
      includeCompletions: boolean;
      includeReflections: boolean;
      after: { occurredAt: number; kindRank: number; sourceId: string } | null;
      limit: number;
    },
  ): Promise<ActivityRow[]> {
    if (typeof this.store.listActivity === "function") {
      return (
        await this.store.listActivity(learnerId, {
          includeCompletions: options.includeCompletions,
          includeReflections: options.includeReflections,
          limit: options.limit,
          ...(options.after ? { after: options.after } : {}),
        })
      ).map(activityRowFromStore);
    }

    const rows: ActivityRow[] = [];
    if (options.includeCompletions) rows.push(...(await listCompletions(this.sessions, learnerId)).map(completionRow));
    if (options.includeReflections) rows.push(...(await this.store.listActiveReflections(learnerId)).map(reflectionRow));
    rows.sort((a, b) => compareActivity(a.key, b.key));
    const filtered = options.after ? rows.filter((row) => compareActivity(row.key, options.after!) > 0) : rows;
    return filtered.slice(0, options.limit);
  }

  /** The learner's active reflection, or null if it is unknown, foreign or deleted. Publication does not matter here. */
  private async visible(learnerId: string, reflectionId: string): Promise<LearningReflectionRecord | null> {
    if (typeof reflectionId !== "string" || reflectionId.length < 1 || reflectionId.length > 128) return null;
    return this.store.getActiveReflection(learnerId, reflectionId);
  }
  private validBody(raw: string): string | null {
    try {
      return normalizeReflectionBody(raw);
    } catch (error) {
      if (error instanceof LearningLoopStoreError && error.code === "validation-failed") return null;
      throw error;
    }
  }

  private mapStoreError(error: unknown): LearningLoopRejection {
    if (error instanceof LearningLoopStoreError) {
      switch (error.code) {
        case "validation-failed":
          return reject("validation-failed");
        case "not-found":
          return reject("not-found");
        case "revision-conflict":
          return reject("revision-conflict", error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision });
        case "reflection-already-exists":
          return reject(
            "reflection-already-exists",
            error.existingReflectionId === undefined ? {} : { existingReflectionId: error.existingReflectionId },
          );
      }
    }
    throw error;
  }

  /** Parses and hashes the cookie, then records activity. The raw token goes no further than this. */
  private async authenticate(cookieValue: unknown, activity: "read" | "write"): Promise<Authenticated> {
    const token = parseSessionToken(cookieValue);
    if (!token) return { state: "missing" };
    const touch = await this.learners.touch(hashSessionToken(token), activity);
    if (touch.state === "none") return { state: "missing" };
    if (touch.state === "expired") return { state: "expired" };
    return { state: "active", learner: touch.learner, token, refreshed: touch.refreshed };
  }

  private unauthorized(auth: Exclude<Authenticated, { state: "active" }>): LearningLoopRejection {
    return reject(auth.state === "expired" ? "learner-expired" : "learner-missing");
  }

  private cookieFor(auth: Extract<Authenticated, { state: "active" }>): IssuedCookie {
    return { value: auth.token, maxAgeSeconds: cookieMaxAgeSeconds(auth.learner, this.now()) };
  }

  private refreshedCookie(auth: Extract<Authenticated, { state: "active" }>): { cookie?: IssuedCookie } {
    return auth.refreshed ? { cookie: this.cookieFor(auth) } : {};
  }
}

export function createLearningLoopService(deps: LearningLoopServiceDeps): LearningLoopService {
  return new LearningLoopService(deps);
}
