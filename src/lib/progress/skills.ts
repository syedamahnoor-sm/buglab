/*
 * Skill Breakdown: for each category, how many of its published challenges
 * have been solved in this browser. Counts only: there is no mastery or skill
 * score, because solving a challenge once says nothing reliable about either.
 */
import { CATEGORIES } from "@/data/catalog/categories";
import { byCatalogOrder } from "@/lib/catalog/catalog";
import { compareRecommended } from "@/lib/catalog/discovery";
import type { CategoryId, PublicChallenge } from "@/types/catalog";
import type { ProgressSource } from "./source";

export interface CategoryProgress {
  id: CategoryId;
  label: string;
  description: string;
  /** Published challenges in the category, in catalog order, each marked solved or not. */
  challenges: { challenge: PublicChallenge; solved: boolean }[];
  solved: number;
  total: number;
  /** At least one challenge in the category is solved. */
  explored: boolean;
  /** The unsolved challenge to try next here, in the library's recommended order. Null when all are solved. */
  next: PublicChallenge | null;
}

export function skillBreakdown(source: ProgressSource, published: readonly PublicChallenge[]): CategoryProgress[] {
  const { solves } = source.record;
  return CATEGORIES.flatMap((category) => {
    const inCategory = published.filter((challenge) => challenge.category === category.id).sort((a, b) => byCatalogOrder(a, b));
    if (inCategory.length === 0) return [];
    const challenges = inCategory.map((challenge) => ({ challenge, solved: Object.hasOwn(solves, challenge.id) }));
    const solved = challenges.filter((item) => item.solved).length;
    const unsolved = inCategory.filter((challenge) => !(Object.hasOwn(solves, challenge.id))).sort(compareRecommended);
    return [
      {
        id: category.id,
        label: category.label,
        description: category.description,
        challenges,
        solved,
        total: inCategory.length,
        explored: solved > 0,
        next: unsolved[0] ?? null,
      },
    ];
  });
}
