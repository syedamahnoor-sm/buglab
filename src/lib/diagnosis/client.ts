import type { DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";
import { isDiagnosisResponse } from "./response";

const REQUEST_TIMEOUT_MS = 15_000;
const UNSUPPORTED_BROWSER_MESSAGE =
  "This browser is too old to submit a diagnosis. Please update it and try again.";

/** The browser lacks an abort API that submitDiagnosis needs. Never leaves this module. */
class UnsupportedBrowserError extends Error {}

/**
 * Submits a diagnosis. Never throws, except to rethrow an abort the caller
 * requested: network, timeout, parse and unsupported-browser failures become `error`.
 */
export async function submitDiagnosis(
  challengeId: string,
  submission: DiagnosisSubmission,
  signal?: AbortSignal,
): Promise<DiagnosisResponse> {
  let timeout: AbortSignal | undefined;
  try {
    // AbortSignal.timeout and AbortSignal.any are missing from older browsers, where
    // calling them throws a TypeError. Without them the request would have no timeout
    // (or the caller's abort could not be combined with it), so refuse to send it.
    if (typeof AbortSignal.timeout !== "function" || (signal && typeof AbortSignal.any !== "function")) {
      throw new UnsupportedBrowserError();
    }
    timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
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
    if (error instanceof UnsupportedBrowserError) {
      return { status: "error", message: UNSUPPORTED_BROWSER_MESSAGE };
    }
    if (signal?.aborted) throw error;
    return {
      status: "error",
      message: timeout?.aborted
        ? "The server took too long to respond."
        : "Couldn't reach the server. Check your connection.",
    };
  }
}
