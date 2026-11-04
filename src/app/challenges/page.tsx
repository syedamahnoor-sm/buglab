import type { Metadata } from "next";
import { ChallengeLibrary } from "@/components/challenge/ChallengeLibrary";
import { listChallengeSummaries } from "@/lib/challenge-catalog";
import { challengePath } from "@/lib/challenge-routes";

export const metadata: Metadata = {
  title: "BugLab · Challenge Library",
  description: "Browse BugLab's debugging challenges.",
};

export default function ChallengesPage() {
  const entries = listChallengeSummaries().map((challenge) => ({ challenge, href: challengePath(challenge.id) }));
  return <ChallengeLibrary entries={entries} />;
}
