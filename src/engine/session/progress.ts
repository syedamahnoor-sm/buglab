import type { DiagnosisResponse } from "@/types/diagnosis";
import type { InvestigationStatus } from "@/types/workspace";
import { diagnosisResponseToEvent, isRejectedDiagnosis } from "../adapters/diagnosis";
import type { SessionConfig, SessionState } from "../types";
import { createSession, sessionReducer } from "./reducer";
import { deriveInvestigationStatus } from "./status";

/**
 * What the learner has done in one challenge: the engine session plus the one
 * signal the session deliberately cannot hold. Plain data with pure transitions,
 * so the React provider is only a thin owner of it.
 */
export interface LearnerProgress {
  session: SessionState;
  /**
   * True once the server has rejected a diagnosis (`incorrect`). Latched: nothing
   * clears it, so revising the diagnosis form never erases it.
   */
  diagnosisSubmitted: boolean;
}

export function createProgress(config: SessionConfig): LearnerProgress {
  return { session: createSession(config), diagnosisSubmitted: false };
}

/**
 * Applies a server diagnosis response, unchanged, to the progress. Only the
 * adapter's event (a `correct` response) touches the session; only `incorrect`
 * latches `diagnosisSubmitted`. Any other response returns the same object.
 */
export function applyDiagnosisResponse(
  progress: LearnerProgress,
  response: DiagnosisResponse,
): LearnerProgress {
  const event = diagnosisResponseToEvent(response);
  const session = event ? sessionReducer(progress.session, event) : progress.session;
  const diagnosisSubmitted = progress.diagnosisSubmitted || isRejectedDiagnosis(response);

  return session === progress.session && diagnosisSubmitted === progress.diagnosisSubmitted
    ? progress
    : { session, diagnosisSubmitted };
}

export function progressStatus(
  progress: LearnerProgress,
  investigationStarted: boolean,
): InvestigationStatus {
  return deriveInvestigationStatus(progress.session, {
    investigationStarted,
    diagnosisSubmitted: progress.diagnosisSubmitted,
  });
}
