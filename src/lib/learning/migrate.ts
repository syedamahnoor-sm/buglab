/*
 * Upgrading a Sprint 9B journal (version 1, "buglab.journal.v1") to the
 * learning record (version 2). Pure and non-destructive:
 *
 * - The input is never modified; the store also never deletes or rewrites the
 *   version 1 key, so the original stays available.
 * - Every word the learner wrote is carried over. "What would you look for
 *   next time?" becomes "What would you do differently next time?"; the new
 *   "What did you initially misunderstand?" starts empty.
 * - A version 1 entry existed only after this browser saw a confirmed correct
 *   diagnosis, so each one also becomes an observed solve, dated (at the
 *   latest) when the reflection was written.
 * - Due times become local due days; recall history is kept.
 * - Entries that cannot be read faithfully are reported, not dropped silently.
 */
import { localDay } from "./days";
import {
  cleanReflection,
  isChallengeId,
  isRecord,
  isTime,
  LEARNING_VERSION,
  LIMITS,
  MAX_STAGE,
  type LearningRecord,
  type ObservedSolve,
  type ParseProblem,
  type RecallAttempt,
  type ReflectionEntry,
} from "./model";

export const LEGACY_JOURNAL_VERSION = 1;

export interface MigrationResult {
  record: LearningRecord;
  /** Version 1 entries carried over. */
  migrated: number;
  problems: ParseProblem[];
}

function migrateEntry(id: string, raw: unknown): { entry: ReflectionEntry; solve: ObservedSolve } | null {
  if (!isChallengeId(id) || !isRecord(raw) || raw.challengeId !== id) return null;
  if (!isRecord(raw.reflection) || !isRecord(raw.recall)) return null;
  if (!isTime(raw.reflectedAt) || !isTime(raw.updatedAt) || !isTime(raw.recall.dueAt)) return null;
  const old = raw.reflection;
  const reflection = cleanReflection({ cause: old.cause as string, evidence: old.evidence as string, nextTime: old.lookFor as string, takeaway: old.takeaway as string });
  if (!reflection.takeaway) return null;
  const stage = raw.recall.stage;
  if (typeof stage !== "number" || !Number.isInteger(stage) || stage < 0) return null;
  const attempts: RecallAttempt[] = Array.isArray(raw.recall.attempts)
    ? raw.recall.attempts
        .filter((attempt) => isRecord(attempt) && isTime(attempt.at) && (attempt.response === "got-it" || attempt.response === "need-practice"))
        .map((attempt) => ({ at: attempt.at as string, day: localDay(new Date(attempt.at as string)), response: attempt.response as RecallAttempt["response"] }))
        .slice(-LIMITS.attempts)
    : [];
  const clamped = Math.min(stage, MAX_STAGE);
  const last = attempts.at(-1);
  return {
    entry: {
      challengeId: id,
      reflection,
      reflectedAt: raw.reflectedAt,
      updatedAt: raw.updatedAt,
      recall: {
        stage: clamped,
        dueOn: localDay(new Date(raw.recall.dueAt)),
        lastReviewedOn: last ? last.day : null,
        // Version 1 did not record the stage before a day's first review; treat the current stage as settled.
        stageBefore: clamped,
        attempts,
      },
    },
    solve: { challengeId: id, firstSolvedAt: raw.reflectedAt, lastSolvedAt: raw.reflectedAt, timesSolved: 1, source: "browser" },
  };
}

/** Is this stored text a version 1 journal? */
export function isLegacyJournal(raw: unknown): raw is { version: 1; entries: Record<string, unknown> } {
  return isRecord(raw) && raw.version === LEGACY_JOURNAL_VERSION && isRecord(raw.entries);
}

/** Upgrades the text of a version 1 journal. Never throws; never modifies its input. */
export function migrateJournalV1(text: string): MigrationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { record: emptyRecord(), migrated: 0, problems: [{ kind: "unreadable", detail: "version 1 journal is not valid JSON" }] };
  }
  if (!isLegacyJournal(raw)) {
    return { record: emptyRecord(), migrated: 0, problems: [{ kind: "unknown-version", detail: "not a version 1 journal" }] };
  }
  const reflections: Record<string, ReflectionEntry> = {};
  const solves: Record<string, ObservedSolve> = {};
  const problems: ParseProblem[] = [];
  const entries = Object.entries(raw.entries);
  for (const [id, value] of entries.slice(0, LIMITS.reflections)) {
    const migrated = migrateEntry(id, value);
    if (migrated) {
      reflections[id] = migrated.entry;
      solves[id] = migrated.solve;
    } else {
      problems.push({ kind: "invalid-entry", detail: `version 1 entry "${id.slice(0, 60)}"` });
    }
  }
  if (entries.length > LIMITS.reflections) problems.push({ kind: "over-limit", detail: `${entries.length - LIMITS.reflections} version 1 entries beyond the limit` });
  return { record: { version: LEARNING_VERSION, solves, reflections, practice: [] }, migrated: Object.keys(reflections).length, problems };
}

const emptyRecord = (): LearningRecord => ({ version: LEARNING_VERSION, solves: {}, reflections: {}, practice: [] });
