/*
 * Linking a signed-in account to an anonymous learner. Server-only.
 *
 * The rule: progress moves only with the learner's explicit consent, only into
 * an account that has no learner yet, and only from a learner no other account
 * has claimed. Otherwise the account keeps its own learner and the browser's
 * anonymous progress stays where it is. Nothing is ever merged automatically,
 * so signing in on a shared computer can never hand one person's progress to
 * another.
 */
import "server-only";

export interface LinkContext {
  /** The learner already linked to this account, if any. */
  accountLearnerId: string | null;
  /** The anonymous learner of this browser (from the learner cookie, verified server-side), if any. */
  browserLearnerId: string | null;
  /** Whether the browser's learner is already linked to some account. */
  browserLearnerClaimedBy: string | null;
  /** The account asking. */
  accountId: string;
  /** The learner explicitly agreed to attach this browser's progress. */
  consent: boolean;
}

export type LinkDecision =
  | { action: "use-account-learner"; learnerId: string; reason: string }
  | { action: "ask-consent"; learnerId: string; reason: string }
  | { action: "link-browser-learner"; learnerId: string; reason: string }
  | { action: "create-account-learner"; reason: string };

export function decideLearnerLink(context: LinkContext): LinkDecision {
  if (context.accountLearnerId !== null) {
    return {
      action: "use-account-learner",
      learnerId: context.accountLearnerId,
      reason: "The account already has a learner; the browser's anonymous progress is left separate.",
    };
  }
  if (context.browserLearnerId === null) {
    return { action: "create-account-learner", reason: "There is no anonymous progress in this browser to attach." };
  }
  if (context.browserLearnerClaimedBy !== null) {
    return {
      action: "create-account-learner",
      reason: context.browserLearnerClaimedBy === context.accountId
        ? "This browser's learner is already this account's."
        : "This browser's learner belongs to another account and is never transferred.",
    };
  }
  if (!context.consent) {
    return { action: "ask-consent", learnerId: context.browserLearnerId, reason: "Attaching anonymous progress needs the learner's explicit consent." };
  }
  return { action: "link-browser-learner", learnerId: context.browserLearnerId, reason: "Consent given; the unclaimed anonymous learner joins the account." };
}
