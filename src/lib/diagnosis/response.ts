import type {
  AttemptStatus,
  DiagnosisField,
  DiagnosisFieldError,
  DiagnosisFeedback,
  DiagnosisResponse,
  DiagnosisResponseStatus,
} from "@/types/diagnosis";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Typed per field: adding a DiagnosisField fails to compile until it is listed.
const FIELD_NAMES: Record<DiagnosisField, true> = {
  rootCauseId: true,
  explanation: true,
  evidence: true,
  body: true,
};

function isFieldError(value: unknown): value is DiagnosisFieldError {
  return (
    isRecord(value) &&
    isString(value.message) &&
    isString(value.field) &&
    Object.hasOwn(FIELD_NAMES, value.field)
  );
}

export function isFeedback(value: unknown): value is DiagnosisFeedback {
  return (
    isRecord(value) &&
    isString(value.headline) &&
    Array.isArray(value.hints) &&
    value.hints.every(isString) &&
    isRecord(value.evidenceSummary) &&
    isNumber(value.evidenceSummary.total) &&
    isNumber(value.evidenceSummary.logs) &&
    isNumber(value.evidenceSummary.network)
  );
}

export function isAttemptStatus(value: unknown): value is AttemptStatus {
  return (
    isRecord(value) &&
    isNumber(value.used) &&
    isNumber(value.limit) &&
    isNumber(value.remaining) &&
    (value.resetsAt === undefined || isString(value.resetsAt))
  );
}

// Typed per status: adding a status to DiagnosisResponse fails to compile until
// its shape is described here.
const SHAPES: Record<DiagnosisResponseStatus, (value: UnknownRecord) => boolean> = {
  correct: (value) =>
    isFeedback(value.feedback) &&
    isRecord(value.resolution) &&
    isString(value.resolution.summary) &&
    isAttemptStatus(value.attempts),
  incorrect: (value) => isFeedback(value.feedback) && isAttemptStatus(value.attempts),
  invalid: (value) => Array.isArray(value.errors) && value.errors.every(isFieldError),
  "rate-limited": (value) =>
    isNumber(value.retryAfterSeconds) &&
    (value.attempts === undefined || isAttemptStatus(value.attempts)),
  error: (value) => isString(value.message),
};

/**
 * Whether an unknown value (a parsed response body) has the complete shape of a
 * DiagnosisResponse: a known `status` and every field that status requires, with
 * the right types. It checks structure only; correctness is the server's call.
 * Extra properties are tolerated so the server can add fields without breaking
 * clients.
 */
export function isDiagnosisResponse(value: unknown): value is DiagnosisResponse {
  if (!isRecord(value) || !isString(value.status)) return false;
  if (!Object.hasOwn(SHAPES, value.status)) return false;
  return SHAPES[value.status as DiagnosisResponseStatus](value);
}
