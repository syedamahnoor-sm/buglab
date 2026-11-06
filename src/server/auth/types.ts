/*
 * Authenticated accounts. Server-only.
 *
 * An ACCOUNT is a person who signed in. It is a different identity from the
 * anonymous LEARNER of the learner-session module (the buglab_learner cookie):
 * the two are linked only by an explicit, recorded decision (learner-link.ts),
 * never by sharing an id or a cookie. Nothing here reads or replaces the
 * learner-session cookie or store.
 */
import "server-only";

export type Role = "learner" | "admin";

export const ROLES: readonly Role[] = ["learner", "admin"];

/** The account as server code sees it after authentication. No credential material, ever. */
export interface AuthenticatedUser {
  /** The provider's stable account id. Not a learner id. */
  readonly id: string;
  readonly email: string;
  /** Providers that issue VerifiedAccount proofs must explicitly report true. */
  readonly emailVerified?: boolean;
  readonly displayName: string | null;
  readonly role: Role;
}

export interface AuthSession {
  readonly user: AuthenticatedUser;
  /** When the provider's session ends (ISO 8601). */
  readonly expiresAt: string;
}

/**
 * What a sign-up may contain. There is deliberately no role: every new account
 * is a learner, and admin is granted only by the provisioning process.
 */
export interface RegistrationInput {
  readonly email: string;
  readonly displayName: string | null;
}

/** The record a durable store would keep linking an account to an anonymous learner. */
export interface AccountLearnerLink {
  readonly accountId: string;
  readonly learnerId: string;
  readonly linkedAt: string;
}
