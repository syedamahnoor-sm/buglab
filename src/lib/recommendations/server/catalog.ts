import "server-only";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { publicMetadata } from "../engine";
import type { Candidate } from "../types";

/** Only published public metadata crosses into recommendations. Never import the private registry. */
export function recommendationCatalog(): Candidate[] {
  return listPublishedChallenges().map((challenge) => ({
    ...publicMetadata(challenge), publication: "published", completion: challenge.completion,
    available: challenge.completion === "diagnosis",
  }));
}