/*
 * Linking this browser's anonymous learner to the signed-in account.
 * Browser-safe. The route awaits the shared learner adapter; the decision table is Habin's
 * (src/server/auth/learner-link.ts and the account-linking flow document).
 *
 * The browser proves nothing itself. The server reads the HttpOnly
 * `buglab_learner` cookie, the provider session and an explicit
 * `consent: true`. The request body carries the consent and nothing else: no
 * learner id, no account id, no list of solves. So a link can only ever attach
 * history the SERVER recorded for this browser's learner (verified
 * completions, attempts, reflections). Browser-local solves, recall and the
 * journal stored in this browser are never sent, never imported and never
 * become verified completions.
 */

/** Outcomes of `POST /api/account/link`, exactly the backend's codes. */
export type LinkOutcome =
  | "linked"
  | "already-linked"
  | "no-browser-learner"
  | "claimed-by-another-account"
  | "consent-required"
  | "unauthenticated"
  | "unavailable";

const OUTCOMES: ReadonlySet<string> = new Set<LinkOutcome>([
  "linked",
  "already-linked",
  "no-browser-learner",
  "claimed-by-another-account",
  "consent-required",
  "unauthenticated",
  "unavailable",
]);

export function isLinkOutcome(value: unknown): value is LinkOutcome {
  return typeof value === "string" && OUTCOMES.has(value);
}

/**
 * What the server can say before anything is attempted (`GET /api/account/link`).
 * `browserLearner` is whether THIS request carried a live anonymous credential,
 * which the browser itself cannot see. It reveals nothing about other accounts.
 */
export interface LinkStatus {
  account: "linked" | "unlinked";
  browserLearner: "present" | "none";
}

export function parseLinkStatus(body: unknown): LinkStatus | null {
  if (typeof body !== "object" || body === null) return null;
  const { account, browserLearner } = body as Record<string, unknown>;
  if (account !== "linked" && account !== "unlinked") return null;
  if (browserLearner !== "present" && browserLearner !== "none") return null;
  return { account, browserLearner };
}

/** What the person is offered, from the status. */
export type LinkOffer = "offer" | "nothing-to-link" | "already-has-history";

export function linkOffer(status: LinkStatus): LinkOffer {
  if (status.account === "linked") return "already-has-history";
  return status.browserLearner === "present" ? "offer" : "nothing-to-link";
}

/** The wording for each outcome. Tone decides how it is shown. */
export interface LinkMessage {
  tone: "success" | "info" | "warning" | "danger";
  title: string;
  body: string;
}

export const LINK_MESSAGES: Record<LinkOutcome, LinkMessage> = {
  linked: {
    tone: "success",
    title: "Your history is now part of your account",
    body: "The challenges BugLab's server recorded for this browser now belong to your account, wherever you sign in. Your Learning Journal and recall reviews stay in this browser, as before.",
  },
  "already-linked": {
    tone: "info",
    title: "Your account already has its own history",
    body: "An account keeps one learning history, and two histories are never merged. This browser's anonymous history stays separate and unchanged. Nothing was moved.",
  },
  "no-browser-learner": {
    tone: "info",
    title: "There is no server-recorded history in this browser to link",
    body: "BugLab's server has no live anonymous history for this browser, or it has expired. Your Learning Journal and the solves recorded in this browser are untouched.",
  },
  "claimed-by-another-account": {
    tone: "warning",
    title: "This browser's history belongs to another account",
    body: "It has already been linked to a different account and is never transferred. Nothing was changed. Sign in with that account to see it.",
  },
  "consent-required": {
    tone: "warning",
    title: "Linking needs your confirmation",
    body: "Tick the confirmation and try again. Nothing is linked without it.",
  },
  unauthenticated: {
    tone: "warning",
    title: "Your session has ended",
    body: "Sign in again to link this browser's history. Nothing was changed.",
  },
  unavailable: {
    tone: "info",
    title: "Linking is not available yet",
    body: "BugLab's account service can't link histories at the moment. Your browser history is untouched and stays where it is.",
  },
};
