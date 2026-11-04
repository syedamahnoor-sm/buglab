/*
 * The learner-session API as the browser sees it. These mirror the views the
 * server's session module builds field by field (its snapshots and handlers),
 * which a browser module cannot import. tests/learner-session/contract.test.ts
 * runs this client against the real handlers to keep the two in step.
 */
import type { AttemptStatus, DiagnosisFeedback } from "./diagnosis";
import type { EvidenceRef } from "./investigation";

export type LearnerState = "none" | "expired" | "active";

/** What the server shows a learner about a challenge they have completed. */
export interface SessionCompletion {
  resolution: { summary: string };
  feedback: DiagnosisFeedback;
  /** The diagnosis that completed the challenge, as the server stored it. */
  submission: {
    attempt: number;
    rootCauseId: string;
    explanation: string;
    evidence: EvidenceRef[];
  };
}

export interface ChallengeSession {
  challengeId: string;
  /** The content version the session was started at. */
  contentVersion: string;
  status: "active" | "completed";
  startedAt: string;
  completedAt?: string;
  /** The challenge changed since this unfinished session started: start it again. */
  restartRequired: boolean;
  attempts: { total: number; wrong: number; window: AttemptStatus };
  /** Present exactly when `status` is "completed". Restoring it is Phase 2. */
  completion?: SessionCompletion;
}

export interface AttemptSummary {
  seq: number;
  submittedAt: string;
  rootCauseId: string;
  result: "correct" | "incorrect";
  evidenceCount: number;
}

/** Why a request failed. `code` is the server's machine-readable reason, when it gave one. */
export type ApiErrorKind =
  | "bad-request" // 400
  | "unauthorized" // 401: no learner, or it expired
  | "forbidden" // 403: Origin / CSRF check, or a prefetch
  | "not-found" // 404: unknown challenge, or the session was never started
  | "conflict" // 409: outdated session, or an idempotency key reused for another answer
  | "payload-too-large" // 413
  | "unsupported-media-type" // 415
  | "rate-limited" // 429
  | "server" // 5xx
  | "network" // no response
  | "timeout"
  | "invalid-response" // a status or body this client does not recognise
  | "unsupported-browser";

export interface ApiError {
  kind: ApiErrorKind;
  /** The HTTP status, or null when no response arrived. */
  status: number | null;
  code: string | null;
  message: string;
  /** For 429: seconds until a retry may succeed. */
  retryAfterSeconds?: number;
}

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; error: ApiError };
