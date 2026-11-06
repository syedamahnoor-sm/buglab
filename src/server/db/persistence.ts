/*
 * Builds the durable persistence layer (store, rate limiter, connection pool) from configuration, and
 * schedules its purge. Server-only.
 *
 * Selected only by `src/server/learner-http.ts` (via `learner-persistence.ts`) when BUGLAB_DATABASE_URL
 * is set. The default MemoryStore composition root does not import this module. Account linking
 * stays separate. Nothing here runs at import time; a pool is created only when
 * createPostgresPersistence() is called.
 *
 *   const persistence = createPostgresPersistence();            // reads BUGLAB_DATABASE_URL
 *   const services = createAppServices({ store: persistence.store });
 *   const learner = createLearnerHandlers({
 *     service: services.service,
 *     appOrigin: services.appOrigin,
 *     learnerCreation: persistence.learnerCreationGuard({ trustedProxyHops: services.trustedProxyHops }),
 *   });
 *
 * SCHEMA. This module never changes the schema. scripts/db-migrate.mjs does that, with a direct connection.
 * `verifySchema()` checks that the CORE migrations (0001 and 0002) have been applied. Migration 0003
 * (account linking) is optional and is verified only by `verifyAccountLinksSchema` in postgres-account-links.ts.
 * Learning Loop migration 0004 is optional here too: verify it only when Learning Loop PostgreSQL persistence is
 * explicitly initialized (`verifyLearningLoopSchema` / `createPostgresLearningLoopStore` in learning-loop/postgres-store.ts).
 * Submission claims (0005) are optional here too. `verifySubmissionClaimsSchema` is a separate fail-closed check.
 * Nothing in this module calls it. A future durable reserve/finalize path must call it explicitly before use.
 *
 * ACCOUNT LINKING. Not part of this factory. Construct `PostgresAccountLinkStore` separately after 0003 is
 * applied. Core purge does not consult account-link tables; use `purgeExpiredExcludingLinked` once linking is live.
 *
 * PURGING. Purging only reclaims storage; correctness never depends on it (expired learners and ended rate
 * windows are ignored whether or not they were deleted). Run `purgeExpired()` periodically from ONE of:
 *   - `startPeriodicPurge()` in each long-lived instance. Several instances purging at once is safe: purges
 *     skip rows another purge holds and split the work.
 *   - an external scheduler (cron, a platform scheduled job) calling a route or script that calls
 *     purgeExpired(), the right choice for serverless or short-lived instances, where a timer may never fire.
 */
import "server-only";
import pg from "pg";
import { resolveTrustedProxyHops } from "@/server/ratelimit/proxy-config";
import { PostgresRateLimiter } from "./postgres-rate-limiter";
import { PostgresStore } from "./postgres-store";
import { readDatabaseConfig, type DatabaseConfig } from "./config";
import {
  createLearnerCreationGuard,
  parseLearnerCreationPolicy,
  parseUnidentifiedClientMode,
  type LearnerCreationGuard,
  type UnidentifiedClientMode,
} from "@/server/ratelimit/learner-creation";
import type { ExpiryPolicy } from "@/server/session/expiry";
import type { RateLimitPolicy } from "@/server/ratelimit/types";
import type { Queryable } from "./sql";

/**
 * The newest migration CORE anonymous persistence needs (learner sessions + rate-limit buckets).
 * Account-linking migration 0003 is optional and is not required here.
 */
export const REQUIRED_MIGRATION = "0002_rate_limit_buckets";

const CONNECTION_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 20_000;

export interface PostgresPersistenceOptions {
  /** Defaults to readDatabaseConfig() on the process environment. */
  config?: DatabaseConfig;
  /** Learner expiry rules. Defaults to the centralized policy. */
  expiryPolicy?: Partial<ExpiryPolicy>;
  /** TEST ONLY: replaces the database clock for the store and the limiter. */
  now?: () => number;
}

export interface PurgeSummary {
  readonly learners: number;
  readonly rateLimitBuckets: number;
}

export interface PostgresPersistence {
  readonly store: PostgresStore;
  readonly rateLimiter: PostgresRateLimiter;
  /** The pool, for composition and tests. Prefer the store and limiter. */
  readonly pool: pg.Pool;
  /**
   * The guard for the learner handler: counts only requests that would create a new learner, per trusted client
   * address, with the provisional policy unless one is given (or set in the environment, see learner-creation.ts).
   */
  learnerCreationGuard(options?: {
    /**
     * How many proxies to trust. Leave it out and it is read STRICTLY from BUGLAB_TRUSTED_PROXY_HOPS: an invalid value, or an
     * unset one in production, throws here, when the guard is built, instead of quietly trusting nothing. If you pass a number it
     * must agree with that variable (the diagnosis endpoint reads the same one). See src/server/ratelimit/proxy-config.ts.
     */
    trustedProxyHops?: number;
    policy?: RateLimitPolicy;
    unidentified?: UnidentifiedClientMode;
    onUnidentified?: () => void;
  }): LearnerCreationGuard;
  /** Rejects if core migrations 0001/0002 have not been applied. Does not require account-linking migration 0003. */
  verifySchema(): Promise<void>;
  /** Deletes expired anonymous learners (with their sessions and attempts) and ended rate-limit windows. */
  purgeExpired(): Promise<PurgeSummary>;
  /** Waits for in-flight queries and closes every connection. Call once, at shutdown. */
  close(): Promise<void>;
}

export class SchemaOutOfDateError extends Error {
  constructor() {
    super(`The database schema is out of date: migration ${REQUIRED_MIGRATION} has not been applied. Run the migrations.`);
    this.name = "SchemaOutOfDateError";
  }
}

/** Migration that creates `diagnosis_submission_claims`. Not part of core `verifySchema()`. */
export const SUBMISSION_CLAIMS_MIGRATION = "0005_diagnosis_submission_claims";

const SUBMISSION_CLAIMS_TABLE = "diagnosis_submission_claims";

const SUBMISSION_CLAIMS_COLUMNS: readonly { name: string; type: string }[] = [
  { name: "session_id", type: "text" },
  { name: "submission_id", type: "text" },
  { name: "request_hash", type: "text" },
  { name: "claim_token", type: "text" },
  { name: "claimed_at", type: "bigint" },
  { name: "expires_at", type: "bigint" },
];

export class SubmissionClaimsSchemaError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `Submission claims schema is not ready: ${missing.join("; ")}. ` +
        `Apply migration ${SUBMISSION_CLAIMS_MIGRATION}. This check does not migrate the database.`,
    );
    this.name = "SubmissionClaimsSchemaError";
    this.missing = missing;
  }
}

const normalizeCatalogSql = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").replace(/::text/g, "");

function checkCovers(definitions: readonly string[], present: (normalized: string) => boolean): boolean {
  return definitions.some((definition) => present(normalizeCatalogSql(definition)));
}

/**
 * Match length(column) BETWEEN 1 AND 128 as PostgreSQL records it.
 * Migration 0005 writes BETWEEN; pg_get_constraintdef usually expands to
 * `(length(column) >= 1) AND (length(column) <= 128)`. Both bounds must name
 * the same column so a check on another column cannot satisfy this matcher.
 */
function lengthBound(column: string): (normalized: string) => boolean {
  const between = new RegExp(`\\blength\\(\\s*${column}\\s*\\)\\s+between\\s+1\\s+and\\s+128\\b`);
  const lower = new RegExp(`\\blength\\(\\s*${column}\\s*\\)\\s*>=\\s*1\\b`);
  const upper = new RegExp(`\\blength\\(\\s*${column}\\s*\\)\\s*<=\\s*128\\b`);
  return (normalized) => between.test(normalized) || (lower.test(normalized) && upper.test(normalized));
}

/** `request_hash ~ '^[0-9a-f]{64}$'` — column name must be exact, not a suffix. */
function requestHashIsHex64(normalized: string): boolean {
  return /(?:^|[^a-z0-9_])request_hash\s*~\s*'?\^\[0-9a-f\]\{64\}\$'?/.test(normalized);
}

/** `expires_at > claimed_at` — both identifiers must be exact, not suffixes. */
function expiresAfterClaimed(normalized: string): boolean {
  return /(?:^|[^a-z0-9_])expires_at\s*>\s*claimed_at(?:$|[^a-z0-9_])/.test(normalized);
}

/**
 * Fail closed unless migration 0005 and the exact `public.diagnosis_submission_claims` objects used by
 * `PostgresStore.reserve` / `finalize` are present. Does not create anything and is not called by
 * `verifySchema()` or `createPostgresPersistence()`.
 */
export async function verifySubmissionClaimsSchema(queryable: Queryable): Promise<void> {
  const missing: string[] = [];

  try {
    const { rows } = await queryable.query<{ applied: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM buglab_schema_migrations WHERE version = $1) AS applied",
      [SUBMISSION_CLAIMS_MIGRATION],
    );
    if (!rows[0]?.applied) {
      missing.push(`migration ${SUBMISSION_CLAIMS_MIGRATION} is not recorded in buglab_schema_migrations`);
    }
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      missing.push("buglab_schema_migrations is missing, so migration 0005_diagnosis_submission_claims cannot be recorded");
    } else {
      throw error;
    }
  }

  const relation = await queryable.query<{ oid: string }>(
    `SELECT c.oid::text AS oid
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = $1
        AND c.relkind = 'r'`,
    [SUBMISSION_CLAIMS_TABLE],
  );
  const oid = relation.rows[0]?.oid;
  if (!oid) {
    missing.push(`table public.${SUBMISSION_CLAIMS_TABLE} is missing`);
    throw new SubmissionClaimsSchemaError(missing);
  }

  const columns = await queryable.query<{ name: string; type: string; not_null: boolean }>(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null
       FROM pg_attribute a
      WHERE a.attrelid = $1::oid
        AND a.attnum > 0
        AND NOT a.attisdropped`,
    [oid],
  );
  const byName = new Map(columns.rows.map((column) => [column.name, column]));
  for (const required of SUBMISSION_CLAIMS_COLUMNS) {
    const found = byName.get(required.name);
    if (!found) {
      missing.push(`column ${required.name} is missing`);
      continue;
    }
    if (found.type !== required.type || !found.not_null) {
      missing.push(`column ${required.name} must be ${required.type} NOT NULL (found ${found.type}${found.not_null ? "" : " NULL"})`);
    }
  }

  const primaryKey = await queryable.query<{ name: string }>(
    `SELECT a.attname AS name
       FROM pg_constraint c
       JOIN unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = cols.attnum
      WHERE c.conrelid = $1::oid
        AND c.contype = 'p'
      ORDER BY cols.ord`,
    [oid],
  );
  const key = primaryKey.rows.map((row) => row.name);
  if (key.join(",") !== "session_id,submission_id") {
    missing.push(
      `primary key must be (session_id, submission_id)${key.length ? ` (found (${key.join(", ")}))` : ""}`,
    );
  }

  const foreignKeys = await queryable.query<{ definition: string }>(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = $1::oid AND contype = 'f'",
    [oid],
  );
  const foreignKeyOk = foreignKeys.rows.some((row) => {
    const definition = normalizeCatalogSql(row.definition);
    return (
      definition.includes("foreign key (session_id)") &&
      definition.includes("references challenge_sessions(id)") &&
      definition.includes("on delete cascade")
    );
  });
  if (!foreignKeyOk) {
    missing.push("foreign key session_id references challenge_sessions(id) on delete cascade is missing");
  }

  const checks = await queryable.query<{ definition: string }>(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = $1::oid AND contype = 'c'",
    [oid],
  );
  const definitions = checks.rows.map((row) => row.definition);
  if (!checkCovers(definitions, lengthBound("submission_id"))) {
    missing.push("check constraint length(submission_id) between 1 and 128 is missing");
  }
  if (!checkCovers(definitions, lengthBound("claim_token"))) {
    missing.push("check constraint length(claim_token) between 1 and 128 is missing");
  }
  if (!checkCovers(definitions, requestHashIsHex64)) {
    missing.push("check constraint request_hash is 64 lowercase hex characters is missing");
  }
  if (!checkCovers(definitions, expiresAfterClaimed)) {
    missing.push("check constraint expires_at > claimed_at is missing");
  }

  if (missing.length > 0) throw new SubmissionClaimsSchemaError(missing);
}

export function createPostgresPersistence(options: PostgresPersistenceOptions = {}): PostgresPersistence {
  const config = options.config ?? readDatabaseConfig();
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    // Client-side only. A server-side statement_timeout would be sent as a startup parameter, which a
    // transaction-mode pooler may refuse; transactions set theirs with SET LOCAL instead (see sql.ts).
    query_timeout: QUERY_TIMEOUT_MS,
  });
  // A managed database closes idle connections. Without a listener, that error on an IDLE pooled client
  // would be an unhandled 'error' event and take the whole process down. The pool discards the client itself.
  pool.on("error", () => {});

  let closing: Promise<void> | undefined;
  const store = new PostgresStore({ pool, policy: options.expiryPolicy, now: options.now });
  const rateLimiter = new PostgresRateLimiter({ pool, now: options.now });

  return {
    store,
    rateLimiter,
    pool,
    learnerCreationGuard: ({ trustedProxyHops, policy, unidentified, onUnidentified } = {}) =>
      createLearnerCreationGuard({
        limiter: rateLimiter,
        // Validated now, at construction: a wrong or missing production setting stops startup, not a request.
        trustedProxyHops: resolveTrustedProxyHops(process.env, { explicit: trustedProxyHops }),
        policy: policy ?? parseLearnerCreationPolicy(),
        unidentified: unidentified ?? parseUnidentifiedClientMode(),
        onUnidentified,
      }),
    async verifySchema() {
      let applied: boolean;
      try {
        const { rows } = await pool.query<{ applied: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM buglab_schema_migrations WHERE version = $1) AS applied",
          [REQUIRED_MIGRATION],
        );
        applied = rows[0].applied;
      } catch (error) {
        // "undefined_table": nothing has ever been migrated.
        if ((error as { code?: string }).code === "42P01") throw new SchemaOutOfDateError();
        throw error;
      }
      if (!applied) throw new SchemaOutOfDateError();
    },
    async purgeExpired() {
      const [learners, rateLimitBuckets] = await Promise.all([store.purgeExpired(), rateLimiter.purgeExpired()]);
      return { learners, rateLimitBuckets };
    },
    close() {
      // Idempotent: shutdown hooks commonly run more than once, and ending a pool twice would throw.
      closing ??= pool.ended ? Promise.resolve() : pool.end();
      return closing;
    },
  };
}

export interface PeriodicPurgeOptions {
  /** How often to purge, in milliseconds. */
  intervalMs: number;
  /** Called with a failed purge's error. A failure never stops the schedule. There is no default logging. */
  onError?: (error: unknown) => void;
  /** Called after each successful purge. */
  onPurge?: (summary: PurgeSummary) => void;
}

/**
 * Purges now and then every `intervalMs`, until the returned function is called. A run that is still going
 * when the next one is due is not overlapped. The timer is unref'd, so it never keeps the process alive.
 * Not suited to serverless instances (see the header).
 */
export function startPeriodicPurge(
  persistence: Pick<PostgresPersistence, "purgeExpired">,
  { intervalMs, onError, onPurge }: PeriodicPurgeOptions,
): () => void {
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new RangeError("intervalMs must be a positive number.");
  let running = false;
  let stopped = false;

  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      // Not `onPurge?.(await ...)`: when onPurge is absent that skips evaluating the argument, so nothing would be purged.
      const summary = await persistence.purgeExpired();
      onPurge?.(summary);
    } catch (error) {
      onError?.(error);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
