/*
 * The Learning Journal: what a learner wrote after solving a challenge, and
 * when they last tried to recall it. Client-safe and browser-local.
 *
 * Only the learner's own words, dates and self-reported recall responses are
 * kept. Nothing from an answer key, a resolution or grading is ever stored,
 * and an entry is not proof of completion: it records that this browser saw a
 * confirmed diagnosis, nothing more.
 */

export const JOURNAL_VERSION = 1;

export const LIMITS = Object.freeze({
  /** Each reflection prompt. */
  answerLength: 600,
  /** The one-line takeaway shown at recall time. */
  takeawayLength: 280,
  /** Recall attempts kept per entry (oldest dropped first). */
  attempts: 20,
  /** Entries kept in total. */
  entries: 100,
});

export type RecallResponse = "got-it" | "need-practice";

export interface Reflection {
  /** What evidence helped you identify the root cause? */
  evidence: string;
  /** Why did the bug happen? */
  cause: string;
  /** What would you look for next time? */
  lookFor: string;
  /** A concise takeaway, in the learner's own words. Required. */
  takeaway: string;
}

export interface RecallAttempt {
  at: string;
  response: RecallResponse;
}

export interface Recall {
  /** Position in the review schedule (see schedule.ts). */
  stage: number;
  dueAt: string;
  attempts: RecallAttempt[];
}

export interface JournalEntry {
  challengeId: string;
  reflection: Reflection;
  reflectedAt: string;
  updatedAt: string;
  recall: Recall;
}

export interface Journal {
  version: typeof JOURNAL_VERSION;
  entries: Record<string, JournalEntry>;
}

export const EMPTY_JOURNAL: Journal = Object.freeze({ version: JOURNAL_VERSION, entries: Object.freeze({}) }) as Journal;

const CHALLENGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** Trims a learner's text and cuts it to the limit. */
export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
}

export function cleanReflection(input: Partial<Reflection>): Reflection {
  return {
    evidence: cleanText(input.evidence, LIMITS.answerLength),
    cause: cleanText(input.cause, LIMITS.answerLength),
    lookFor: cleanText(input.lookFor, LIMITS.answerLength),
    takeaway: cleanText(input.takeaway, LIMITS.takeawayLength),
  };
}

function parseEntry(id: string, raw: unknown, published: ReadonlySet<string>): JournalEntry | null {
  if (!CHALLENGE_ID.test(id) || !published.has(id) || !isRecord(raw)) return null;
  if (raw.challengeId !== id || !isRecord(raw.reflection) || !isRecord(raw.recall)) return null;
  if (!isTime(raw.reflectedAt) || !isTime(raw.updatedAt) || !isTime(raw.recall.dueAt)) return null;
  const reflection = cleanReflection(raw.reflection as Partial<Reflection>);
  if (!reflection.takeaway) return null;
  const stage = raw.recall.stage;
  if (typeof stage !== "number" || !Number.isInteger(stage) || stage < 0 || stage > 10) return null;
  const attempts = Array.isArray(raw.recall.attempts)
    ? raw.recall.attempts
        .filter((attempt): attempt is RecallAttempt => isRecord(attempt) && isTime(attempt.at) && (attempt.response === "got-it" || attempt.response === "need-practice"))
        .map((attempt) => ({ at: attempt.at, response: attempt.response }))
        .slice(-LIMITS.attempts)
    : [];
  return {
    challengeId: id,
    reflection,
    reflectedAt: raw.reflectedAt,
    updatedAt: raw.updatedAt,
    recall: { stage, dueAt: raw.recall.dueAt, attempts },
  };
}

export type ParseResult = { journal: Journal; discarded: number; corrupt: boolean };

/**
 * Reads stored text into a journal. Never throws. Unknown versions and
 * unreadable data give an empty journal marked corrupt; entries for
 * challenges that are no longer published, or that fail validation, are
 * dropped and counted.
 */
export function parseJournal(text: string | null, published: ReadonlySet<string>): ParseResult {
  if (text === null || text === "") return { journal: EMPTY_JOURNAL, discarded: 0, corrupt: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { journal: EMPTY_JOURNAL, discarded: 0, corrupt: true };
  }
  if (!isRecord(raw) || raw.version !== JOURNAL_VERSION || !isRecord(raw.entries)) {
    return { journal: EMPTY_JOURNAL, discarded: 0, corrupt: true };
  }
  const entries: Record<string, JournalEntry> = {};
  let discarded = 0;
  for (const [id, value] of Object.entries(raw.entries).slice(0, LIMITS.entries)) {
    const entry = parseEntry(id, value, published);
    if (entry) entries[id] = entry;
    else discarded += 1;
  }
  discarded += Math.max(0, Object.keys(raw.entries).length - LIMITS.entries);
  return { journal: { version: JOURNAL_VERSION, entries }, discarded, corrupt: false };
}

export function serializeJournal(journal: Journal): string {
  return JSON.stringify(journal);
}

/** Entries, newest reflection first. */
export function listEntries(journal: Journal): JournalEntry[] {
  return Object.values(journal.entries).sort((a, b) => b.reflectedAt.localeCompare(a.reflectedAt) || a.challengeId.localeCompare(b.challengeId));
}
