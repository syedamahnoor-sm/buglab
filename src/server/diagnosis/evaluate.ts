/*
 * Compares a validated submission with the answer key. Server-only.
 *
 * Incorrect feedback is deliberately generic: it is identical for every
 * wrong option and depends only on the learner's own input, so it never
 * narrows down or confirms the correct answer.
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

export function evaluateDiagnosis(
  submission: DiagnosisSubmission,
  answerKey: DiagnosisAnswerKey,
): EvaluationResult {
  const evidenceSummary = summarizeEvidence(submission);

  if (submission.rootCauseId !== answerKey.correctRootCauseId) {
    const hints = [...GENERIC_HINTS];
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
      status: "incorrect",
      feedback: {
        headline: "That diagnosis doesn't match what the evidence shows.",
        hints,
        evidenceSummary,
      },
    };
  }

  const keyCovered = submission.evidence.filter((ref) =>
    answerKey.keyEvidenceIds.has(getEvidenceId(ref)),
  ).length;

  return {
    status: "correct",
    feedback: {
      headline: "Diagnosis confirmed.",
      hints: [
        `Your evidence included ${keyCovered} of ${answerKey.keyEvidenceIds.size} key observations.`,
        "Completion and scoring will be recorded by the Challenge Engine in a later stage.",
      ],
      evidenceSummary,
    },
    resolution: { summary: answerKey.resolutionSummary },
  };
}
