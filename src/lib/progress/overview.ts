/*
 * Learning Overview: the headline counts, each derived from the learning
 * record and the published catalog at the moment it is read. Nothing here is
 * stored, scored or estimated.
 */
import { CATEGORIES } from "@/data/catalog/categories";
import type { LocalDay } from "@/lib/learning/model";
import { dueReflections, nextUpcoming } from "@/lib/learning/schedule";
import type { PublicChallenge } from "@/types/catalog";
import { mergeCompletions } from "./completions";
import type { ProgressSource } from "./source";

export interface ProgressOverview {
  /** Published challenges completed by either origin: solved in this browser or verified by the server. */
  solved: number;
  /** Of those, confirmed by the server. Zero unless verification is available. */
  verified: number;
  /** Of those, observed in this browser and not confirmed by the server. */
  browserOnly: number;
  /** True when the server's verified completions were read. */
  verificationAvailable: boolean;
  /** Published challenges in the catalog. */
  total: number;
  /** Reflections written for published challenges. */
  reflections: number;
  /** Challenges solved in this browser with no reflection yet (the Journal reflects on browser solves only). */
  awaitingReflection: number;
  /** Recall reviews completed: one per reflection per day reviewed (several on one day count once). */
  reviewsDone: number;
  /** Reflections whose recall is due today or overdue. */
  reviewsDue: number;
  /** The next review day after today, when nothing is due. Null when none is scheduled. */
  nextReviewOn: LocalDay | null;
  /** Categories with at least one completed published challenge (either origin). */
  categoriesExplored: number;
  /** Categories that have published challenges. */
  categoriesTotal: number;
  /** Solves kept for challenges that are no longer published; left out of every count above. */
  unlisted: number;
}

/** The number of distinct days on which a reflection was reviewed. */
export function reviewDays(attempts: readonly { day: LocalDay }[]): number {
  return new Set(attempts.map((attempt) => attempt.day)).size;
}

export function progressOverview(source: ProgressSource, published: readonly PublicChallenge[], today: LocalDay): ProgressOverview {
  const { record } = source;
  const byId = new Map(published.map((challenge) => [challenge.id, challenge]));
  const solvedIds = Object.keys(record.solves).filter((id) => byId.has(id));
  const reflected = Object.values(record.reflections).filter((entry) => byId.has(entry.challengeId));
  const due = dueReflections(record, today).filter((entry) => byId.has(entry.challengeId));
  const upcoming = due.length ? null : nextUpcoming({ ...record, reflections: Object.fromEntries(reflected.map((entry) => [entry.challengeId, entry])) }, today);
  const withChallenges = new Set(published.map((challenge) => challenge.category));
  const completions = mergeCompletions(source, published);
  const explored = new Set([...completions.byId.keys()].map((id) => byId.get(id)!.category));

  return {
    solved: completions.completed,
    verified: completions.verified,
    browserOnly: completions.browserOnly,
    verificationAvailable: completions.verificationAvailable,
    total: published.length,
    reflections: reflected.length,
    awaitingReflection: solvedIds.filter((id) => !record.reflections[id]).length,
    reviewsDone: reflected.reduce((sum, entry) => sum + reviewDays(entry.recall.attempts), 0),
    reviewsDue: due.length,
    nextReviewOn: upcoming?.recall.dueOn ?? null,
    categoriesExplored: explored.size,
    categoriesTotal: CATEGORIES.filter((category) => withChallenges.has(category.id)).length,
    unlisted: Object.keys(record.solves).length - solvedIds.length,
  };
}
