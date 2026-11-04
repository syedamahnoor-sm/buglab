/*
 * The authentication provider port. Server-only.
 *
 * BugLab does not implement passwords, hashing or session cryptography itself.
 * A maintained provider (see docs/architecture/accounts-and-rbac.md) will sit
 * behind this interface once a durable database and its secrets exist.
 *
 * Until then the only provider is UNCONFIGURED: it authenticates nobody, so
 * every protected operation is refused. There is no in-memory or development
 * account store to fall back on, by design.
 */
import "server-only";
import type { AuthSession } from "./types";

export interface AuthProvider {
  /** Which provider this is, for diagnostics. Never a secret. */
  readonly name: string;
  /** Whether accounts can sign in at all. */
  readonly configured: boolean;
  /** The verified session for this request, or null. Never trusts client-supplied identity. */
  getSession(request: Request): Promise<AuthSession | null>;
}

export const unconfiguredAuthProvider: AuthProvider = Object.freeze({
  name: "unconfigured",
  configured: false,
  async getSession() {
    return null;
  },
});

/** Provider names a deployment may select once they are implemented. None is, yet. */
export const SUPPORTED_PROVIDERS: readonly string[] = [];

/**
 * The provider for this deployment, from BUGLAB_AUTH_PROVIDER. Unset means
 * unconfigured. A name that is not implemented throws, so a misconfiguration
 * fails loudly instead of silently disabling or faking sign-in.
 */
export function resolveAuthProvider(value: string | undefined = process.env.BUGLAB_AUTH_PROVIDER): AuthProvider {
  if (value === undefined || value.trim() === "") return unconfiguredAuthProvider;
  throw new Error(
    `BUGLAB_AUTH_PROVIDER="${value}" is not available. Supported: ${SUPPORTED_PROVIDERS.length ? SUPPORTED_PROVIDERS.join(", ") : "none yet"}.`,
  );
}
