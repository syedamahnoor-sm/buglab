/*
 * Publication gate for the diagnosis endpoint. Server-only.
 *
 * The diagnosis registry holds answer keys; the public catalog decides what is
 * published. Without this gate an answer key registered for a draft or archived
 * challenge would make that challenge submittable through the API, and a
 * correct answer would return its resolution. Restricting the registry to
 * published IDs makes such a challenge an unknown one (404), at the same point
 * in the handler's checks as any other unknown challenge.
 */
import "server-only";
import { listChallengeSummaries } from "@/lib/challenge-catalog";
import type { DiagnosisRegistry } from "./registry";

export function publishedChallengeIds(): ReadonlySet<string> {
  return new Set(listChallengeSummaries().map((challenge) => challenge.id));
}

/** The registry's challenges that the public catalog has published. Everything else is left out. */
export function restrictToPublished(
  registry: DiagnosisRegistry,
  publishedIds: ReadonlySet<string> = publishedChallengeIds(),
): DiagnosisRegistry {
  return new Map([...registry].filter(([challengeId]) => publishedIds.has(challengeId)));
}
