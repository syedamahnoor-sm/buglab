/*
 * Database configuration, read from the environment. Server-only.
 *
 *   BUGLAB_DATABASE_URL          REQUIRED at runtime. The connection string the running application
 *                                uses. Use the POOLED endpoint of a managed provider (for Neon, the
 *                                hostname containing "-pooler") so many instances share few connections.
 *   BUGLAB_DATABASE_POOL_MAX     optional. Connections each application instance may hold open, 1 to 100,
 *                                default 5. Keep it small: with N instances the database sees N x this
 *                                many connections before any pooler.
 *   BUGLAB_DATABASE_URL_DIRECT   NOT read here. Used only by scripts/db-migrate.mjs, which needs a direct
 *                                (unpooled) connection. The running application never uses it.
 *
 * Credentials live only in the environment, are never logged, and are never put in an error message:
 * every failure here names the variable and the problem, never the value.
 *
 * Nothing in this module assumes a hosting platform or a provider. It is tested on PostgreSQL 18 only;
 * other versions are untested. TLS is requested in the connection string itself
 * (for example `?sslmode=require`), as managed providers document.
 */
import "server-only";

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

export interface DatabaseConfig {
  /** The pooled runtime connection string. Treat as a secret. */
  readonly connectionString: string;
  readonly poolMax: number;
}

/** The environment, or any object shaped like it. Only BUGLAB_DATABASE_URL and BUGLAB_DATABASE_POOL_MAX are read. */
export type DatabaseEnv = Readonly<Record<string, string | undefined>>;

export const DEFAULT_POOL_MAX = 5;
const MAX_POOL_MAX = 100;

/** Reads and validates the runtime configuration. Throws DatabaseConfigError; the message never contains the URL. */
export function readDatabaseConfig(env: DatabaseEnv = process.env): DatabaseConfig {
  const raw = env.BUGLAB_DATABASE_URL?.trim();
  if (!raw) {
    throw new DatabaseConfigError("BUGLAB_DATABASE_URL is not set. A durable store needs a PostgreSQL connection string.");
  }
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    throw new DatabaseConfigError("BUGLAB_DATABASE_URL is not a valid connection string.");
  }
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new DatabaseConfigError("BUGLAB_DATABASE_URL must be a postgres:// or postgresql:// connection string.");
  }

  let poolMax = DEFAULT_POOL_MAX;
  const rawMax = env.BUGLAB_DATABASE_POOL_MAX?.trim();
  if (rawMax) {
    poolMax = Number(rawMax);
    if (!/^\d+$/.test(rawMax) || !Number.isSafeInteger(poolMax) || poolMax < 1 || poolMax > MAX_POOL_MAX) {
      throw new DatabaseConfigError(`BUGLAB_DATABASE_POOL_MAX must be a whole number from 1 to ${MAX_POOL_MAX}.`);
    }
  }
  return Object.freeze({ connectionString: raw, poolMax });
}
