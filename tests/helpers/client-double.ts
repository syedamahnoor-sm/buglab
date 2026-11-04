/*
 * A controllable replacement for "@/lib/diagnosis/client", used only by tests that
 * exercise the submission hook on its own. A test sets what submitDiagnosis does
 * (resolve, reject, hang until aborted) and the hook then runs against it.
 */
import type { DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";

export type SubmitDiagnosis = (
  challengeId: string,
  submission: DiagnosisSubmission,
  signal?: AbortSignal,
) => Promise<DiagnosisResponse>;

let implementation: SubmitDiagnosis = async () => {
  throw new Error("submitDiagnosis double used before a test set an implementation");
};

export function setSubmitDiagnosis(next: SubmitDiagnosis): void {
  implementation = next;
}

export const submitDiagnosis: SubmitDiagnosis = (challengeId, submission, signal) =>
  implementation(challengeId, submission, signal);
