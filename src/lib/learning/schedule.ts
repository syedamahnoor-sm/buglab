/*
 * Reflections and their recall schedule: review 1 day, then 3 days, then
 * 7 days after the last review, counted in local calendar days.
 *
 * Responses are self-reported. "Got it" moves to the next interval (staying at
 * 7 days once reached); "Need practice" goes back to 1 day. There is no score,
 * streak or mastery: only when the learner asked to be reminded next. Nothing
 * here sends reminders; a review is simply due on the Journal from its day on.
 *
 * Rules that keep the schedule truthful:
 * - A reflection can only be written for a challenge with an observed solve.
 * - An overdue review is scheduled from the day it is actually done.
 * - Several reviews on one day count once: the latest response that day
 *   replaces the earlier one (all attempts are still kept in the history).
 * - Editing a reflection keeps its schedule; deleting it keeps the solve.
 */
import { addDays, localDay } from "./days";
import {
  cleanReflection,
  LEARNING_VERSION,
  LIMITS,
  MAX_STAGE,
  type LearningRecord,
  type LocalDay,
  type RecallResponse,
  type Reflection,
  type ReflectionEntry,
} from "./model";

export const INTERVAL_DAYS: readonly number[] = Object.freeze([1, 3, 7]);

export class ReflectionError extends Error {}

export function isDue(entry: ReflectionEntry, today: LocalDay): boolean {
  return entry.recall.dueOn <= today;
}

/** Reflections due for recall on `today`, the longest overdue first. */
export function dueReflections(record: LearningRecord, today: LocalDay): ReflectionEntry[] {
  return Object.values(record.reflections)
    .filter((entry) => isDue(entry, today))
    .sort((a, b) => a.recall.dueOn.localeCompare(b.recall.dueOn) || a.challengeId.localeCompare(b.challengeId));
}

/** The reflection due soonest after `today`, if none is due now. */
export function nextUpcoming(record: LearningRecord, today: LocalDay): ReflectionEntry | null {
  return (
    Object.values(record.reflections)
      .filter((entry) => !isDue(entry, today))
      .sort((a, b) => a.recall.dueOn.localeCompare(b.recall.dueOn))[0] ?? null
  );
}

/**
 * Saves a reflection for a solved challenge. A new reflection starts the
 * schedule (due the next local day); editing keeps its schedule and history.
 */
export function saveReflection(record: LearningRecord, challengeId: string, input: Partial<Reflection>, now: Date): LearningRecord {
  if (!record.solves[challengeId]) throw new ReflectionError("Reflect after a confirmed solve of this challenge.");
  const reflection = cleanReflection(input);
  if (!reflection.takeaway) throw new ReflectionError("A takeaway is required.");
  const existing = record.reflections[challengeId];
  if (!existing && Object.keys(record.reflections).length >= LIMITS.reflections) {
    throw new ReflectionError(`The journal holds up to ${LIMITS.reflections} reflections. Delete one to add another.`);
  }
  const stamp = now.toISOString();
  const entry: ReflectionEntry = existing
    ? { ...existing, reflection, updatedAt: stamp }
    : {
        challengeId,
        reflection,
        reflectedAt: stamp,
        updatedAt: stamp,
        recall: { stage: 0, dueOn: addDays(localDay(now), INTERVAL_DAYS[0]), lastReviewedOn: null, stageBefore: 0, attempts: [] },
      };
  return { ...record, version: LEARNING_VERSION, reflections: { ...record.reflections, [challengeId]: entry } };
}

/** Records a self-reported recall response and schedules the next review. */
export function recordRecall(record: LearningRecord, challengeId: string, response: RecallResponse, now: Date): LearningRecord {
  const entry = record.reflections[challengeId];
  if (!entry) return record;
  const today = localDay(now);
  // A second review on the same day replaces that day's outcome instead of stacking on it.
  const base = entry.recall.lastReviewedOn === today ? entry.recall.stageBefore : entry.recall.stage;
  const stage = response === "got-it" ? Math.min(base + 1, MAX_STAGE) : 0;
  const attempts = [...entry.recall.attempts, { at: now.toISOString(), day: today, response }].slice(-LIMITS.attempts);
  const recall = { stage, dueOn: addDays(today, INTERVAL_DAYS[stage]), lastReviewedOn: today, stageBefore: base, attempts };
  return { ...record, version: LEARNING_VERSION, reflections: { ...record.reflections, [challengeId]: { ...entry, recall } } };
}

/** Removes a reflection and its schedule. The observed solve stays: it is a separate fact. */
export function deleteReflection(record: LearningRecord, challengeId: string): LearningRecord {
  if (!record.reflections[challengeId]) return record;
  const reflections = { ...record.reflections };
  delete reflections[challengeId];
  return { ...record, version: LEARNING_VERSION, reflections };
}

/** Removes every reflection. Observed solves and practice history stay. */
export function clearReflections(record: LearningRecord): LearningRecord {
  return { ...record, version: LEARNING_VERSION, reflections: {} };
}
