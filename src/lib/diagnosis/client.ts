import type { DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";
import { isDiagnosisResponse } from "./response";

const REQUEST_TIMEOUT_MS = 15_000;

/** Submits a diagnosis. Never throws: network and parse failures become `error`. */
export async function submitDiagnosis(
  challengeId: string,
  submission: DiagnosisSubmission,
  signal?: AbortSignal,
): Promise<DiagnosisResponse> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const response = await fetch(
      `/api/challenges/${encodeURIComponent(challengeId)}/diagnosis`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
        credentials: "same-origin",
        signal: combined,
      },
    );
    const body: unknown = await response.json().catch(() => null);
    if (isDiagnosisResponse(body)) return body;
    return { status: "error", message: `Unexpected response from the server (${response.status}).` };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      status: "error",
      message: timeout.aborted
        ? "The server took too long to respond."
        : "Couldn't reach the server. Check your connection.",
    };
  }
}
