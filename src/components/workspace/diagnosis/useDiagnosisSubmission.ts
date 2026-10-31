import { useEffect, useRef, useState } from "react";
import { submitDiagnosis } from "@/lib/diagnosis/client";
import type { DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";

export type SubmissionState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "done"; response: DiagnosisResponse; retryAt?: number };

/**
 * Client-side submission state machine. Independent of the investigation
 * controller and of any Challenge Engine state.
 */
export function useDiagnosisSubmission(challengeId: string) {
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

    try {
      const response = await submitDiagnosis(challengeId, submission, controller.signal);
      setState({
        phase: "done",
        response,
        retryAt:
          response.status === "rate-limited"
            ? Date.now() + response.retryAfterSeconds * 1000
            : undefined,
      });
    } catch {
      // Aborted because the component unmounted: nothing to update.
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  function retry() {
    if (lastSubmissionRef.current) void submit(lastSubmissionRef.current);
  }

  function reset() {
    setState({ phase: "idle" });
  }

  return { state, submit, retry, reset };
}
