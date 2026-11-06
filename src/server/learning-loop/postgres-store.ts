/*
 * PostgreSQL implementation of LearningLoopStore. Server-only.
 *
 * Satisfies the same contract as MemoryLearningLoopStore (tests/learning-loop/store-contract.ts), on the schema of
 * db/migrations/0004_learning_reflections.sql. Selected by learner-http when BUGLAB_DATABASE_URL is set;
 * the default MemoryStore composition root stays DB-free and does not import this module.
 *
 * ATOMICITY. Every method is ONE statement, so nothing needs a transaction or a lock the caller could hold.
 *
 *   create   INSERT ... SELECT from the learner's own COMPLETED session. A session that is missing, belongs to
 *            another learner or challenge, or is unfinished yields no row (invalid-input). The composite foreign
 *            key of the table is the backstop behind that check. The partial unique index
 *            learning_reflections_active_uq decides a race between creates: one wins, the rest are told which
 *            reflection already exists.
 *   update   UPDATE ... WHERE id AND learner_id AND deleted_at IS NULL AND revision = $n, bumping the revision
 *            in the same statement. A stale writer matches no row, so two writers on one revision can never
 *            both succeed.
 *   delete   the same guarded UPDATE, setting deleted_at = GREATEST(now, created_at) (the table requires
 *            deleted_at >= created_at, so under clock skew it may equal created_at; the returned record, and so
 *            the API's deletedAt, is that stored value) and leaving revision and updated_at alone.
 *   list     one SELECT in journal order with the keyset condition and LIMIT in SQL.
 *   activity one SELECT that UNIONs current completions and active reflections, ordered and keyset-paged in SQL
 *            (occurred_at DESC, kind_rank ASC, source_id ASC). Completion source ids match derive.completionSourceId
 *            and require PostgreSQL digest() from the pgcrypto extension (see PGCRYPTO below).
 *
 * SCHEMA. Core `verifySchema()` stops at 0002. Call `verifyLearningLoopSchema` / `createPostgresLearningLoopStore`
 * only when Learning Loop PostgreSQL persistence is explicitly initialized. Migration 0003 is never required.
 *
 * PGCRYPTO (infrastructure prerequisite, not a BugLab migration). Activity completion digests need:
 *
 *   CREATE EXTENSION IF NOT EXISTS pgcrypto;
 *
 * Privilege: CREATE on the database (typically a superuser or the database owner). An application role that
 * only runs DML does not need CREATE EXTENSION. Core anonymous persistence does NOT require pgcrypto.
 * This module never installs the extension at runtime: provision it in ops/platform setup, then
 * `createPostgresLearningLoopStore` (or `verifyActivityDigest`) fails with LearningLoopInfrastructureError if
 * digest() is missing. Migration 0004 is left unchanged so least-privilege deployers are not forced to hold
 * CREATE EXTENSION during migrate.
 *
 * CONSTRUCTION. Supported production path: `createPostgresLearningLoopStore({ pool })`, which verifies 0004 and
 * digest() before returning a store. Direct `new PostgresLearningLoopStore({ pool })` is intentional for
 * low-level/contract tests that do not need activity digests; callers must have provisioned pgcrypto themselves
 * before `listActivity`, which maps a missing digest() to LearningLoopInfrastructureError.
 *
 * Only when a guarded UPDATE matches nothing is a second, read-only SELECT made, to tell "not found" from
 * "stale revision" and to report the current revision. Revision only ever grows, so a row that mismatched can
 * never match later: the answer from the follow-up read cannot be wrong in a way that matters.
 *
 * TIME is supplied by the caller (`now`, `completedAt`), exactly as in the memory store. Times are BIGINT
 * milliseconds since the Unix epoch.
 *
 * NOT LOGGED. Reflection bodies are private learner text and never reach a log or an error message here.
 * Unexpected database errors propagate unchanged.
 */
import "server-only";
import type pg from "pg";
import { isForeignKeyViolation, isUniqueViolation, pgErrorCode, toNumber, type Queryable } from "@/server/db/sql";
import { KIND_RANK } from "./derive";
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

/** Must stay equal to KIND_RANK in derive.ts; inlined as SQL literals so the query has no data interpolations. */
const ACTIVITY_COMPLETION_RANK = 10;
const ACTIVITY_REFLECTION_RANK = 40;
if (KIND_RANK["challenge.completed"] !== ACTIVITY_COMPLETION_RANK || KIND_RANK["reflection.updated"] !== ACTIVITY_REFLECTION_RANK) {
  throw new Error("Activity kind ranks in postgres-store.ts drifted from derive.ts KIND_RANK.");
}

export interface PostgresLearningLoopStoreOptions {
  /** A pool built from the POOLED runtime connection string. The caller owns it and closes it. */
  pool: pg.Pool;
}

const COLUMNS =
  "id, learner_id, challenge_id, challenge_session_id, body, revision, created_at, updated_at, deleted_at, completed_at";

interface ReflectionRow {
  id: string;
  learner_id: string;
  challenge_id: string;
  challenge_session_id: string;
  body: string;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  completed_at: string;
}

const recordOf = (row: ReflectionRow): LearningReflectionRecord => ({
  id: row.id,
  learnerId: row.learner_id,
  challengeId: row.challenge_id,
  challengeSessionId: row.challenge_session_id,
  body: row.body,
  revision: row.revision,
  createdAt: toNumber(row.created_at),
  updatedAt: toNumber(row.updated_at),
  deletedAt: row.deleted_at === null ? null : toNumber(row.deleted_at),
  completedAt: toNumber(row.completed_at),
});

const PKEY = "learning_reflections_pkey";
const ACTIVE_UNIQUE = "learning_reflections_active_uq";
/** SQLSTATEs: check_violation, and "invalid byte sequence" (a NUL character, which a text column cannot hold). */
const CHECK_VIOLATION = "23514";
const INVALID_BYTE_SEQUENCE = "22021";
/** INTEGER out of range (e.g. client revision above 2^31−1 bound to an INTEGER column). */
const NUMERIC_OUT_OF_RANGE = "22003";
/** Retries when the active reflection that blocked a create is deleted before it can be read back. */
const MAX_CREATE_ATTEMPTS = 3;

export class PostgresLearningLoopStore implements LearningLoopStore {
  private readonly pool: pg.Pool;

  constructor({ pool }: PostgresLearningLoopStoreOptions) {
    this.pool = pool;
  }

  async createReflection(input: CreateReflectionInput): Promise<LearningReflectionRecord> {
    const body = normalizeReflectionBody(input.body);
    const id = input.newId();
    for (let attempt = 1; ; attempt += 1) {
      try {
        const { rows } = await this.pool.query<ReflectionRow>(
          `INSERT INTO learning_reflections
             (id, learner_id, challenge_id, challenge_session_id, body, revision, created_at, updated_at, deleted_at, completed_at)
           SELECT $1, s.learner_id, s.challenge_id, s.id, $5, 1, $6::bigint, $6::bigint, NULL, $7::bigint
             FROM challenge_sessions s
            WHERE s.id = $4 AND s.learner_id = $2 AND s.challenge_id = $3 AND s.status = 'completed' AND s.superseded_at IS NULL
           RETURNING ${COLUMNS}`,
          [id, input.learnerId, input.challengeId, input.challengeSessionId, body, input.now, input.completedAt],
        );
        if (rows.length === 0) {
          throw new LearningLoopStoreError("invalid-input", "Session is not a completed session of this learner and challenge.");
        }
        return recordOf(rows[0]);
      } catch (error) {
        if (error instanceof LearningLoopStoreError) throw error;
        if (isUniqueViolation(error, PKEY)) {
          throw new LearningLoopStoreError("invalid-input", "Generated reflection id collided.");
        }
        if (isUniqueViolation(error, ACTIVE_UNIQUE)) {
          const existing = await this.findActiveId(this.pool, input.learnerId, input.challengeId);
          if (existing !== undefined) {
            throw new LearningLoopStoreError("reflection-already-exists", "An active reflection already exists.", {
              existingReflectionId: existing,
            });
          }
          // The blocker was soft-deleted between the failed insert and the read: the slot is free again.
          if (attempt < MAX_CREATE_ATTEMPTS) continue;
        }
        throw this.translate(error);
      }
    }
  }

  async getActiveReflection(learnerId: string, reflectionId: string): Promise<LearningReflectionRecord | null> {
    const { rows } = await this.pool.query<ReflectionRow>(
      `SELECT ${COLUMNS} FROM learning_reflections WHERE id = $1 AND learner_id = $2 AND deleted_at IS NULL`,
      [reflectionId, learnerId],
    );
    return rows[0] ? recordOf(rows[0]) : null;
  }

  /**
   * Journal order (updated_at DESC, challenge_id ASC, id ASC) with the keyset condition and LIMIT in SQL. Text keys use
   * COLLATE "C" so the order is the code-unit order the memory store and the cursor comparison use, whatever the
   * database's default collation is.
   */
  async listActiveReflections(
    learnerId: string,
    { challengeId, after, limit }: ListReflectionsOptions = {},
  ): Promise<LearningReflectionRecord[]> {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new LearningLoopStoreError("invalid-input", "limit must be a positive integer.");
    }
    // One fixed statement; each optional part is a NULL parameter that switches its condition off (LIMIT NULL is no limit).
    const { rows } = await this.pool.query<ReflectionRow>(
      `SELECT ${COLUMNS} FROM learning_reflections
        WHERE learner_id = $1 AND deleted_at IS NULL
          AND ($2::text IS NULL OR challenge_id = $2::text)
          AND ($3::bigint IS NULL
               OR updated_at < $3::bigint
               OR (updated_at = $3::bigint
                   AND (challenge_id COLLATE "C" > $4::text COLLATE "C"
                        OR (challenge_id COLLATE "C" = $4::text COLLATE "C" AND id COLLATE "C" > $5::text COLLATE "C"))))
        ORDER BY updated_at DESC, challenge_id COLLATE "C", id COLLATE "C"
        LIMIT $6::integer`,
      [learnerId, challengeId ?? null, after?.updatedAt ?? null, after?.challengeId ?? null, after?.id ?? null, limit ?? null],
    );
    return rows.map(recordOf);
  }

  /**
   * Activity feed page in SQL: current completed sessions ∪ active reflections, ordered
   * occurred_at DESC, kind_rank ASC, source_id ASC (COLLATE "C"), with the keyset condition and LIMIT in the database.
   * Completion source ids are the same opaque digests `completionSourceId` produces in Node.
   * One fixed statement; boolean parameters switch each UNION branch off (no string-assembled SQL).
   */
  async listActivity(
    learnerId: string,
    {
      includeCompletions = true,
      includeReflections = true,
      after,
      limit,
    }: ListActivityOptions = {},
  ): Promise<ActivityStoreRow[]> {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new LearningLoopStoreError("invalid-input", "limit must be a positive integer.");
    }
    if (!includeCompletions && !includeReflections) return [];

    let rows: Array<{
      occurred_at: string;
      kind_rank: number;
      source_id: string;
      challenge_id: string;
      body: string | null;
      kind: "challenge.completed" | "reflection.updated";
    }>;
    try {
      ({ rows } = await this.pool.query(
        `SELECT occurred_at, kind_rank, source_id, challenge_id, body, kind
           FROM (
             SELECT s.completed_at AS occurred_at,
                    10::integer AS kind_rank,
                    'cmp_' || substr(rtrim(translate(encode(digest('learning-loop:challenge.completed:' || s.id, 'sha256'), 'base64'), '+/', '-_'), '='), 1, 32) AS source_id,
                    s.challenge_id AS challenge_id,
                    NULL::text AS body,
                    'challenge.completed'::text AS kind
               FROM challenge_sessions s
              WHERE s.learner_id = $1
                AND s.status = 'completed'
                AND s.superseded_at IS NULL
                AND $6::boolean
             UNION ALL
             SELECT r.updated_at AS occurred_at,
                    40::integer AS kind_rank,
                    r.id AS source_id,
                    r.challenge_id AS challenge_id,
                    r.body AS body,
                    'reflection.updated'::text AS kind
               FROM learning_reflections r
              WHERE r.learner_id = $1
                AND r.deleted_at IS NULL
                AND $7::boolean
           ) AS feed
          WHERE ($2::bigint IS NULL
                 OR occurred_at < $2::bigint
                 OR (occurred_at = $2::bigint AND kind_rank > $3::integer)
                 OR (occurred_at = $2::bigint AND kind_rank = $3::integer AND source_id COLLATE "C" > $4::text COLLATE "C"))
          ORDER BY occurred_at DESC, kind_rank ASC, source_id COLLATE "C" ASC
          LIMIT $5::integer`,
        [
          learnerId,
          after?.occurredAt ?? null,
          after?.kindRank ?? null,
          after?.sourceId ?? null,
          limit ?? null,
          includeCompletions,
          includeReflections,
        ],
      ));
    } catch (error) {
      throw mapMissingDigest(error);
    }

    return rows.map((row) => ({
      kind: row.kind,
      sourceId: row.source_id,
      challengeId: row.challenge_id,
      occurredAt: toNumber(row.occurred_at),
      ...(row.body === null ? {} : { body: row.body }),
    }));
  }

  async updateReflection(input: UpdateReflectionInput): Promise<LearningReflectionRecord> {
    const body = normalizeReflectionBody(input.body);
    try {
      const { rows } = await this.pool.query<ReflectionRow>(
        `UPDATE learning_reflections
            SET body = $4, revision = revision + 1, updated_at = $5::bigint
          WHERE id = $1 AND learner_id = $2 AND deleted_at IS NULL AND revision = $3
          RETURNING ${COLUMNS}`,
        [input.reflectionId, input.learnerId, input.revision, body, input.now],
      );
      if (rows[0]) return recordOf(rows[0]);
    } catch (error) {
      throw await this.translateGuardedWrite(error, input.learnerId, input.reflectionId);
    }
    throw await this.explainUnmatchedWrite(input.learnerId, input.reflectionId);
  }

  async softDeleteReflection(input: SoftDeleteReflectionInput): Promise<LearningReflectionRecord> {
    try {
      const { rows } = await this.pool.query<ReflectionRow>(
        `UPDATE learning_reflections
            SET deleted_at = GREATEST($4::bigint, created_at)
          WHERE id = $1 AND learner_id = $2 AND deleted_at IS NULL AND revision = $3
          RETURNING ${COLUMNS}`,
        [input.reflectionId, input.learnerId, input.revision, input.now],
      );
      if (rows[0]) return recordOf(rows[0]);
    } catch (error) {
      throw await this.translateGuardedWrite(error, input.learnerId, input.reflectionId);
    }
    throw await this.explainUnmatchedWrite(input.learnerId, input.reflectionId);
  }

  /** A guarded UPDATE matched nothing: the reflection is not the learner's active one (not-found), or its revision moved on. */
  private async explainUnmatchedWrite(learnerId: string, reflectionId: string): Promise<LearningLoopStoreError> {
    const { rows } = await this.pool.query<{ revision: number }>(
      "SELECT revision FROM learning_reflections WHERE id = $1 AND learner_id = $2 AND deleted_at IS NULL",
      [reflectionId, learnerId],
    );
    if (!rows[0]) return new LearningLoopStoreError("not-found", "Reflection not found.");
    return new LearningLoopStoreError("revision-conflict", "Reflection revision is stale.", {
      currentRevision: rows[0].revision,
    });
  }

  private async findActiveId(queryable: Queryable, learnerId: string, challengeId: string): Promise<string | undefined> {
    const { rows } = await queryable.query<{ id: string }>(
      "SELECT id FROM learning_reflections WHERE learner_id = $1 AND challenge_id = $2 AND deleted_at IS NULL",
      [learnerId, challengeId],
    );
    return rows[0]?.id;
  }

  /** Maps driver errors on guarded writes; an out-of-range revision matches Memory's stale-revision semantics. */
  private async translateGuardedWrite(error: unknown, learnerId: string, reflectionId: string): Promise<never> {
    if (pgErrorCode(error) === NUMERIC_OUT_OF_RANGE) {
      throw await this.explainUnmatchedWrite(learnerId, reflectionId);
    }
    throw this.translate(error);
  }

  /** Maps the database errors the contract names; anything else is returned unchanged for the caller to throw. */
  private translate(error: unknown): unknown {
    if (error instanceof LearningLoopStoreError) return error;
    const code = pgErrorCode(error);
    if (code === INVALID_BYTE_SEQUENCE) {
      return new LearningLoopStoreError("validation-failed", "Reflection body contains a character that cannot be stored.");
    }
    if (code === CHECK_VIOLATION || isForeignKeyViolation(error)) {
      return new LearningLoopStoreError("invalid-input", "Reflection input violates a storage constraint.");
    }
    return error;
  }
}

/* ---------------------- Schema + infrastructure gates ---------------------- */

/** The migration Learning Loop PostgreSQL persistence needs. Account-linking 0003 is never required. */
export const LEARNING_LOOP_REQUIRED_MIGRATION = "0004_learning_reflections";

/**
 * Exact DBA/ops SQL to provision the activity-digest prerequisite. Not run by this module.
 * Requires CREATE privilege on the database (typically superuser or database owner).
 */
export const PGCRYPTO_PROVISIONING_SQL = "CREATE EXTENSION IF NOT EXISTS pgcrypto;";

/** undefined_function — e.g. digest() when pgcrypto is not installed. */
const UNDEFINED_FUNCTION = "42883";

export class LearningLoopSchemaOutOfDateError extends Error {
  constructor() {
    super(
      "The Learning Loop database schema is out of date: migration " +
        LEARNING_LOOP_REQUIRED_MIGRATION +
        " has not been applied. Run the migrations with --through " +
        LEARNING_LOOP_REQUIRED_MIGRATION +
        " --exclude 0003_account_links (0003 stays optional).",
    );
    this.name = "LearningLoopSchemaOutOfDateError";
  }
}

export class LearningLoopInfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningLoopInfrastructureError";
  }
}

const MISSING_DIGEST_MESSAGE =
  "Learning Loop PostgreSQL activity feeds require pgcrypto (digest()). " +
  "Provision it as a DBA/infrastructure step before initializing the store: " +
  PGCRYPTO_PROVISIONING_SQL +
  " Privilege: CREATE on the database (typically a superuser or the database owner). " +
  "Core anonymous persistence does not require pgcrypto. " +
  "This application never installs the extension and never falls back to another digest algorithm.";

function mapMissingDigest(error: unknown): never {
  if (pgErrorCode(error) === UNDEFINED_FUNCTION) {
    throw new LearningLoopInfrastructureError(MISSING_DIGEST_MESSAGE);
  }
  throw error;
}

/** True when migration 0004 has been recorded and the reflections table exists. Does not create anything. */
export async function learningLoopSchemaPresent(queryable: Queryable): Promise<boolean> {
  try {
    const { rows } = await queryable.query<{ applied: boolean; table_present: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM buglab_schema_migrations WHERE version = $1) AS applied,
         to_regclass('public.learning_reflections') IS NOT NULL AS table_present`,
      [LEARNING_LOOP_REQUIRED_MIGRATION],
    );
    return Boolean(rows[0]?.applied && rows[0]?.table_present);
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return false;
    throw error;
  }
}

/**
 * Rejects unless Learning Loop migration 0004 and `learning_reflections` are present.
 * Does not require account-linking migration 0003. Safe to call from tests and from a future mount step.
 */
export async function verifyLearningLoopSchema(queryable: Queryable): Promise<void> {
  if (!(await learningLoopSchemaPresent(queryable))) throw new LearningLoopSchemaOutOfDateError();
}

/** True when `digest(..., 'sha256')` is callable (pgcrypto present). Does not create the extension. */
export async function activityDigestAvailable(queryable: Queryable): Promise<boolean> {
  try {
    await queryable.query("SELECT digest('buglab-learning-loop-digest-probe', 'sha256')");
    return true;
  } catch (error) {
    if (pgErrorCode(error) === UNDEFINED_FUNCTION) return false;
    throw error;
  }
}

/**
 * Rejects unless pgcrypto's digest() is available. Never installs the extension.
 * Core persistence does not call this.
 */
export async function verifyActivityDigest(queryable: Queryable): Promise<void> {
  if (!(await activityDigestAvailable(queryable))) {
    throw new LearningLoopInfrastructureError(MISSING_DIGEST_MESSAGE);
  }
}

export type CreatePostgresLearningLoopStoreOptions = PostgresLearningLoopStoreOptions & {
  /**
   * When true (default), verifies migration 0004 before returning a store. Pass false only in tests that
   * intentionally exercise a store against an already-checked fixture. Digest() is always verified.
   */
  verify?: boolean;
};

/**
 * Supported Learning Loop PostgreSQL initialization. Verifies 0004 (unless `verify: false`) and verifies
 * that digest() is available (never CREATE EXTENSION). Does not open routes or select a composition root.
 */
export async function createPostgresLearningLoopStore(
  options: CreatePostgresLearningLoopStoreOptions,
): Promise<PostgresLearningLoopStore> {
  const { verify = true, ...storeOptions } = options;
  if (verify) await verifyLearningLoopSchema(storeOptions.pool);
  await verifyActivityDigest(storeOptions.pool);
  return new PostgresLearningLoopStore(storeOptions);
}
