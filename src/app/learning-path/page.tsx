import type { Metadata } from "next";
import { SkipLinks, SkipTarget } from "@/components/layout/SkipLinks";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { LearningPathHeader } from "@/components/recommendations/LearningPathHeader";
import { LearningPathScreen } from "@/components/recommendations/LearningPathScreen";
import { recommendationCatalog } from "@/lib/recommendations/server/catalog";

export const metadata: Metadata = {
  title: "BugLab · Your Learning Path",
  description: "Choose your next debugging investigation, find focused practice and revisit what is due for recall.",
};
export default function LearningPathPage() {
  return <>
    <SkipLinks links={[{ target: "learning-path", label: "Skip to your learning path" }]} />
    <LearningPathHeader />
    <main className="library-canvas w-full flex-1"><SkipTarget id="learning-path" label="Learning path" /><LearningPathScreen publishedIds={recommendationCatalog().filter((c) => c.available).map((c) => c.id)} /></main>
    <SiteFooter />
  </>;
}