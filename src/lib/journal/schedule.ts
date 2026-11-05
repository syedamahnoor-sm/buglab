/*
 * The recall schedule: review after 1 day, then 3 days, then 7 days.
 *
 * Responses are self-reported. "Got it" moves to the next interval (staying at
 * 7 days once reached); "Need practice" goes back to 1 day. There is no score,
 * streak or mastery: only when the learner asked to be reminded next.
 */
import { cleanReflection, JOURNAL_VERSION, LIMITS, type Journal, type JournalEntry, type RecallResponse, type Reflection } from "./model";

export const INTERVAL_DAYS: readonly number[] = Object.freeze([1, 3, 7]);
const DAY_MS = 86_400_000;

const after = (now: Date, days: number) => new Date(now.getTime() + days * DAY_MS).toISOString();
const lastStage = INTERVAL_DAYS.length - 1;

export function isDue(entry: JournalEntry, now: Date): boolean {
  return Date.parse(entry.recall.dueAt) <= now.getTime();
}

/** Entries due for recall, the longest overdue first. */
export function dueEntries(journal: Journal, now: Date): JournalEntry[] {
  return Object.values(journal.entries)
    .filter((entry) => isDue(entry, now))
    .sort((a, b) => a.recall.dueAt.localeCompare(b.recall.dueAt));
}

/**
 * Whole days until the entry's next recall, for display: 0 when due, otherwise
 * the nearest whole number of days and never less than 1. Rounding (rather than
 * rounding up) keeps a clock read a few minutes earlier from adding a day.
 */
export function daysUntilDue(entry: JournalEntry, now: Date): number {
  const remaining = Date.parse(entry.recall.dueAt) - now.getTime();
  return remaining <= 0 ? 0 : Math.max(1, Math.round(remaining / DAY_MS));
}

export class ReflectionError extends Error {}

/**
 * Saves a reflection. A new entry starts the schedule (due in 1 day); editing an
 * existing one keeps its recall history and due date.
 */
export function saveReflection(journal: Journal, challengeId: string, input: Partial<Reflection>, now: Date): Journal {
  const reflection = cleanReflection(input);
  if (!reflection.takeaway) throw new ReflectionError("A takeaway is required.");
  const existing = journal.entries[challengeId];
  if (!existing && Object.keys(journal.entries).length >= LIMITS.entries) {
    throw new ReflectionError(`The journal holds up to ${LIMITS.entries} entries. Delete one to add another.`);
  }
  const stamp = now.toISOString();
  const entry: JournalEntry = existing
    ? { ...existing, reflection, updatedAt: stamp }
    : { challengeId, reflection, reflectedAt: stamp, updatedAt: stamp, recall: { stage: 0, dueAt: after(now, INTERVAL_DAYS[0]), attempts: [] } };
  return { version: JOURNAL_VERSION, entries: { ...journal.entries, [challengeId]: entry } };
}

/** Records a self-reported recall response and schedules the next review. */
export function recordRecall(journal: Journal, challengeId: string, response: RecallResponse, now: Date): Journal {
  const entry = journal.entries[challengeId];
  if (!entry) return journal;
  const stage = response === "got-it" ? Math.min(entry.recall.stage + 1, lastStage) : 0;
  const attempts = [...entry.recall.attempts, { at: now.toISOString(), response }].slice(-LIMITS.attempts);
  return {
    version: JOURNAL_VERSION,
    entries: { ...journal.entries, [challengeId]: { ...entry, recall: { stage, dueAt: after(now, INTERVAL_DAYS[stage]), attempts } } },
  };
}

export function deleteEntry(journal: Journal, challengeId: string): Journal {
  if (!journal.entries[challengeId]) return journal;
  const entries = { ...journal.entries };
  delete entries[challengeId];
  return { version: JOURNAL_VERSION, entries };
}
