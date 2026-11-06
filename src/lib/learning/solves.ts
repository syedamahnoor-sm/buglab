/*
 * Observed solves: the diagnosis endpoint confirmed a correct diagnosis while
 * a challenge page was open in this browser. Only that event records one; an
 * incorrect, rejected or failed submission records nothing.
 *
 * These are local observations (see ObservedSolve in model.ts), never
 * server-attested completions, achievements or verified progress.
 */
import { LEARNING_VERSION, LIMITS, type LearningRecord } from "./model";

export class SolveError extends Error {}

/** Records one server-confirmed correct diagnosis. Solving again later updates the same record. */
export function recordObservedSolve(record: LearningRecord, challengeId: string, now: Date): LearningRecord {
  const stamp = now.toISOString();
  const existing = record.solves[challengeId];
  if (!existing && Object.keys(record.solves).length >= LIMITS.solves) {
    throw new SolveError(`The journal keeps up to ${LIMITS.solves} solved challenges.`);
  }
  const solve = existing
    ? { ...existing, lastSolvedAt: stamp, timesSolved: existing.timesSolved + 1 }
    : { challengeId, firstSolvedAt: stamp, lastSolvedAt: stamp, timesSolved: 1, source: "browser" as const };
  return { ...record, version: LEARNING_VERSION, solves: { ...record.solves, [challengeId]: solve } };
}

export function isSolved(record: LearningRecord, challengeId: string): boolean {
  return Boolean(record.solves[challengeId]);
}
