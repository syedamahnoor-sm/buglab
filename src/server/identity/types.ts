/*
 * The storage boundary between an authenticated ACCOUNT and the LEARNER it owns. Server-only.
 *
 * INACTIVE. Nothing mounts this, no route calls it, and the only authentication provider that exists
 * (src/server/auth/provider.ts) is the "unconfigured" one, which authenticates nobody. So today every operation here
 * is refused before it reaches storage. It exists so the schema and the interface can be reviewed, tested and agreed
 * BEFORE accounts are built.
 *
 * Two identities, kept apart, as src/server/auth/types.ts requires:
 *
 *   ANONYMOUS CREDENTIAL  the buglab_learner cookie token. Only its SHA-256 hash is stored, on the learner row, with its
 *                         idle and absolute expiry. It proves possession of an anonymous learner and nothing else.
 *   ACCOUNT               a signed-in person, identified by the authentication provider's stable id. It reaches its
 *                         learner through the link table, never through a cookie.
 *
 * A learner may have an anonymous credential, an account link, both, or (while it is in transit) neither. Authenticated
 * identity resolves the canonical learner SERVER-SIDE through the link; no token hash is needed, and none is invented.
 *
 * THE RULES (approved):
 *   - one account maps to at most one learner, and one learner to at most one account (unique on both);
 *   - linking is transactional, needs an authenticated account (never a caller-supplied id) AND verified possession of
 *     the anonymous learner (its live cookie token), and the learner's explicit consent;
 *   - linking RETIRES the anonymous credential it was proved with, in the same transaction, after authenticated access has
 *     been established and checked. The learner is then reachable only through the account;
 *   - nothing is ever merged: an account that already has a learner keeps it, and a learner another account claimed is
 *     never transferred;
 *   - a linked learner is never deleted by the expiry purge.
 */
import "server-only";
import type { VerifiedAccount } from "@/server/auth/verified-account";
import type { LearnerRecord, TokenHash } from "@/server/session/types";

/**
 * Server-issued account proof from Codex Better Auth (`@/server/auth/verified-account`).
 * Contains accountId, verified email, displayName and role. Never constructed by Habin stores.
 */
export type { VerifiedAccount };

/** What the store knows about an account's learner. Internal ids never go to the client. */
export interface AccountLearnerRecord {
  readonly id: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** When the account claimed this learner, from the database clock. */
  readonly linkedAt: number;
  /** Whether an anonymous cookie credential still exists for this learner. Always false for a linked learner: linking retires it. */
  readonly hasAnonymousCredential: boolean;
}

export interface LinkBrowserLearnerInput {
  /** The SHA-256 of the cookie token the browser presented, or null when it presented none or a malformed one. */
  readonly tokenHash: TokenHash | null;
  /** The learner's explicit consent to attach this browser's anonymous progress. Anything but `true` means no. */
  readonly consent: boolean;
}

/**
 * The outcome of asking to attach a browser's anonymous learner to an account. Each outcome matches one decision of
 * `decideLearnerLink` (src/server/auth/learner-link.ts), which a test checks for every combination.
 */
export type LinkOutcome =
  /**
   * `link-browser-learner`: the browser's learner now belongs to the account, AND its anonymous credential has been retired in
   * the same transaction. The old cookie reaches nothing from this moment, and the account reaches everything.
   */
  | { readonly status: "linked"; readonly learner: AccountLearnerRecord }
  /** `use-account-learner`: the account already has a learner. The browser's anonymous progress is left separate. */
  | { readonly status: "already-linked"; readonly learner: AccountLearnerRecord }
  /** `ask-consent`: everything else allows it, but the learner has not agreed. Nothing was written. */
  | { readonly status: "consent-required" }
  /**
   * `create-account-learner`: the browser has no live anonymous learner to attach (none, malformed, expired, or gone —
   * including when another account just won a concurrent link and retired this credential). Does not disclose ownership.
   */
  | { readonly status: "no-browser-learner" }
  /**
   * `create-account-learner`: the credential is still present and another account already owns that learner. Never
   * transferred. Distinct from the concurrent-retirement race, which answers `no-browser-learner` instead.
   */
  | { readonly status: "claimed-by-another-account" };

export interface AccountLearnerStore {
  /** The account's canonical learner, or null. Never judged by anonymous-credential expiry: an account's learner does not expire. */
  findLearnerByAccount(account: VerifiedAccount): Promise<AccountLearnerRecord | null>;

  /**
   * The account's learner, creating a new authenticated-only one (no anonymous credential) if it has none. Safe under
   * races: two simultaneous calls for one account yield one learner.
   */
  ensureAccountLearner(account: VerifiedAccount): Promise<{ readonly learner: AccountLearnerRecord; readonly created: boolean }>;

  /** Attaches the browser's anonymous learner to the account, in one transaction. See LinkOutcome. */
  linkBrowserLearner(account: VerifiedAccount, input: LinkBrowserLearnerInput): Promise<LinkOutcome>;
}

/** The anonymous learner record the cookie path resolves, re-exported so a caller can tell the two identities apart. */
export type AnonymousLearnerRecord = LearnerRecord;
