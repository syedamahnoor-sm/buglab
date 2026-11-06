/*
 * Continue Learning: what to do next, in the Learning Loop's order of urgency.
 *
 *   1. recall    reviews that are due today or overdue (time-sensitive)
 *   2. reflect   solved challenges that have no takeaway yet
 *   3. apply     the Journal's related practice case for a reflected challenge
 *   4. explore   a starting point in a category not explored yet, or, when
 *                every category has been explored, the next unsolved challenge
 *
 * The first three come from the learner's own record and reuse the Journal's
 * rules (dueReflections, practiceFor), so the dashboard and the Journal always
 * agree. "Explore" comes from public catalog metadata only: the same order the
 * Challenge Library recommends, for every learner. Nothing is personalised.
 */
import { CATEGORIES } from "@/data/catalog/categories";
import { compareRecommended } from "@/lib/catalog/discovery";
import type { LocalDay } from "@/lib/learning/model";
import { listReflections } from "@/lib/learning/model";
import { practiceFor, type PracticeStatus } from "@/lib/learning/practice";
import { dueReflections } from "@/lib/learning/schedule";
import type { CategoryId, PublicChallenge } from "@/types/catalog";
import { isCompleted, mergeCompletions } from "./completions";
import type { ProgressSource } from "./source";

/** Where a step's reasoning comes from: the learner's record here, or the public catalog. */
export type StepBasis = "your-record" | "catalog";

export type NextStep =
  | { kind: "recall"; basis: "your-record"; challenge: PublicChallenge; dueOn: LocalDay; more: number }
  | { kind: "reflect"; basis: "your-record"; challenge: PublicChallenge; more: number }
  | { kind: "apply"; basis: "your-record"; from: PublicChallenge; challenge: PublicChallenge; reasons: string[]; status: Exclude<PracticeStatus, "applied"> }
  | { kind: "explore"; basis: "catalog"; challenge: PublicChallenge; category: CategoryId; firstSolve: boolean; newCategory: boolean };

export function continueLearning(
  source: ProgressSource,
  published: readonly PublicChallenge[],
  today: LocalDay,
  limit = 4,
): NextStep[] {
  const { record } = source;
  const byId = new Map(published.map((challenge) => [challenge.id, challenge]));
  const steps: NextStep[] = [];
  // Completed by either origin: never recommended again. Verified completions
  // only ever remove recommendations; they never add recall or reflection steps,
  // which belong to browser solves (the Journal reflects on those only).
  const completions = mergeCompletions(source, published);
  const done = (id: string) => isCompleted(completions, id);

  const due = dueReflections(record, today).filter((entry) => byId.has(entry.challengeId));
  if (due[0]) steps.push({ kind: "recall", basis: "your-record", challenge: byId.get(due[0].challengeId)!, dueOn: due[0].recall.dueOn, more: due.length - 1 });

  const awaiting = Object.values(record.solves)
    .filter((solve) => byId.has(solve.challengeId) && !record.reflections[solve.challengeId])
    .sort((a, b) => b.lastSolvedAt.localeCompare(a.lastSolvedAt));
  if (awaiting[0]) steps.push({ kind: "reflect", basis: "your-record", challenge: byId.get(awaiting[0].challengeId)!, more: awaiting.length - 1 });

  // The newest reflection whose practice case has not been applied yet.
  for (const entry of listReflections(record)) {
    const from = byId.get(entry.challengeId);
    const practice = from ? practiceFor(record, from, published) : null;
    if (from && practice && practice.status !== "applied" && !(done(practice.challenge.id) && practice.status === "suggested")) {
      steps.push({ kind: "apply", basis: "your-record", from, challenge: practice.challenge, reasons: practice.reasons, status: practice.status });
      break;
    }
  }

  // Starting points in categories with nothing solved yet, in the library's recommended order.
  const solvedCategories = new Set([...completions.byId.keys()].map((id) => byId.get(id)!.category));
  const firstSolve = solvedCategories.size === 0;
  const taken = new Set(steps.map((step) => step.challenge.id));
  const starts = CATEGORIES.filter((category) => !solvedCategories.has(category.id))
    .flatMap((category) => {
      const pick = published.filter((challenge) => challenge.category === category.id && !taken.has(challenge.id) && !done(challenge.id)).sort(compareRecommended)[0];
      return pick ? [pick] : [];
    })
    .sort(compareRecommended);
  for (const challenge of starts) {
    if (steps.length >= limit) break;
    steps.push({ kind: "explore", basis: "catalog", challenge, category: challenge.category, firstSolve, newCategory: true });
    taken.add(challenge.id);
  }

  // Every category explored: keep at least two steps with the next unsolved challenges.
  const further = [...published].sort(compareRecommended).filter((challenge) => !done(challenge.id) && !taken.has(challenge.id));
  for (const challenge of further) {
    if (steps.length >= Math.min(2, limit)) break;
    steps.push({ kind: "explore", basis: "catalog", challenge, category: challenge.category, firstSolve, newCategory: false });
  }

  return steps.slice(0, limit);
}
