/*
 * Adapter from Habin's linking boundary to Codex's SharedLearnerIntegration port.
 * Server-only. Not wired into the account route until migration 0003 is approved and applied.
 */
import "server-only";
import type { SharedLearnerIntegration } from "@/server/account/shared-learner";
import type { LinkOutcome as AccountLinkOutcome } from "@/lib/account/link";
import type { AuthProvider } from "@/server/auth/provider";
import type { VerifiedAccount } from "@/server/auth/verified-account";
import { isVerifiedAccount } from "@/server/auth/verified-account";
import { createLearnerLinking } from "@/server/identity/link-boundary";
import type { AccountLearnerStore } from "@/server/identity/types";
import { readLearnerCookie } from "@/server/session/cookie";
import { parseSessionToken } from "@/server/session/token";

function toAccountOutcome(status: string): AccountLinkOutcome {
  switch (status) {
    case "linked":
    case "already-linked":
    case "no-browser-learner":
    case "claimed-by-another-account":
    case "consent-required":
    case "unauthenticated":
    case "unavailable":
      return status;
    default:
      return "unavailable";
  }
}

/**
 * Builds the SharedLearnerIntegration Codex's account handler expects.
 * Requires a configured AuthProvider and Habin's AccountLearnerStore (PostgreSQL + 0003).
 */
export function createSharedLearnerIntegration(deps: {
  auth: AuthProvider;
  accounts: AccountLearnerStore;
}): SharedLearnerIntegration {
  const linking = createLearnerLinking(deps);
  return {
    async status(request: Request, account: VerifiedAccount) {
      if (!isVerifiedAccount(account, request)) {
        return { account: "unlinked", browserLearner: "none" };
      }
      const resolved = await linking.resolveLearner(request);
      const token = parseSessionToken(readLearnerCookie(request.headers.get("cookie")));
      return {
        account: resolved.status === "ok" ? "linked" : "unlinked",
        browserLearner: token ? "present" : "none",
      };
    },

    async link(request: Request, account: VerifiedAccount, consent: true) {
      if (!isVerifiedAccount(account, request) || consent !== true) {
        return { outcome: "consent-required" as const, clearAnonymousCookie: false };
      }
      const result = await linking.linkBrowserLearner(request, { consent: true });
      return {
        outcome: toAccountOutcome(result.status),
        clearAnonymousCookie: result.status === "linked",
      };
    },
  };
}
