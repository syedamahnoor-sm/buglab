/*
 * Skill Breakdown: for each category, how many of its published challenges
 * have been completed (solved in this browser or verified by the server).
 * Counts only: there is no mastery or skill score, because completing a
 * challenge once says nothing reliable about either.
 */
import { CATEGORIES } from "@/data/catalog/categories";
import { byCatalogOrder } from "@/lib/catalog/catalog";
import { compareRecommended } from "@/lib/catalog/discovery";
import type { CategoryId, PublicChallenge } from "@/types/catalog";
import { mergeCompletions, type CompletionClass } from "./completions";
import type { ProgressSource } from "./source";

export interface CategoryProgress {
  id: CategoryId;
  label: string;
  description: string;
  /**
   * Published challenges in the category, in catalog order. `solved` means
   * completed by either origin; `completion` says which (null when not solved).
   */
  challenges: { challenge: PublicChallenge; solved: boolean; completion: CompletionClass | null }[];
  solved: number;
  /** Of those, confirmed by the server. */
  verified: number;
  total: number;
  /** At least one challenge in the category is completed. */
  explored: boolean;
  /** The challenge to try next here, in the library's recommended order, never one already completed. Null when all are. */
  next: PublicChallenge | null;
}

export function skillBreakdown(source: ProgressSource, published: readonly PublicChallenge[]): CategoryProgress[] {
  const completions = mergeCompletions(source, published);
  return CATEGORIES.flatMap((category) => {
    const inCategory = published.filter((challenge) => challenge.category === category.id).sort((a, b) => byCatalogOrder(a, b));
    if (inCategory.length === 0) return [];
    const challenges = inCategory.map((challenge) => {
      const completion = completions.byId.get(challenge.id) ?? null;
      return { challenge, solved: completion !== null, completion: completion?.classification ?? null };
    });
    const solved = challenges.filter((item) => item.solved).length;
    const verified = inCategory.filter((challenge) => completions.byId.get(challenge.id)?.verified).length;
    const unsolved = inCategory.filter((challenge) => !completions.byId.has(challenge.id)).sort(compareRecommended);
    return [
      {
        id: category.id,
        label: category.label,
        description: category.description,
        challenges,
        solved,
        verified,
        total: inCategory.length,
        explored: solved > 0,
        next: unsolved[0] ?? null,
      },
    ];
  });
}
