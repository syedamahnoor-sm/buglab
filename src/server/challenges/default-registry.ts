/*
 * The registry for the challenges that ship today: Challenge 001 and the challenges
 * registered in src/server/content. Server-only.
 *
 * `defaultChallengeSources` is the one list of what the default registry loads. To register a
 * challenge, add its source here and nowhere else. The revision-pin test reads this same list,
 * so a challenge added here fails that test until it has an explicit revision and digest pin.
 *
 * Builds a new registry on every call and keeps no global state. Whoever mounts it
 * decides how many to build and when; with the in-memory session store a process
 * should hold exactly one.
 */
import "server-only";
import { AUTHORED_CHALLENGES } from "@/server/content";
import { challenge001Source } from "./challenge-001";
import { loadChallengeRegistry, staticChallengeSource, type ChallengeSource } from "./loader";
import type { ChallengeRegistry } from "./registry";

// The challenges authored with src/server/content, as definitions: the scenario, the evaluation and the revision.
const authoredSource = staticChallengeSource(
  "authored-challenges",
  AUTHORED_CHALLENGES.map(({ scenario, evaluation, revision }) => ({ scenario, evaluation, revision })),
);

export const defaultChallengeSources: readonly ChallengeSource[] = Object.freeze([challenge001Source, authoredSource]);

export function createDefaultChallengeRegistry(): ChallengeRegistry {
  return loadChallengeRegistry(defaultChallengeSources);
}
