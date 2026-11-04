import type { Metadata } from "next";
import { ChallengeLibrary } from "@/components/challenge/ChallengeLibrary";
import { listPublishedChallenges } from "@/lib/challenge-catalog";

export const metadata: Metadata = {
  title: "BugLab · Challenge Library",
  description: "Browse BugLab's debugging challenges.",
};

export default function ChallengesPage() {
  return <ChallengeLibrary challenges={listPublishedChallenges()} />;
}
