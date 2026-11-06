/*
 * The inactive integration boundary for account-to-learner linking and for resolving an authenticated learner.
 * Server-only.
 *
 * INACTIVE. No route imports this. With the only provider that exists (unconfigured) every call answers `unavailable`
 * before touching storage. It is the place a future route would call, so the authentication contract can be reviewed
 * against something concrete without any endpoint existing.
 *
 * WHAT IT DOES NOT DO. It does not authenticate anyone, issue or read a session, handle a password, or add a second
 * authentication system: identity comes from the injected `AuthProvider` (Syeda's port) and from nothing else. It does not
 * read an account id from the request. The anonymous learner is proved by the buglab_learner cookie, exactly as today.
 *
 * WHAT A ROUTE MUST STILL DO (outside this module): apply the same-origin write guard (src/server/auth/guards.ts) before
 * calling a linking operation; take `consent` from an explicit user action in the request body; and answer with these
 * statuses only. Nothing returned here contains an internal id except `resolveLearner`, which is for server code.
 */
import "server-only";
import type { AuthProvider } from "@/server/auth/provider";
import { readLearnerCookie } from "@/server/session/cookie";
import { hashSessionToken, parseSessionToken } from "@/server/session/token";
import type { TokenHash } from "@/server/session/types";
import type { AccountLearnerStore } from "./types";
import { verifyAccount } from "./verified-account";

export interface LearnerLinkingDeps {
  /** The authentication provider. Today only the unconfigured one exists, which authenticates nobody. */
  auth: AuthProvider;
  accounts: AccountLearnerStore;
}

/** What a linking request may be told. Never an id, a hash or a token. */
export type LinkingStatus =
  | "linked"
  | "already-linked"
  | "consent-required"
  | "no-browser-learner"
  | "claimed-by-another-account";

export type LinkingResult =
  /**
   * The browser's learner now belongs to the account and its anonymous credential is RETIRED. The route that answers must
   * clear the old buglab_learner cookie (it is inert now: it matches nothing) and rely on the signed-in session from here on.
   */
  | { readonly status: "linked"; readonly retiredAnonymousCredential: true }
  /** No authentication provider is configured. Nothing was read or written. */
  | { readonly status: "unavailable" }
  /** A provider is configured but nobody is signed in on this request. Nothing was read or written. */
  | { readonly status: "unauthenticated" }
  | { readonly status: Exclude<LinkingStatus, "linked"> };

/** For server code only: the canonical learner of the signed-in account, resolved through the link. */
export type ResolvedLearner =
  | { readonly status: "unavailable" | "unauthenticated" | "no-learner" }
  | { readonly status: "ok"; readonly learnerId: string };

/** The cookie's token hash, or null when the request has no cookie or a malformed one. Never throws. */
function browserTokenHash(request: Request): TokenHash | null {
  const token = parseSessionToken(readLearnerCookie(request.headers.get("cookie")));
  return token === null ? null : hashSessionToken(token);
}

export function createLearnerLinking({ auth, accounts }: LearnerLinkingDeps) {
  return {
    /**
     * Attaches this browser's anonymous learner to the signed-in account, if the rules allow it. Requires an authenticated
     * account (from the provider, never the request's claim) and the browser's live anonymous credential.
     */
    async linkBrowserLearner(request: Request, options: { consent: boolean }): Promise<LinkingResult> {
      if (!auth.configured) return { status: "unavailable" };
      const account = await verifyAccount(auth, request);
      if (!account) return { status: "unauthenticated" };

      const outcome = await accounts.linkBrowserLearner(account, {
        tokenHash: browserTokenHash(request),
        consent: options.consent === true,
      });
      return outcome.status === "linked" ? { status: "linked", retiredAnonymousCredential: true } : { status: outcome.status };
    },

    /** The signed-in account's learner, creating an authenticated-only one if it has none. Reveals no id. */
    async ensureLearner(request: Request): Promise<{ readonly status: "unavailable" | "unauthenticated" | "ok"; readonly created?: boolean }> {
      if (!auth.configured) return { status: "unavailable" };
      const account = await verifyAccount(auth, request);
      if (!account) return { status: "unauthenticated" };
      const { created } = await accounts.ensureAccountLearner(account);
      return { status: "ok", created };
    },

    /** Resolves the canonical learner for the signed-in account, server-side, through the link. For server code only. */
    async resolveLearner(request: Request): Promise<ResolvedLearner> {
      if (!auth.configured) return { status: "unavailable" };
      const account = await verifyAccount(auth, request);
      if (!account) return { status: "unauthenticated" };
      const learner = await accounts.findLearnerByAccount(account);
      return learner ? { status: "ok", learnerId: learner.id } : { status: "no-learner" };
    },
  };
}
