import type { Metadata } from "next";
import { ChallengeLibrary } from "@/components/challenge/ChallengeLibrary";
import { listChallengeSummaries } from "@/lib/challenge-catalog";

export const metadata: Metadata = {
  title: "BugLab · Challenge Library",
  description: "Browse BugLab's debugging challenges.",
};

// TEMPORARY: there are no per-challenge routes yet, so the only playable
// challenge is played on the home page. A challenge with no route here is left
// out of the library rather than shown as a card that leads nowhere.
const PLAY_ROUTES: ReadonlyMap<string, string> = new Map([["challenge-001", "/"]]);

export default function ChallengesPage() {
  const entries = listChallengeSummaries().flatMap((challenge) => {
    const href = PLAY_ROUTES.get(challenge.id);
    return href ? [{ challenge, href }] : [];
  });
  return <ChallengeLibrary entries={entries} />;
}
