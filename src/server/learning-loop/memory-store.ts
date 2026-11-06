/*
 * In-process LearningLoopStore for dev/tests. All state lives in a Map; the
 * "one active reflection per (learner, challenge)" rule is enforced in memory the
 * same way the partial unique index will be in Postgres. Server-only.
 *
 * Activity: when constructed with a `listCompletions` source, `listActivity` pages in the store
 * (filter / sort / limit) with the same order as PostgreSQL. Without that source the service keeps
 * the older in-process merge; either path is contract-compatible with the activity API.
 */
import "server-only";
import { compareActivity, compareJournal, completionSourceId, journalKeyOf, KIND_RANK } from "./derive";
import { normalizeReflectionBody } from "./store-rules";
import {
  LearningLoopStoreError,
  type ActivityStoreRow,
  type CreateReflectionInput,
  type LearningLoopStore,
  type LearningReflectionRecord,
  type ListActivityOptions,
  type ListReflectionsOptions,
  type SoftDeleteReflectionInput,
  type UpdateReflectionInput,
} from "./types";

const copy = (r: LearningReflectionRecord): LearningReflectionRecord => ({ ...r });

export type MemoryLearningLoopStoreOptions = {
  /**
   * Current completions for store-level activity paging. When set, `listActivity` is available and the
   * service uses it instead of merging in process.
   */
  listCompletions?: (
    learnerId: string,
  ) => Promise<readonly { sessionId: string; challengeId: string; completedAt: number }[]>;
};

export class MemoryLearningLoopStore implements LearningLoopStore {
  private readonly rows = new Map<string, LearningReflectionRecord>();
  private readonly listCompletions: MemoryLearningLoopStoreOptions["listCompletions"];
  /**
   * Present only when constructed with `listCompletions`, so the service can prefer store-level
   * activity paging without breaking existing Memory setups that omit it.
   * Mutable so tests can wrap it to assert paging limits.
   */
  listActivity?: LearningLoopStore["listActivity"];

  constructor(options: MemoryLearningLoopStoreOptions = {}) {
    this.listCompletions = options.listCompletions;
    if (options.listCompletions) {
      this.listActivity = (learnerId, listOptions) => this.pageActivity(learnerId, listOptions);
    }
  }

  private findActive(learnerId: string, challengeId: string): LearningReflectionRecord | undefined {
    for (const row of this.rows.values()) {
      if (row.learnerId === learnerId && row.challengeId === challengeId && row.deletedAt === null) return row;
    }
    return undefined;
  }

  /** Active row owned by `learnerId`; foreign, unknown and soft-deleted ids are all not-found. */
  private requireActive(learnerId: string, reflectionId: string): LearningReflectionRecord {
    const row = this.rows.get(reflectionId);
    if (!row || row.learnerId !== learnerId || row.deletedAt !== null) {
      throw new LearningLoopStoreError("not-found", "Reflection not found.");
    }
    return row;
  }

  private static checkRevision(row: LearningReflectionRecord, revision: number): void {
    if (row.revision !== revision) {
      throw new LearningLoopStoreError("revision-conflict", "Reflection revision is stale.", {
        currentRevision: row.revision,
      });
    }
  }

  async createReflection(input: CreateReflectionInput): Promise<LearningReflectionRecord> {
    const body = normalizeReflectionBody(input.body);
    const existing = this.findActive(input.learnerId, input.challengeId);
    if (existing) {
      throw new LearningLoopStoreError("reflection-already-exists", "An active reflection already exists.", {
        existingReflectionId: existing.id,
      });
    }
    const id = input.newId();
    if (this.rows.has(id)) throw new LearningLoopStoreError("invalid-input", "Generated reflection id collided.");
    const row: LearningReflectionRecord = {
      id,
      learnerId: input.learnerId,
      challengeId: input.challengeId,
      challengeSessionId: input.challengeSessionId,
      body,
      revision: 1,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
      completedAt: input.completedAt,
    };
    this.rows.set(id, row);
    return copy(row);
  }

  async getActiveReflection(learnerId: string, reflectionId: string): Promise<LearningReflectionRecord | null> {
    const row = this.rows.get(reflectionId);
    return row && row.learnerId === learnerId && row.deletedAt === null ? copy(row) : null;
  }

  async listActiveReflections(
    learnerId: string,
    { challengeId, after, limit }: ListReflectionsOptions = {},
  ): Promise<LearningReflectionRecord[]> {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new LearningLoopStoreError("invalid-input", "limit must be a positive integer.");
    }
    const rows: LearningReflectionRecord[] = [];
    for (const row of this.rows.values()) {
      if (row.learnerId !== learnerId || row.deletedAt !== null) continue;
      if (challengeId !== undefined && row.challengeId !== challengeId) continue;
      if (after && compareJournal(journalKeyOf(row), after) <= 0) continue;
      rows.push(row);
    }
    rows.sort((a, b) => compareJournal(journalKeyOf(a), journalKeyOf(b)));
    return (limit === undefined ? rows : rows.slice(0, limit)).map(copy);
  }

  private async pageActivity(
    learnerId: string,
    {
      includeCompletions = true,
      includeReflections = true,
      after,
      limit,
    }: ListActivityOptions = {},
  ): Promise<ActivityStoreRow[]> {
    if (!this.listCompletions) {
      throw new LearningLoopStoreError("invalid-input", "MemoryLearningLoopStore.listActivity requires listCompletions.");
    }
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new LearningLoopStoreError("invalid-input", "limit must be a positive integer.");
    }
    if (!includeCompletions && !includeReflections) return [];

    const rows: ActivityStoreRow[] = [];
    if (includeCompletions) {
      for (const session of await this.listCompletions(learnerId)) {
        rows.push({
          kind: "challenge.completed",
          sourceId: completionSourceId(session.sessionId),
          challengeId: session.challengeId,
          occurredAt: session.completedAt,
        });
      }
    }
    if (includeReflections) {
      for (const row of this.rows.values()) {
        if (row.learnerId !== learnerId || row.deletedAt !== null) continue;
        rows.push({
          kind: "reflection.updated",
          sourceId: row.id,
          challengeId: row.challengeId,
          occurredAt: row.updatedAt,
          body: row.body,
        });
      }
    }

    const keyOf = (row: ActivityStoreRow) => ({
      occurredAt: row.occurredAt,
      kindRank: KIND_RANK[row.kind],
      sourceId: row.sourceId,
    });
    rows.sort((a, b) => compareActivity(keyOf(a), keyOf(b)));
    const filtered = after ? rows.filter((row) => compareActivity(keyOf(row), after) > 0) : rows;
    return limit === undefined ? filtered : filtered.slice(0, limit);
  }

  async updateReflection(input: UpdateReflectionInput): Promise<LearningReflectionRecord> {
    const body = normalizeReflectionBody(input.body);
    const row = this.requireActive(input.learnerId, input.reflectionId);
    MemoryLearningLoopStore.checkRevision(row, input.revision);
    row.body = body;
    row.revision += 1;
    row.updatedAt = input.now;
    return copy(row);
  }

  async softDeleteReflection(input: SoftDeleteReflectionInput): Promise<LearningReflectionRecord> {
    const row = this.requireActive(input.learnerId, input.reflectionId);
    MemoryLearningLoopStore.checkRevision(row, input.revision);
    // Never earlier than the row's own creation (the table checks deleted_at >= created_at; Postgres stores
    // GREATEST(now, created_at)). With skewed clocks the soft-delete time can therefore equal createdAt.
    row.deletedAt = Math.max(input.now, row.createdAt);
    return copy(row);
  }
}
