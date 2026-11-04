/*
 * The registry for the challenges that ship today: Challenge 001. Server-only.
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
import { challenge001Source } from "./challenge-001";
import { loadChallengeRegistry, type ChallengeSource } from "./loader";
import type { ChallengeRegistry } from "./registry";

export const defaultChallengeSources: readonly ChallengeSource[] = Object.freeze([challenge001Source]);

export function createDefaultChallengeRegistry(): ChallengeRegistry {
  return loadChallengeRegistry(defaultChallengeSources);
}
