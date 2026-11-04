/*
 * What a learner may see about their own session and attempts. Server-only.
 *
 * Every view is built field by field, never by copying a record, so a field added
 * to a record later cannot reach a response by accident. A view carries no
 * internal id, no learner id, no token or hash and no request hash.
 *
 * The one place answer-key-derived text can appear is `completion`, and it appears only on a
 * completed session. It is what the diagnosis response already gave the learner when they solved the
 * challenge (the resolution summary and the feedback), stored with the session and replayed
 * from there, plus the diagnosis they submitted, so a refresh can restore the finished workspace.
 * Nothing here is computed from the current answer key, so a later correction to the key cannot
 * change a completed result, and an unfinished session never carries any of it.
 */
import "server-only";
import type { AttemptStatus, DiagnosisFeedback } from "@/types/diagnosis";
import type { EvidenceRef } from "@/types/investigation";
import type { ChallengeSessionRecord, DiagnosisAttemptRecord, WindowStatus } from "./types";

/** The existing diagnosis contract's window shape, with the reset time as an ISO string. */
export function toAttemptStatus(window: WindowStatus): AttemptStatus {
  return {
    used: window.used,
    limit: window.limit,
    remaining: Math.max(0, window.limit - window.used),
    ...(window.resetsAt === undefined ? {} : { resetsAt: new Date(window.resetsAt).toISOString() }),
  };
}

/** Everything the workspace needs to show a finished challenge again after a refresh. */
export interface CompletionView {
  /** The explanation shown after a correct diagnosis. */
  resolution: { summary: string };
  /** The feedback shown with it, exactly as it was when the learner solved the challenge. */
  feedback: DiagnosisFeedback;
  /** The diagnosis that completed the challenge. `evidence` is the references the learner submitted. */
  submission: {
    /** Which attempt it was: the first is 1. */
    attempt: number;
    rootCauseId: string;
    explanation: string;
    evidence: EvidenceRef[];
  };
}

export interface ChallengeSessionView {
  challengeId: string;
  /** The content version this session was started at: `<revision>+<public content hash>`. */
  contentVersion: string;
  /** Decided by the server, from a correct attempt it evaluated. Nothing a client sends can set it. */
  status: "active" | "completed";
  startedAt: string;
  /** When the server recorded the correct attempt. Present exactly when `status` is `completed`. */
  completedAt?: string;
  /**
   * True when the challenge has changed since this UNFINISHED session started. The session accepts no
   * more attempts: start the challenge again to begin at the new version. Always false once completed.
   */
  restartRequired: boolean;
  attempts: {
    total: number;
    wrong: number;
    window: AttemptStatus;
  };
  /** Present exactly when `status` is `completed`. */
  completion?: CompletionView;
}

function toEvidenceRef(ref: EvidenceRef): EvidenceRef {
  return ref.kind === "log" ? { kind: "log", logId: ref.logId } : { kind: "network", requestId: ref.requestId };
}

/** The completion of a completed session, from its stored result and the correct attempt. Never from the answer key. */
export function toCompletionView(session: ChallengeSessionRecord, correct: DiagnosisAttemptRecord): CompletionView {
  const { result } = session;
  if (!result) throw new Error("A completed session has no stored result.");
  return {
    resolution: { summary: result.resolutionSummary },
    feedback: {
      headline: result.feedback.headline,
      hints: [...result.feedback.hints],
      evidenceSummary: {
        total: result.feedback.evidenceSummary.total,
        logs: result.feedback.evidenceSummary.logs,
        network: result.feedback.evidenceSummary.network,
      },
    },
    submission: {
      attempt: correct.seq,
      rootCauseId: correct.rootCauseId,
      explanation: correct.explanation,
      evidence: correct.evidence.map(toEvidenceRef),
    },
  };
}

export function toSessionView(
  session: ChallengeSessionRecord,
  window: WindowStatus,
  options: { restartRequired: boolean; correctAttempt?: DiagnosisAttemptRecord },
): ChallengeSessionView {
  const completed = session.status === "completed";
  if (completed && !options.correctAttempt) throw new Error("A completed session has no correct attempt.");
  return {
    challengeId: session.challengeId,
    contentVersion: session.challengeVersion,
    status: session.status,
    startedAt: new Date(session.createdAt).toISOString(),
    ...(session.completedAt === undefined ? {} : { completedAt: new Date(session.completedAt).toISOString() }),
    restartRequired: completed ? false : options.restartRequired,
    attempts: {
      total: session.attemptCount,
      wrong: session.wrongAttempts,
      window: toAttemptStatus(window),
    },
    ...(completed && options.correctAttempt ? { completion: toCompletionView(session, options.correctAttempt) } : {}),
  };
}

export interface AttemptView {
  seq: number;
  submittedAt: string;
  rootCauseId: string;
  result: "correct" | "incorrect";
  evidenceCount: number;
}

export function toAttemptView(attempt: DiagnosisAttemptRecord): AttemptView {
  return {
    seq: attempt.seq,
    submittedAt: new Date(attempt.createdAt).toISOString(),
    rootCauseId: attempt.rootCauseId,
    result: attempt.outcome,
    evidenceCount: attempt.evidence.length,
  };
}
