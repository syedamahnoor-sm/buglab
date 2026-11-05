import type { Metadata } from "next";
import { JournalPage } from "@/components/journal/JournalPage";
import { listPublishedChallenges } from "@/lib/challenge-catalog";

export const metadata: Metadata = {
  title: "BugLab · Learning Journal",
  description: "Your reflections on solved investigations, and when to recall them.",
};

export default function Journal() {
  return <JournalPage challenges={listPublishedChallenges()} />;
}
