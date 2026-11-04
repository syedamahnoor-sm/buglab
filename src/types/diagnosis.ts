/*
 * Diagnosis submission contract between the workspace UI and the server.
 * Client-safe: contains no answers. Designed so the Challenge Engine can
 * later own evaluation behind the same request/response shapes.
 */
import type { EvidenceRef } from "./investigation";

/** A selectable root cause. Carries no correctness information. */
export interface RootCauseOption {
  id: string;
  label: string;
  description: string;
}

/** Request body for POST /api/challenges/:challengeId/diagnosis. */
export interface DiagnosisSubmission {
  rootCauseId: string;
  explanation: string;
  evidence: EvidenceRef[];
}

export type DiagnosisField = "rootCauseId" | "explanation" | "evidence" | "body";

export interface DiagnosisFieldError {
  field: DiagnosisField;
  message: string;
}

export interface AttemptStatus {
  used: number;
  limit: number;
  remaining: number;
  /** ISO time the current attempt window ends, if one is active. */
  resetsAt?: string;
}

export interface DiagnosisFeedback {
  headline: string;
  hints: string[];
  evidenceSummary: { total: number; logs: number; network: number };
}

export type DiagnosisResponse =
  | {
      status: "correct";
      feedback: DiagnosisFeedback;
      resolution: { summary: string };
      attempts: AttemptStatus;
    }
  | { status: "incorrect"; feedback: DiagnosisFeedback; attempts: AttemptStatus }
  | { status: "invalid"; errors: DiagnosisFieldError[] }
  | { status: "rate-limited"; retryAfterSeconds: number; attempts?: AttemptStatus }
  | { status: "error"; message: string };

export type DiagnosisResponseStatus = DiagnosisResponse["status"];
