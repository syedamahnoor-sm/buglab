import { isDiagnosisResponse } from "@/lib/diagnosis/response";
import type { DiagnosisResponse } from "@/types/diagnosis";
import type { SessionEvent } from "../types";

/**
 * Maps a diagnosis API response to the session event it implies, or null when
 * the session should not change. The server is the only judge of correctness,
 * attempts and rate limits; this reads the response status only. The static
 * type is not a runtime guarantee, so a value that is not structurally a
 * complete DiagnosisResponse is treated as no response at all.
 */
export function diagnosisResponseToEvent(
  response: DiagnosisResponse,
): SessionEvent | null {
  if (!isDiagnosisResponse(response)) return null;

  switch (response.status) {
    case "correct":
      return { type: "DIAGNOSIS_ACCEPTED" };
    case "incorrect":
    case "invalid":
    case "rate-limited":
    case "error":
      return null;
    default: {
      // A status added to DiagnosisResponse fails to compile here. At runtime
      // an unknown status fails closed: it never completes the session.
      const unreachable: never = response;
      void unreachable;
      return null;
    }
  }
}

/**
 * Whether the server judged the diagnosis and rejected it: only `incorrect`.
 * This is what makes a learner's status `submitted`. `correct` is accepted, and
 * `invalid`, `rate-limited` and `error` were never judged, so none of them is a
 * rejected submission (or a wrong attempt). A malformed response is never one.
 */
export function isRejectedDiagnosis(response: DiagnosisResponse): boolean {
  if (!isDiagnosisResponse(response)) return false;

  switch (response.status) {
    case "incorrect":
      return true;
    case "correct":
    case "invalid":
    case "rate-limited":
    case "error":
      return false;
    default: {
      const unreachable: never = response;
      void unreachable;
      return false;
    }
  }
}
