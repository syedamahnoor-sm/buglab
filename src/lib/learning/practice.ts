/*
 * "Apply": a related published challenge to practise next, why it is related,
 * and whether the learner has applied the lesson there.
 *
 * Suggestions come from public catalog metadata only (category, technologies,
 * topics): the same suggestion for every learner, not a personalised
 * recommendation. The only learner data used is to skip challenges already
 * solved in this browser, and that is stated wherever a suggestion is shown.
 *
 * The status is derived, never stored, so it cannot drift from the facts:
 *   suggested  shown, not opened
 *   opened     opened from the suggestion (a click proves nothing more)
 *   applied    a correct diagnosis of the suggested challenge was confirmed
 *              AFTER it was opened from the suggestion
 */
import { categoryLabel } from "@/data/catalog/categories";
import { relatedChallenges } from "@/lib/catalog/discovery";
import type { PublicChallenge } from "@/types/catalog";
import { LEARNING_VERSION, LIMITS, type LearningRecord, type PracticeLink } from "./model";

export interface Suggestion {
  challenge: PublicChallenge;
  /** Plain-language reasons, for example "Same category: Databases & Data Integrity". */
  reasons: string[];
}

export type PracticeStatus = "suggested" | "opened" | "applied";

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
 * The most related published challenge not yet solved in this browser,
 * falling back to the most related one overall. Never the challenge itself.
 * Null when nothing relates.
 */
export function suggestRelated(
  target: PublicChallenge,
  published: readonly PublicChallenge[],
  solvedIds: ReadonlySet<string> = new Set(),
): Suggestion | null {
  const related = relatedChallenges(target, published, published.length).filter((challenge) => challenge.id !== target.id);
  const pick = related.find((challenge) => !solvedIds.has(challenge.id)) ?? related[0];
  return pick ? { challenge: pick, reasons: relationReasons(target, pick) } : null;
}

/**
 * What to show as practice after `from`: the challenge the learner already
 * opened from it, if any (so an opened or applied case stays visible with its
 * status), otherwise a fresh suggestion. Null when nothing relates.
 */
export function practiceFor(
  record: LearningRecord,
  from: PublicChallenge,
  published: readonly PublicChallenge[],
): (Suggestion & { status: PracticeStatus }) | null {
  const links = record.practice.filter((link) => link.fromChallengeId === from.id);
  for (const link of [...links].reverse()) {
    const target = published.find((challenge) => challenge.id === link.toChallengeId);
    if (target) return { challenge: target, reasons: relationReasons(from, target), status: practiceStatus(record, from.id, target.id) };
  }
  const suggestion = suggestRelated(from, published, new Set(Object.keys(record.solves)));
  return suggestion ? { ...suggestion, status: "suggested" } : null;
}

/** Records that the learner opened `to` from the suggestion on `from`. Re-opening keeps the first time. */
export function recordPracticeOpened(record: LearningRecord, from: string, to: string, now: Date): LearningRecord {
  if (from === to || findPractice(record, from, to)) return record;
  const practice = [...record.practice, { fromChallengeId: from, toChallengeId: to, openedAt: now.toISOString() }].slice(-LIMITS.practice);
  return { ...record, version: LEARNING_VERSION, practice };
}

export function findPractice(record: LearningRecord, from: string, to: string): PracticeLink | null {
  return record.practice.find((link) => link.fromChallengeId === from && link.toChallengeId === to) ?? null;
}

/** Derived from the facts: applied only when a confirmed solve of `to` came after it was opened from `from`. */
export function practiceStatus(record: LearningRecord, from: string, to: string): PracticeStatus {
  const link = findPractice(record, from, to);
  if (!link) return "suggested";
  const solve = record.solves[to];
  return solve && Date.parse(solve.lastSolvedAt) > Date.parse(link.openedAt) ? "applied" : "opened";
}
