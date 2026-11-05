/*
 * "Apply": a related published challenge to try next, and why it is related,
 * in terms of public catalog metadata only.
 */
import { categoryLabel } from "@/data/catalog/categories";
import { relatedChallenges } from "@/lib/catalog/discovery";
import type { PublicChallenge } from "@/types/catalog";

export interface Suggestion {
  challenge: PublicChallenge;
  /** Plain-language reasons, for example "Same category: Databases & Data Integrity". */
  reasons: string[];
}

function shared(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b.map((value) => value.toLowerCase()));
  return a.filter((value) => other.has(value.toLowerCase()));
}

export function relationReasons(target: PublicChallenge, candidate: PublicChallenge): string[] {
  const reasons: string[] = [];
  if (candidate.category === target.category) reasons.push(`Same category: ${categoryLabel(target.category)}`);
  const technologies = shared(candidate.technologies, target.technologies);
  if (technologies.length) reasons.push(`Shared technologies: ${technologies.join(", ")}`);
  const tags = shared(candidate.tags, target.tags);
  if (tags.length) reasons.push(`Shared topics: ${tags.join(", ")}`);
  return reasons;
}

/**
 * The most related published challenge the learner has not already reflected
 * on, falling back to the most related one overall. Null when nothing relates.
 */
export function suggestRelated(
  target: PublicChallenge,
  published: readonly PublicChallenge[],
  reflectedIds: ReadonlySet<string> = new Set(),
): Suggestion | null {
  const related = relatedChallenges(target, published, published.length);
  const pick = related.find((challenge) => !reflectedIds.has(challenge.id)) ?? related[0];
  return pick ? { challenge: pick, reasons: relationReasons(target, pick) } : null;
}
