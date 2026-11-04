/*
 * Public challenge catalog: the challenges a learner can open, and the
 * learner-visible scenario for each. The single place pages look challenges
 * up, so a future public registry only has to replace this module.
 *
 * Public data only. Answer keys and other evaluation data stay server-side in
 * *.server.ts modules and must never be imported here. Importing this module
 * from a client component would bundle every scenario, so call it from server
 * components and pass the result down as props.
 */
import { challenge001 } from "@/data/challenge-001";
import type { ChallengeSummary, WorkspaceScenario } from "@/types/workspace";

const SCENARIOS: readonly WorkspaceScenario[] = [challenge001];

const scenariosById = new Map<string, WorkspaceScenario>();
for (const scenario of SCENARIOS) {
  const { id } = scenario.challenge;
  if (scenariosById.has(id)) throw new Error(`Duplicate challenge ID in the catalog: ${id}`);
  scenariosById.set(id, scenario);
}

/**
 * A new array of the summaries in catalog order: by challenge number compared
 * numerically ("2" before "10"), then by ID, so the order never depends on
 * the input order.
 */
export function sortChallengeSummaries(summaries: readonly ChallengeSummary[]): ChallengeSummary[] {
  return [...summaries].sort(
    (a, b) =>
      a.number.localeCompare(b.number, "en", { numeric: true }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Summaries of every available challenge, in catalog order. Each call returns
 * new copies (tags included), so a caller changing one cannot affect the
 * catalog or any other caller.
 */
export function listChallengeSummaries(): ChallengeSummary[] {
  return sortChallengeSummaries(SCENARIOS.map((scenario) => structuredClone(scenario.challenge)));
}

/** The public scenario for a challenge ID (exact match), or null if there is none. */
export function getPublicScenario(challengeId: string): WorkspaceScenario | null {
  return scenariosById.get(challengeId) ?? null;
}
