/*
 * Deterministic comparison of a validated submission with the answer key. Server-only.
 *
 * Call sites should prefer DiagnosisEvaluator (evaluator.ts). This module remains the
 * pure core behind DeterministicDiagnosisEvaluator so existing unit tests and grading
 * semantics stay stable.
 *
 * Incorrect feedback is deliberately generic: it is identical for every
 * wrong option and depends only on the challenge and the learner's own input,
 * so it never narrows down or confirms the correct answer. A challenge may
 * replace the generic hints with its own investigation hints, which follow
 * the same rule. The learner's explanation is stored elsewhere but is not scored here.
 */
import "server-only";
import { getEvidenceId } from "@/lib/evidence";
import type { DiagnosisFeedback, DiagnosisSubmission } from "@/types/diagnosis";
import type { DiagnosisAnswerKey } from "./registry";

export type EvaluationResult =
  | { status: "correct"; feedback: DiagnosisFeedback; resolution: { summary: string } }
  | { status: "incorrect"; feedback: DiagnosisFeedback };

const GENERIC_HINTS = [
  "Trace one failing request end to end: what the browser sends, what the server receives, and where the server decides to reject it.",
  "Check each claim in your explanation against a specific log line, header, or line of code.",
];

function summarizeEvidence(submission: DiagnosisSubmission) {
  const logs = submission.evidence.filter((ref) => ref.kind === "log").length;
  return { total: submission.evidence.length, logs, network: submission.evidence.length - logs };
}

/**
 * Incorrect feedback from the learner's own submission and the challenge's public hints.
 * It does not take an answer key: a stored incorrect attempt can be replayed through this
 * without judging the root cause again.
 */
export function incorrectDiagnosisFeedback(
  submission: DiagnosisSubmission,
  investigationHints?: readonly string[],
): DiagnosisFeedback {
  const evidenceSummary = summarizeEvidence(submission);
  const hints = [...(investigationHints ?? GENERIC_HINTS)];
  if (evidenceSummary.network === 0) {
    hints.push(
      "All of your evidence comes from server logs. The Network tab shows what the browser actually sent and received.",
    );
  } else if (evidenceSummary.logs === 0) {
    hints.push(
      "All of your evidence comes from the Network tab. The server logs show how the server interpreted each request.",
    );
  }
  return {
    headline: "That diagnosis doesn't match what the evidence shows.",
    hints,
    evidenceSummary,
  };
}

export function evaluateDiagnosis(
  submission: DiagnosisSubmission,
  answerKey: DiagnosisAnswerKey,
  /** The challenge's own investigation hints, used instead of the generic ones when given. */
  investigationHints?: readonly string[],
): EvaluationResult {
  const evidenceSummary = summarizeEvidence(submission);

  if (submission.rootCauseId !== answerKey.correctRootCauseId) {
    return { status: "incorrect", feedback: incorrectDiagnosisFeedback(submission, investigationHints) };
  }

  // Each observation counts once, however many equivalent items show it.
  const submittedIds = new Set(submission.evidence.map(getEvidenceId));
  const covered = answerKey.keyObservations.filter((observation) =>
    [...observation.evidenceIds].some((id) => submittedIds.has(id)),
  ).length;

  return {
    status: "correct",
    feedback: {
      headline: "Diagnosis confirmed.",
      hints: [
        `Your evidence covered ${covered} of ${answerKey.keyObservations.length} key observations for this incident.`,
        "Completion and scoring will be recorded by the Challenge Engine in a later stage.",
      ],
      evidenceSummary,
    },
    resolution: { summary: answerKey.resolutionSummary },
  };
}
