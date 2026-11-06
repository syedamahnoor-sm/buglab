/*
 * Habin linking boundary entry for VerifiedAccount. Server-only.
 *
 * Codex owns issuance in `@/server/auth/verified-account` (Better Auth session → branded proof with
 * accountId, verified email, displayName, role). Habin never trusts browser-supplied account fields.
 * This module keeps the historical `(provider, request)` call shape used by link-boundary and stores,
 * and re-exports assert helpers that accept only Codex-issued proofs.
 */
import "server-only";
import type { AuthProvider } from "@/server/auth/provider";
import {
  isVerifiedAccount,
  verifyAccount as verifyAuthAccount,
  type VerifiedAccount,
} from "@/server/auth/verified-account";

export type { VerifiedAccount };
export { isVerifiedAccount };

export type IdentityErrorCode = "unverified-account" | "link-failed";

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;

  constructor(code: IdentityErrorCode, message: string) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
  }
}

/**
 * Verifies the signed-in account for this request through the injected AuthProvider.
 * Prefer calling `@/server/auth/verified-account` directly from account HTTP; Habin linking uses this wrapper.
 */
export async function verifyAccount(provider: AuthProvider, request: Request): Promise<VerifiedAccount | null> {
  return verifyAuthAccount(request, provider);
}

/** Throws unless `value` is a Codex-issued VerifiedAccount that has not expired. */
export function assertVerifiedAccount(value: unknown): asserts value is VerifiedAccount {
  if (!isVerifiedAccount(value)) {
    throw new IdentityError("unverified-account", "An account must come from a verified authentication session.");
  }
}
