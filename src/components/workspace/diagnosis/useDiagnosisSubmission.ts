import { useEffect, useRef, useState } from "react";
import { submitDiagnosis } from "@/lib/diagnosis/client";
import type { DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";

export type SubmissionState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "done"; response: DiagnosisResponse; retryAt?: number };

const UNEXPECTED_FAILURE_MESSAGE =
  "Something went wrong while submitting your diagnosis. Please try again.";

/**
 * Client-side submission state machine. Independent of the investigation
 * controller. It holds no Challenge Engine state: it only reports each server
 * response, unchanged, through `onResponse` (which should be stable).
 */
export function useDiagnosisSubmission(
  challengeId: string,
  onResponse?: (response: DiagnosisResponse) => void,
) {
  const [state, setState] = useState<SubmissionState>({ phase: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const lastSubmissionRef = useRef<DiagnosisSubmission | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function submit(submission: DiagnosisSubmission) {
    if (controllerRef.current) return; // a request is already in flight
    const controller = new AbortController();
    controllerRef.current = controller;
    lastSubmissionRef.current = submission;
    setState({ phase: "submitting" });

    let response: DiagnosisResponse | null = null;
    try {
      response = await submitDiagnosis(challengeId, submission, controller.signal);
    } catch (error) {
      // An abort is the component unmounting: nothing to update or report. Anything
      // else is a real failure. Surface it so the form never stays on "submitting".
      if (!controller.signal.aborted) {
        console.error("Diagnosis submission failed unexpectedly", error);
        response = { status: "error", message: UNEXPECTED_FAILURE_MESSAGE };
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
    // Unmounted while the request was in flight: drop even a late result.
    if (controller.signal.aborted || !response) return;

    setState({
      phase: "done",
      response,
      retryAt:
        response.status === "rate-limited"
          ? Date.now() + response.retryAfterSeconds * 1000
          : undefined,
    });
    onResponse?.(response);
  }

  function retry() {
    if (lastSubmissionRef.current) void submit(lastSubmissionRef.current);
  }

  function reset() {
    setState({ phase: "idle" });
  }

  return { state, submit, retry, reset };
}
