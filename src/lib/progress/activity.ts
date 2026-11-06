/*
 * Learning Activity: a timeline read straight from the learning record.
 *
 * Every event is a time the record actually holds. The record keeps the first
 * and the latest solve of each challenge (not every repeat), the time a
 * reflection was written and last edited, each recall review and each time a
 * practice case was opened from the Journal. Nothing in between is inferred.
 */
import type { LocalDay, RecallResponse } from "@/lib/learning/model";
import type { ProgressSource } from "./source";

export type ActivityEvent =
  | { kind: "solved"; at: string; challengeId: string }
  | { kind: "solved-again"; at: string; challengeId: string; timesSolved: number }
  | { kind: "reflected"; at: string; challengeId: string }
  | { kind: "reflection-edited"; at: string; challengeId: string }
  | { kind: "recalled"; at: string; challengeId: string; response: RecallResponse; reviewsThatDay: number }
  | { kind: "practice-opened"; at: string; challengeId: string; fromChallengeId: string };

/** Later events of the same instant read in the order things happen: solve, reflect, recall, practise. */
const ORDER: Record<ActivityEvent["kind"], number> = {
  "practice-opened": 0,
  recalled: 1,
  "reflection-edited": 2,
  reflected: 3,
  "solved-again": 4,
  solved: 5,
};

/** Every recorded event, newest first. */
export function learningActivity(source: ProgressSource): ActivityEvent[] {
  const { record } = source;
  const events: ActivityEvent[] = [];

  for (const solve of Object.values(record.solves)) {
    events.push({ kind: "solved", at: solve.firstSolvedAt, challengeId: solve.challengeId });
    if (solve.timesSolved > 1 && solve.lastSolvedAt !== solve.firstSolvedAt) {
      events.push({ kind: "solved-again", at: solve.lastSolvedAt, challengeId: solve.challengeId, timesSolved: solve.timesSolved });
    }
  }

  for (const entry of Object.values(record.reflections)) {
    events.push({ kind: "reflected", at: entry.reflectedAt, challengeId: entry.challengeId });
    if (entry.updatedAt !== entry.reflectedAt) events.push({ kind: "reflection-edited", at: entry.updatedAt, challengeId: entry.challengeId });

    // Several reviews on one day count once, and the last answer that day is the one kept: show that one.
    const byDay = new Map<LocalDay, { at: string; response: RecallResponse; count: number }>();
    for (const attempt of entry.recall.attempts) {
      const seen = byDay.get(attempt.day);
      byDay.set(attempt.day, { at: attempt.at, response: attempt.response, count: (seen?.count ?? 0) + 1 });
    }
    for (const review of byDay.values()) {
      events.push({ kind: "recalled", at: review.at, challengeId: entry.challengeId, response: review.response, reviewsThatDay: review.count });
    }
  }

  for (const link of record.practice) {
    events.push({ kind: "practice-opened", at: link.openedAt, challengeId: link.toChallengeId, fromChallengeId: link.fromChallengeId });
  }

  return events.sort(
    (a, b) => b.at.localeCompare(a.at) || ORDER[a.kind] - ORDER[b.kind] || a.challengeId.localeCompare(b.challengeId),
  );
}
