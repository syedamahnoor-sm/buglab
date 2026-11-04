/*
 * Public challenge catalog: the challenges a learner can open, and the
 * learner-visible scenario for each. The single place pages, the proxy and
 * route generation look challenges up. Challenges are registered in
 * src/data/catalog; only published ones are visible here.
 *
 * Public data only. Answer keys and other evaluation data stay server-side in
 * *.server.ts modules and must never be imported here. Importing this module
 * from a client component would bundle every scenario, so call it from server
 * components and pass the result down as props.
 */
import { REGISTERED_CHALLENGES } from "@/data/catalog";
import { byCatalogOrder, createCatalog } from "@/lib/catalog/catalog";
import type { PublicChallenge } from "@/types/catalog";
import type { ChallengeSummary, WorkspaceScenario } from "@/types/workspace";

const catalog = createCatalog(REGISTERED_CHALLENGES);

const SUMMARY_FIELDS = ["id", "number", "title", "incident", "difficulty", "completion", "tags", "estimatedMinutes"] as const;

/**
 * A new array of the summaries in catalog order: by challenge number compared
 * numerically ("2" before "10"), then by ID, so the order never depends on
 * the input order.
 */
export function sortChallengeSummaries(summaries: readonly ChallengeSummary[]): ChallengeSummary[] {
  return [...summaries].sort(byCatalogOrder);
}

/**
 * Summaries of every published challenge, in catalog order. Each call returns
 * new copies (tags included), so a caller changing one cannot affect the
 * catalog or any other caller.
 */
export function listChallengeSummaries(): ChallengeSummary[] {
  return catalog.listPublished().map((challenge) => {
    const summary = {} as Record<string, unknown>;
    for (const field of SUMMARY_FIELDS) summary[field] = challenge[field];
    return summary as unknown as ChallengeSummary;
  });
}

/** Published challenges with their listing metadata, for discovery. Public data only. */
export function listPublishedChallenges(): PublicChallenge[] {
  return catalog.listPublished();
}

/** The public scenario for a published challenge ID (exact match), or null if there is none. */
export function getPublicScenario(challengeId: string): WorkspaceScenario | null {
  return catalog.getPublishedScenario(challengeId);
}

/** The full inventory, drafts and archived included. Server code for the admin area only. */
export function getCatalogInventory() {
  return catalog.inventory();
}
