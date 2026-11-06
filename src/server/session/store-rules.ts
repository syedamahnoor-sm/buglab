/*
 * Rules every session store applies the same way, whatever it stores them in. Server-only and pure:
 * no clock, no I/O. MemoryStore and PostgresStore both import from here, so input validation, the
 * completion-result shape and the attempt-window arithmetic cannot drift between them. The store
 * contract suites then show the two behave alike.
 */
import "server-only";
import { isTokenHash } from "./token";
import {
  StoreError,
  type AttemptOutcome,
  type AttemptWindow,
  type CompletionResult,
  type DiagnosisAttemptRecord,
  type RecordAttemptInput,
  type ReserveSubmissionInput,
  type TokenHash,
  type WindowStatus,
} from "./types";

export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const MAX_SUBMISSION_ID_LENGTH = 128;
export const OUTCOMES: readonly AttemptOutcome[] = ["correct", "incorrect"];
/** How long a claim stays exclusively owned if its holder never finishes. Not an exactly-once lease. */
export const DEFAULT_CLAIM_LEASE_MS = 30_000;

const isCount = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A frozen deep copy of a completion result, or a thrown invalid-input error if it is not one. */
export function copyResult(result: unknown): CompletionResult {
  const r = result as Partial<CompletionResult> | null | undefined;
  const f = r?.feedback;
  const e = f?.evidenceSummary;
  const valid =
    typeof r === "object" && r !== null &&
    typeof r.resolutionSummary === "string" && r.resolutionSummary.length > 0 &&
    typeof f === "object" && f !== null &&
    typeof f.headline === "string" &&
    Array.isArray(f.hints) && f.hints.every((hint) => typeof hint === "string") &&
    typeof e === "object" && e !== null && isCount(e.total) && isCount(e.logs) && isCount(e.network);
  if (!valid) {
    throw new StoreError("invalid-input", "A completion result needs a resolution summary and feedback with a headline, hints and an evidence summary.");
  }
  return Object.freeze({
    resolutionSummary: r.resolutionSummary as string,
    feedback: Object.freeze({
      headline: f.headline,
      hints: Object.freeze([...f.hints]) as string[],
      evidenceSummary: Object.freeze({ total: e.total, logs: e.logs, network: e.network }),
    }),
  });
}

export function toAttempt(entry: DiagnosisAttemptRecord): DiagnosisAttemptRecord {
  return Object.freeze({
    ...entry,
    evidence: Object.freeze(entry.evidence.map((ref) => Object.freeze({ ...ref }))),
  });
}

export function toWindow(status: WindowStatus): WindowStatus {
  return Object.freeze({ ...status });
}

export function assertTokenHash(value: unknown): asserts value is TokenHash {
  if (!isTokenHash(value)) {
    throw new StoreError("invalid-input", "Expected a SHA-256 token hash (64 lowercase hex characters).");
  }
}

export function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StoreError("invalid-input", `${name} must be a non-empty string.`);
  }
}

export function assertWindow(window: AttemptWindow): void {
  if (!Number.isInteger(window?.limit) || window.limit < 1 || !Number.isFinite(window?.windowMs) || window.windowMs <= 0) {
    throw new StoreError("invalid-input", "window needs an integer limit of at least 1 and a positive windowMs.");
  }
}

/** The part of a submission both reserve() and record() check before looking at stored state. */
export function validateSubmissionIdentity(input: ReserveSubmissionInput): void {
  assertNonEmpty(input.submissionId, "submissionId");
  if (input.submissionId.length > MAX_SUBMISSION_ID_LENGTH) {
    throw new StoreError("invalid-input", "submissionId is too long.");
  }
  if (!SHA256_HEX.test(input.requestHash)) {
    throw new StoreError("invalid-input", "requestHash must be a SHA-256 hash (64 lowercase hex characters).");
  }
  assertNonEmpty(input.rootCauseId, "rootCauseId");
  if (typeof input.explanation !== "string" || !Array.isArray(input.evidence)) {
    throw new StoreError("invalid-input", "A submission needs an explanation and an evidence list.");
  }
  assertWindow(input.window);
}

/**
 * Validates the part of a RecordAttemptInput that does not depend on stored state, and returns the
 * copy of the completion result to store (undefined for an incorrect outcome). Runs after the
 * ownership and superseded checks, which come first in every store.
 */
export function validateRecordInput(input: RecordAttemptInput): CompletionResult | undefined {
  validateSubmissionIdentity(input);
  if (!OUTCOMES.includes(input.outcome)) {
    throw new StoreError("invalid-input", "outcome must be correct or incorrect.");
  }
  // A correct outcome completes the session and must say what the learner was shown. Nothing else may carry a result.
  if (input.outcome === "incorrect" && input.result !== undefined) {
    throw new StoreError("invalid-input", "Only a correct outcome carries a completion result.");
  }
  const result = input.outcome === "correct" ? copyResult(input.result) : undefined;
  return result;
}

export interface ClaimSnapshot {
  readonly requestHash: string;
  readonly expiresAt: number;
}

/**
 * The checks record() and the "already finished" half of reserve() share, in the order the
 * attempt contract promises. `accept` means a new finished attempt may be written.
 */
export type RecordedAttemptDecision =
  | { readonly kind: "duplicate" }
  | { readonly kind: "conflict" }
  | { readonly kind: "already-completed" }
  | { readonly kind: "rate-limited"; readonly retryAfterMs: number }
  | { readonly kind: "accept" };

export function decideRecordedAttempt(
  history: readonly DiagnosisAttemptRecord[],
  sessionStatus: "active" | "completed",
  input: { readonly submissionId: string; readonly requestHash: string; readonly window: AttemptWindow },
  now: number,
): RecordedAttemptDecision {
  const sameId = history.find((attempt) => attempt.submissionId === input.submissionId);
  if (sameId) return sameId.requestHash === input.requestHash ? { kind: "duplicate" } : { kind: "conflict" };
  if (sessionStatus === "completed") return { kind: "already-completed" };
  const window = windowOf(history, input.window, now);
  if (window.used >= window.limit) {
    return { kind: "rate-limited", retryAfterMs: Math.max(1, (window.resetsAt ?? now) - now) };
  }
  return { kind: "accept" };
}

/**
 * What to do with a claim once the submission is known not to be a finished attempt.
 * An expired claim is free to take. A live one blocks a second evaluation.
 */
export type ClaimDecision =
  | { readonly kind: "in-progress"; readonly expiresAt: number }
  | { readonly kind: "conflict" }
  | { readonly kind: "claim" };

export function decideClaim(
  existing: ClaimSnapshot | undefined,
  requestHash: string,
  now: number,
): ClaimDecision {
  if (!existing || existing.expiresAt <= now) return { kind: "claim" };
  if (existing.requestHash === requestHash) return { kind: "in-progress", expiresAt: existing.expiresAt };
  return { kind: "conflict" };
}

/** The incorrect attempts inside the sliding window ending at `now`. Times are milliseconds since the epoch. */
export function windowOf(attempts: readonly DiagnosisAttemptRecord[], window: AttemptWindow, now: number): WindowStatus {
  const counted = attempts.filter((attempt) => attempt.outcome === "incorrect" && attempt.createdAt > now - window.windowMs);
  if (counted.length === 0) return { used: 0, limit: window.limit };
  const oldest = Math.min(...counted.map((attempt) => attempt.createdAt));
  return { used: counted.length, limit: window.limit, resetsAt: oldest + window.windowMs };
}
