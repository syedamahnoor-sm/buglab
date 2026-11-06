import type { Metadata } from "next";
import { ProgressPage } from "@/components/progress/ProgressPage";
import { listPublishedChallenges } from "@/lib/challenge-catalog";

export const metadata: Metadata = {
  title: "BugLab · Learning Progress",
  description: "What you have solved, reflected on and recalled in this browser, and what to do next.",
};

export default function Progress() {
  return <ProgressPage challenges={listPublishedChallenges()} />;
}
