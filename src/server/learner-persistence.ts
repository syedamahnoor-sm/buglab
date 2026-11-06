/*
 * Opt-in PostgreSQL selection for the mounted learner HTTP surface. Server-only.
 *
 * When BUGLAB_DATABASE_URL is unset, composition keeps MemoryStore (process-local).
 * When it is set, Habin learner persistence uses the pooled Postgres adapters. Operators must
 * apply migrations 0001/0002 (and 0004/0005 for Learning Loop / claims) with
 * BUGLAB_DATABASE_URL_DIRECT before enabling the runtime URL. Migration 0003 stays unapplied
 * until account-linking activation.
 *
 * Does not log connection strings. Does not apply migrations. Does not enable Better Auth.
 */
import "server-only";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";

export type LearnerPersistenceMode = "memory" | "postgres";

export function learnerPersistenceMode(env: NodeJS.ProcessEnv = process.env): LearnerPersistenceMode {
  const raw = env.BUGLAB_DATABASE_URL?.trim();
  return raw ? "postgres" : "memory";
}

/** Builds Postgres persistence when configured; otherwise null (MemoryStore path). */
export function resolveLearnerPersistence(env: NodeJS.ProcessEnv = process.env): PostgresPersistence | null {
  if (learnerPersistenceMode(env) !== "postgres") return null;
  return createPostgresPersistence();
}
