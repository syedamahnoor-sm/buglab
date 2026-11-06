import { plural } from "@/components/journal/format";
import type { ProgressOverview } from "@/lib/progress/overview";
import type { VerifiedState } from "@/lib/verified/model";

const BROWSER = "Showing progress from this browser.";

/** One line on where completions come from: this browser only, or the server too. */
export function verificationMessage(verified: VerifiedState, overview: ProgressOverview): string {
  switch (verified.status) {
    case "not-connected":
      return "Browser progress only: server-verified completions are not connected yet.";
    case "loading":
      return "Checking server-verified completions…";
    case "no-learner":
      return `No learner session, so nothing is server-verified yet. ${BROWSER}`;
    case "expired":
      return `Your learner session has expired, so verified completions can't be read. ${BROWSER}`;
    case "unavailable":
      return `Verified completions couldn't be loaded. ${BROWSER}`;
    case "ready":
      return `${overview.verified} verified by BugLab's server · ${plural(overview.browserOnly, "challenge")} completed in this browser only.`;
  }
}

/** A small, quiet status line. Verified is shown in green only when the server confirmed something. */
export function VerificationStatus({ verified, overview }: { verified: VerifiedState; overview: ProgressOverview }) {
  const confirmed = verified.status === "ready" && overview.verified > 0;
  return (
    <p role="status" className="flex items-start gap-2 text-xs leading-relaxed text-muted">
      <span aria-hidden="true" className={`mt-1 size-1.5 shrink-0 rounded-full ${confirmed ? "bg-success" : "bg-subtle"}`} />
      {verificationMessage(verified, overview)}
    </p>
  );
}
