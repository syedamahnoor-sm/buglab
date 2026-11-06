import "server-only";
import { resolveAuthProvider, type AuthProvider } from "./provider";
import type { Role } from "./types";

const verifiedAccountBrand: unique symbol = Symbol("BugLabVerifiedAccount");

/**
 * Server-issued identity proof for Habin's shared learner boundary. It contains
 * no learner id or credential. A type assertion, JSON object, spread or copied
 * symbol cannot issue the runtime proof. Obtain a new proof for each request.
 */
export interface VerifiedAccount {
  readonly accountId: string;
  readonly email: string;
  readonly emailVerified: true;
  readonly displayName: string | null;
  readonly role: Role;
  readonly [verifiedAccountBrand]: true;
}

const issued = new WeakMap<object, { request: Request; expiresAt: number }>();

/** A trusted server provider is injectable for composition/tests, never from HTTP input. */
export async function verifyAccount(request: Request, provider: AuthProvider = resolveAuthProvider()): Promise<VerifiedAccount | null> {
  if (!provider.configured) return null;
  const session = await provider.getSession(request);
  if (!session) return null;
  const expiresAt = Date.parse(session.expiresAt);
  const user = session.user;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  if (!user || typeof user.id !== "string" || !/^[\x21-\x7e]{1,256}$/.test(user.id)) return null;
  if (user.emailVerified !== true || typeof user.email !== "string" || user.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) return null;
  if (user.role !== "learner" && user.role !== "admin") return null;
  if (user.displayName !== null && (typeof user.displayName !== "string" || user.displayName.length > 80)) return null;
  const proof: VerifiedAccount = Object.freeze({ accountId: user.id, email: user.email, emailVerified: true as const, displayName: user.displayName, role: user.role, [verifiedAccountBrand]: true as const });
  issued.set(proof, { request, expiresAt });
  return proof;
}

/** Check authenticity, expiry and (when supplied) the exact originating request. */
export function isVerifiedAccount(value: unknown, request?: Request): value is VerifiedAccount {
  if (typeof value !== "object" || value === null) return false;
  const issuance = issued.get(value);
  return Boolean(issuance && issuance.expiresAt > Date.now() && (!request || issuance.request === request));
}
