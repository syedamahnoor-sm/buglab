/*
 * The learning record (version 2): one browser-local, versioned document that
 * the Learning Loop and, later, Learning Progress both read. One source of
 * truth, three kinds of data kept apart:
 *
 *   solves       Facts this browser observed: the diagnosis server confirmed a
 *                correct diagnosis for a challenge. Local evidence only. They
 *                are NOT server-attested completions, can be edited by anyone
 *                with access to the browser, and must never back a secure
 *                achievement or verified progress (see ObservedSolve).
 *   reflections  What the learner wrote after a solve, and its recall schedule.
 *   practice     Related challenges the learner opened from an Apply
 *                suggestion. Whether one was applied is derived (practice.ts),
 *                never stored, so it cannot drift from the solves.
 *
 * Nothing from an answer key, a resolution or grading is ever stored: only the
 * learner's own words, dates, self-reported recall responses and challenge IDs.
 *
 * Parsing never throws and never silently discards learner text. Data that
 * cannot be read faithfully is reported (`problems`), and the store keeps the
 * original text as a recovery copy before anything is written over it.
 */

export const LEARNING_VERSION = 2;

export const LIMITS = Object.freeze({
  /** Each guided reflection prompt. */
  answerLength: 600,
  /** The takeaway shown at recall time. */
  takeawayLength: 280,
  /** Recall attempts kept per reflection (oldest dropped first). */
  attempts: 20,
  reflections: 100,
  solves: 300,
  practice: 200,
});

/** A calendar day in the learner's local time zone, "YYYY-MM-DD". */
export type LocalDay = string;

export type RecallResponse = "got-it" | "need-practice";

/**
 * A correct diagnosis observed in this browser: the diagnosis endpoint
 * answered "correct" while this page was open. Browser-local and editable,
 * so it is a record of what the learner saw, not proof. A future server-
 * attested completion (Habin's learner sessions) is a separate, authoritative
 * fact and must not be inferred from this.
 */
export interface ObservedSolve {
  challengeId: string;
  firstSolvedAt: string;
  lastSolvedAt: string;
  timesSolved: number;
  source: "browser";
}

export interface Reflection {
  /** What caused the bug? */
  cause: string;
  /** Which evidence helped identify it? */
  evidence: string;
  /** What did you initially misunderstand? */
  misunderstanding: string;
  /** What would you do differently next time? */
  nextTime: string;
  /** A concise takeaway, in the learner's own words. Required: it is what recall reveals. */
  takeaway: string;
}

export interface RecallAttempt {
  at: string;
  day: LocalDay;
  response: RecallResponse;
}

export interface Recall {
  /** Position in the review schedule (schedule.ts): 0, 1 or 2. */
  stage: number;
  /** The local day the next review is due. */
  dueOn: LocalDay;
  /** The local day of the last review, or null before the first. */
  lastReviewedOn: LocalDay | null;
  /** The stage at the start of `lastReviewedOn`, so a second review that day replaces, not stacks. */
  stageBefore: number;
  attempts: RecallAttempt[];
}

export interface ReflectionEntry {
  challengeId: string;
  reflection: Reflection;
  reflectedAt: string;
  updatedAt: string;
  recall: Recall;
}

/** A related challenge the learner opened from an Apply suggestion. */
export interface PracticeLink {
  fromChallengeId: string;
  toChallengeId: string;
  openedAt: string;
}

export interface LearningRecord {
  version: typeof LEARNING_VERSION;
  solves: Record<string, ObservedSolve>;
  reflections: Record<string, ReflectionEntry>;
  practice: PracticeLink[];
}

export const EMPTY_RECORD: LearningRecord = Object.freeze({
  version: LEARNING_VERSION,
  solves: Object.freeze({}),
  reflections: Object.freeze({}),
  practice: Object.freeze([]),
}) as unknown as LearningRecord;

export const MAX_STAGE = 2;
const CHALLENGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
export const isLocalDay = (value: unknown): value is LocalDay => typeof value === "string" && LOCAL_DAY.test(value);
export const isChallengeId = (value: unknown): value is string => typeof value === "string" && CHALLENGE_ID.test(value);
const isStage = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_STAGE;

/** Trims a learner's text and cuts it to the limit. */
export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
}

export function cleanReflection(input: Partial<Reflection>): Reflection {
  return {
    cause: cleanText(input.cause, LIMITS.answerLength),
    evidence: cleanText(input.evidence, LIMITS.answerLength),
    misunderstanding: cleanText(input.misunderstanding, LIMITS.answerLength),
    nextTime: cleanText(input.nextTime, LIMITS.answerLength),
    takeaway: cleanText(input.takeaway, LIMITS.takeawayLength),
  };
}

/** Something in stored data that could not be read faithfully. The original text is kept by the store. */
export interface ParseProblem {
  kind: "unreadable" | "unknown-version" | "invalid-entry" | "over-limit";
  detail: string;
}

export interface ParseResult {
  record: LearningRecord;
  problems: ParseProblem[];
}

function parseSolve(id: string, raw: unknown): ObservedSolve | null {
  if (!isChallengeId(id) || !isRecord(raw) || raw.challengeId !== id) return null;
  if (!isTime(raw.firstSolvedAt) || !isTime(raw.lastSolvedAt)) return null;
  const times = raw.timesSolved;
  if (typeof times !== "number" || !Number.isInteger(times) || times < 1) return null;
  return { challengeId: id, firstSolvedAt: raw.firstSolvedAt, lastSolvedAt: raw.lastSolvedAt, timesSolved: times, source: "browser" };
}

function parseAttempts(raw: unknown): RecallAttempt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (attempt): attempt is RecallAttempt =>
        isRecord(attempt) && isTime(attempt.at) && isLocalDay(attempt.day) && (attempt.response === "got-it" || attempt.response === "need-practice"),
    )
    .map(({ at, day, response }) => ({ at, day, response }))
    .slice(-LIMITS.attempts);
}

function parseReflection(id: string, raw: unknown): ReflectionEntry | null {
  if (!isChallengeId(id) || !isRecord(raw) || raw.challengeId !== id) return null;
  if (!isRecord(raw.reflection) || !isRecord(raw.recall)) return null;
  if (!isTime(raw.reflectedAt) || !isTime(raw.updatedAt)) return null;
  const recall = raw.recall;
  if (!isStage(recall.stage) || !isStage(recall.stageBefore) || !isLocalDay(recall.dueOn)) return null;
  if (recall.lastReviewedOn !== null && !isLocalDay(recall.lastReviewedOn)) return null;
  const reflection = cleanReflection(raw.reflection as Partial<Reflection>);
  if (!reflection.takeaway) return null;
  return {
    challengeId: id,
    reflection,
    reflectedAt: raw.reflectedAt,
    updatedAt: raw.updatedAt,
    recall: {
      stage: recall.stage,
      dueOn: recall.dueOn,
      lastReviewedOn: recall.lastReviewedOn,
      stageBefore: recall.stageBefore,
      attempts: parseAttempts(recall.attempts),
    },
  };
}

function parsePractice(raw: unknown): PracticeLink | null {
  if (!isRecord(raw) || !isChallengeId(raw.fromChallengeId) || !isChallengeId(raw.toChallengeId) || !isTime(raw.openedAt)) return null;
  if (raw.fromChallengeId === raw.toChallengeId) return null;
  return { fromChallengeId: raw.fromChallengeId, toChallengeId: raw.toChallengeId, openedAt: raw.openedAt };
}

function parseMap<T>(raw: unknown, limit: number, label: string, parse: (id: string, value: unknown) => T | null, problems: ParseProblem[]) {
  const out: Record<string, T> = {};
  if (!isRecord(raw)) {
    if (raw !== undefined) problems.push({ kind: "invalid-entry", detail: `${label} is not a map` });
    return out;
  }
  const entries = Object.entries(raw);
  for (const [id, value] of entries.slice(0, limit)) {
    const parsed = parse(id, value);
    if (parsed) out[id] = parsed;
    else problems.push({ kind: "invalid-entry", detail: `${label} entry "${id.slice(0, 60)}"` });
  }
  if (entries.length > limit) problems.push({ kind: "over-limit", detail: `${entries.length - limit} ${label} beyond the limit of ${limit}` });
  return out;
}

/**
 * Reads a stored version 2 record. Never throws. Anything that cannot be read
 * faithfully is listed in `problems` rather than dropped silently; the caller
 * (the store) keeps the original text before writing over it. Entries for
 * challenges that are no longer published are kept: the UI decides what to show.
 */
export function parseRecord(text: string | null): ParseResult {
  if (text === null || text === "") return { record: EMPTY_RECORD, problems: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { record: EMPTY_RECORD, problems: [{ kind: "unreadable", detail: "not valid JSON" }] };
  }
  if (!isRecord(raw) || raw.version !== LEARNING_VERSION) {
    const version = isRecord(raw) ? String(raw.version) : typeof raw;
    return { record: EMPTY_RECORD, problems: [{ kind: "unknown-version", detail: `version ${version.slice(0, 20)}` }] };
  }
  const problems: ParseProblem[] = [];
  const solves = parseMap(raw.solves, LIMITS.solves, "solve", parseSolve, problems);
  const reflections = parseMap(raw.reflections, LIMITS.reflections, "reflection", parseReflection, problems);
  const practice: PracticeLink[] = [];
  if (Array.isArray(raw.practice)) {
    for (const value of raw.practice.slice(0, LIMITS.practice)) {
      const link = parsePractice(value);
      if (link) practice.push(link);
      else problems.push({ kind: "invalid-entry", detail: "practice link" });
    }
    if (raw.practice.length > LIMITS.practice) problems.push({ kind: "over-limit", detail: "practice links beyond the limit" });
  } else if (raw.practice !== undefined) {
    problems.push({ kind: "invalid-entry", detail: "practice is not a list" });
  }
  return { record: { version: LEARNING_VERSION, solves, reflections, practice }, problems };
}

export function serializeRecord(record: LearningRecord): string {
  return JSON.stringify(record);
}

/** Reflections, newest first. */
export function listReflections(record: LearningRecord): ReflectionEntry[] {
  return Object.values(record.reflections).sort(
    (a, b) => b.reflectedAt.localeCompare(a.reflectedAt) || a.challengeId.localeCompare(b.challengeId),
  );
}
