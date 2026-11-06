/*
 * Contracts for learner reflections in the Learning Loop. Server-only.
 *
 * Reflections are tied to a completed challenge session and scoped to the owning
 * learner. Stores hold the canonical row; journal/activity views are derived at
 * read time elsewhere.
 */
import "server-only";

export type LearningReflectionRecord = {
  id: string;
  learnerId: string;
  challengeId: string;
  challengeSessionId: string;
  body: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** Session completion time captured at create. */
  completedAt: number;
};

export type CreateReflectionInput = {
  learnerId: string;
  challengeId: string;
  challengeSessionId: string;
  body: string;
  completedAt: number;
  now: number;
  newId: () => string;
};

export type UpdateReflectionInput = {
  learnerId: string;
  reflectionId: string;
  body: string;
  revision: number;
  now: number;
};

export type SoftDeleteReflectionInput = {
  learnerId: string;
  reflectionId: string;
  revision: number;
  now: number;
};

/** A position in journal order. */
export type ReflectionKey = { updatedAt: number; challengeId: string; id: string };

export type ListReflectionsOptions = {
  challengeId?: string;
  /** Keyset: rows strictly after this position in journal order. */
  after?: ReflectionKey;
  /** At most this many rows (a positive integer). Absent: all of them. */
  limit?: number;
};

/** A position in activity order (occurredAt DESC, kindRank ASC, sourceId ASC). */
export type ActivityKey = { occurredAt: number; kindRank: number; sourceId: string };

export type ListActivityOptions = {
  /** Include current completed sessions as `challenge.completed` rows. Default true. */
  includeCompletions?: boolean;
  /** Include active reflections as `reflection.updated` rows. Default true. */
  includeReflections?: boolean;
  /** Keyset: rows strictly after this position in activity order. */
  after?: ActivityKey;
  /** At most this many rows (a positive integer). Absent: all of them. */
  limit?: number;
};

/**
 * One activity feed row as the store returns it (before the service builds the public item).
 * `sourceId` is already the opaque id the API and cursors use (completion digest or reflection id).
 * `body` is present only for reflections (the service truncates it to a preview).
 */
export type ActivityStoreRow = {
  kind: "challenge.completed" | "reflection.updated";
  sourceId: string;
  challengeId: string;
  occurredAt: number;
  body?: string;
};

export type LearningLoopStoreErrorCode =
  | "invalid-input"
  | "validation-failed"
  | "not-found"
  | "revision-conflict"
  | "reflection-already-exists";

/**
 * A caller bug, validation failure, or optimistic concurrency conflict. There is deliberately no "not-owner": a
 * reflection that belongs to another learner is indistinguishable from a missing one (`not-found`), so a store
 * never confirms that someone else's id exists.
 */
export class LearningLoopStoreError extends Error {
  readonly code: LearningLoopStoreErrorCode;
  readonly currentRevision?: number;
  readonly existingReflectionId?: string;

  constructor(
    code: LearningLoopStoreErrorCode,
    message: string,
    options?: { currentRevision?: number; existingReflectionId?: string },
  ) {
    super(message);
    this.name = "LearningLoopStoreError";
    this.code = code;
    this.currentRevision = options?.currentRevision;
    this.existingReflectionId = options?.existingReflectionId;
  }
}

export interface LearningLoopStore {
  createReflection(input: CreateReflectionInput): Promise<LearningReflectionRecord>;
  getActiveReflection(learnerId: string, reflectionId: string): Promise<LearningReflectionRecord | null>;
  /**
   * The learner's active reflections in journal order (updatedAt DESC, challengeId ASC, id ASC), optionally for one
   * challenge and optionally one keyset page: only rows strictly AFTER `after` in that order, at most `limit` of them.
   * Filtering and the limit happen in the store, so a caller never loads rows it will not return.
   */
  listActiveReflections(learnerId: string, options?: ListReflectionsOptions): Promise<LearningReflectionRecord[]>;
  /**
   * Optional store-level activity page (PostgreSQL). When present, the service uses this instead of loading every
   * completion and reflection and merging in memory. Memory stores omit it; the service keeps the in-process merge.
   */
  listActivity?(learnerId: string, options?: ListActivityOptions): Promise<ActivityStoreRow[]>;
  updateReflection(input: UpdateReflectionInput): Promise<LearningReflectionRecord>;
  softDeleteReflection(input: SoftDeleteReflectionInput): Promise<LearningReflectionRecord>;
}
