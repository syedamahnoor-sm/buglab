/*
 * Shape checks for learner-session responses. A body that does not match is
 * treated as an unrecognised response, never trusted as data.
 */
import { isAttemptStatus, isFeedback } from "@/lib/diagnosis/response";
import type { EvidenceRef } from "@/types/investigation";
import type {
  AttemptSummary,
  ChallengeSession,
  LearnerState,
  SessionCompletion,
} from "@/types/learner-session";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

function isEvidenceRef(value: unknown): value is EvidenceRef {
  if (!isRecord(value)) return false;
  return (value.kind === "log" && isString(value.logId)) || (value.kind === "network" && isString(value.requestId));
}

function isCompletion(value: unknown): value is SessionCompletion {
  if (!isRecord(value) || !isRecord(value.resolution) || !isRecord(value.submission)) return false;
  const { submission } = value;
  return (
    isString(value.resolution.summary) &&
    isFeedback(value.feedback) &&
    isCount(submission.attempt) &&
    isString(submission.rootCauseId) &&
    isString(submission.explanation) &&
    Array.isArray(submission.evidence) &&
    submission.evidence.every(isEvidenceRef)
  );
}

export function isChallengeSession(value: unknown): value is ChallengeSession {
  if (!isRecord(value) || !isRecord(value.attempts)) return false;
  const completed = value.status === "completed";
  return (
    isString(value.challengeId) &&
    isString(value.contentVersion) &&
    (value.status === "active" || completed) &&
    isString(value.startedAt) &&
    (value.completedAt === undefined || isString(value.completedAt)) &&
    isBoolean(value.restartRequired) &&
    isCount(value.attempts.total) &&
    isCount(value.attempts.wrong) &&
    isAttemptStatus(value.attempts.window) &&
    // The server sends completion exactly when the session is completed.
    (completed ? isCompletion(value.completion) : value.completion === undefined)
  );
}

const SESSION_FIELDS = [
  "challengeId",
  "contentVersion",
  "status",
  "startedAt",
  "completedAt",
  "restartRequired",
  "attempts",
  "completion",
] as const;

/**
 * The session view inside a `{ session: { state: "active", ... } }` body: only
 * the known session fields, so the envelope's own keys and anything a later
 * server adds are left out. Check the result with isChallengeSession.
 */
export function sessionOf(body: UnknownRecord): unknown {
  const view: UnknownRecord = {};
  for (const field of SESSION_FIELDS) if (body[field] !== undefined) view[field] = body[field];
  return view;
}

export function isLearnerState(value: unknown): value is LearnerState {
  return value === "none" || value === "expired" || value === "active";
}

export function isAttemptSummary(value: unknown): value is AttemptSummary {
  return (
    isRecord(value) &&
    isCount(value.seq) &&
    isString(value.submittedAt) &&
    isString(value.rootCauseId) &&
    (value.result === "correct" || value.result === "incorrect") &&
    isCount(value.evidenceCount)
  );
}

export { isBoolean, isRecord, isString };
