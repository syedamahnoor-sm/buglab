import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChallengeWorkspacePage } from "@/components/challenge/ChallengeWorkspacePage";
import { getPublicScenario, listChallengeSummaries } from "@/lib/challenge-catalog";

// Every catalog challenge is prerendered, and the whole route must stay static.
// An unknown ID renders the 404 page; it is never a request-time render of data.
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return listChallengeSummaries().map(({ id }) => ({ challengeId: id }));
}

export async function generateMetadata({ params }: PageProps<"/challenges/[challengeId]">): Promise<Metadata> {
  const scenario = getPublicScenario((await params).challengeId);
  if (!scenario) return {};
  const { number, title } = scenario.challenge;
  return { title: `BugLab · Challenge ${number}: ${title}` };
}

export default async function ChallengePage({ params }: PageProps<"/challenges/[challengeId]">) {
  // Awaited before rendering anything, so notFound() can still set a 404 status.
  const scenario = getPublicScenario((await params).challengeId);
  if (!scenario) notFound();
  return (
    <ChallengeWorkspacePage
      scenario={scenario}
      next={nextPublished(scenario.challenge.id)}
      publishedIds={listChallengeSummaries().map(({ id }) => id)}
    />
  );
}

/** The next published challenge in catalog order, or null after the last one. Never an unpublished ID. */
function nextPublished(challengeId: string) {
  const published = listChallengeSummaries();
  const following = published[published.findIndex(({ id }) => id === challengeId) + 1];
  return following ? { id: following.id, number: following.number, title: following.title } : null;
}
