/*
 * The registered ACCOUNT as the browser sees it. Browser-safe.
 *
 * Two identities exist in BugLab and they are never the same thing:
 *
 *   anonymous learner  the HttpOnly `buglab_learner` cookie (Habin's learner
 *                      sessions). The browser can neither read nor name it.
 *   account            a person signed in through the authentication provider,
 *                      with a separate, provider-issued session.
 *
 * The only relationship between them is an explicit, consented link made on
 * the server (lib/account/link.ts). Nothing here derives an account from the
 * learner cookie or from browser storage, and nothing here can grant a role:
 * the role is what the server's session read reports, and it only changes what
 * the interface offers. Every protected operation is authorized by the server.
 */

/** Roles in the backend matrix (src/server/auth/types.ts). There are no others. */
export type AccountRole = "learner" | "admin";

/** Ways an account can sign in. Only methods the server reports are shown. */
export type SignInMethod = "password" | "google";

/** The signed-in account, reduced to what the interface needs. No credential material, ever. */
export interface AccountUser {
  /** The provider's stable, opaque account id. Used only to scope this browser's caches. Never a learner id. */
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  /** Whether the provider has verified the email address. */
  readonly emailVerified: boolean;
  readonly role: AccountRole;
  readonly signInMethods: readonly SignInMethod[];
  /** When the account was created (ISO 8601), when the server reports it. */
  readonly createdAt: string | null;
}

export interface AccountSession {
  readonly user: AccountUser;
  /** When the provider's session ends (ISO 8601). */
  readonly expiresAt: string;
}

/**
 * Why the account state could not be determined. "unavailable" is the normal
 * state while no authentication backend is connected: it is not an error and
 * it is never shown as "signed out".
 */
export type AccountProblem = "network" | "timeout" | "server" | "rate-limited" | "invalid-response" | "unsupported-browser";

export type AccountState =
  /** The server reports accounts are unavailable; account-scoped content stays hidden. */
  | { status: "unavailable" }
  /** The session has not been read yet. Nothing account-scoped may be shown. */
  | { status: "loading" }
  /** Read from the server: nobody is signed in. */
  | { status: "anonymous"; reason?: "signed-out" | "expired" }
  | { status: "authenticated"; session: AccountSession }
  /** The session could not be read. Account-scoped data stays hidden; browser data is unaffected. */
  | { status: "error"; problem: AccountProblem };

export const ACCOUNT_UNAVAILABLE: AccountState = Object.freeze({ status: "unavailable" });
export const ACCOUNT_LOADING: AccountState = Object.freeze({ status: "loading" });

/**
 * The identity that account-scoped caches belong to. Two states with the same
 * key may share cached data; any change of key must discard it. Loading and
 * error states have no key, so nothing cached is shown while the identity is
 * uncertain.
 */
export function identityKey(state: AccountState): string | null {
  if (state.status === "authenticated") return `account:${state.session.user.id}`;
  if (state.status === "anonymous" || state.status === "unavailable") return "anonymous";
  return null;
}

/** A short name to greet the account with: the display name, else the part of the email before the @. */
export function accountName(user: Pick<AccountUser, "displayName" | "email">): string {
  return user.displayName?.trim() || user.email.split("@")[0] || user.email;
}

/** One or two initials for the avatar, from the name. */
export function accountInitials(user: Pick<AccountUser, "displayName" | "email">): string {
  const words = accountName(user)
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Whether the session's end has passed at `now`. */
export function isSessionExpired(session: AccountSession, now: number = Date.now()): boolean {
  const end = Date.parse(session.expiresAt);
  return Number.isNaN(end) || end <= now;
}
