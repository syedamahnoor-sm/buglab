import type { DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";
import { createRequestAbort, UnsupportedBrowserError, type RequestAbort } from "./request-abort";
import { isDiagnosisResponse } from "./response";

const REQUEST_TIMEOUT_MS = 15_000;
const UNSUPPORTED_BROWSER_MESSAGE =
  "This browser is too old to submit a diagnosis. Please update it and try again.";

/**
 * Submits a diagnosis. Never throws, except to rethrow an abort the caller
 * requested: network, timeout, parse and unsupported-browser failures become `error`.
 */
export async function submitDiagnosis(
  challengeId: string,
  submission: DiagnosisSubmission,
  signal?: AbortSignal,
): Promise<DiagnosisResponse> {
  let request: RequestAbort | undefined;
  try {
    // One signal that ends on the caller's abort or the timeout. It does not need
    // AbortSignal.timeout or AbortSignal.any, so older browsers are supported too.
    request = createRequestAbort(REQUEST_TIMEOUT_MS, signal);
    const response = await fetch(
      `/api/challenges/${encodeURIComponent(challengeId)}/diagnosis`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
        credentials: "same-origin",
        signal: request.signal,
      },
    );
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (error) {
      // A read that was cancelled or timed out is not a bad body: let the handler below
      // classify it. Any other failure (a parse error, a dropped connection) stays "unexpected".
      if (request.signal.aborted) throw error;
    }
    if (isDiagnosisResponse(body)) return body;
    return { status: "error", message: `Unexpected response from the server (${response.status}).` };
  } catch (error) {
    if (error instanceof UnsupportedBrowserError) {
      return { status: "error", message: UNSUPPORTED_BROWSER_MESSAGE };
    }
    if (signal?.aborted) throw error;
    return {
      status: "error",
      message: request?.timedOut()
        ? "The server took too long to respond."
        : "Couldn't reach the server. Check your connection.",
    };
  } finally {
    request?.dispose();
  }
}
