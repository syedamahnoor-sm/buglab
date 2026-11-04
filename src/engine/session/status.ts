import type { InvestigationStatus } from "@/types/workspace";
import type { SessionState } from "../types";

/**
 * Progress the engine session cannot see. Both come from the workspace and
 * must be sticky (once true they stay true for the page session).
 */
export interface WorkspaceSignals {
  /** The learner has begun investigating. No reliable source for this exists yet. */
  investigationStarted: boolean;
  /** The server rejected a diagnosis (`isRejectedDiagnosis`: an `incorrect` response). */
  diagnosisSubmitted: boolean;
}

/**
 * The learner's status for a challenge. `resolved` comes from the engine
 * session; the other states come from workspace signals, because incorrect
 * submissions deliberately never change the session.
 */
export function deriveInvestigationStatus(
  session: Pick<SessionState, "status" | "diagnosed">,
  signals: WorkspaceSignals,
): InvestigationStatus {
  if (session.status === "solved" && session.diagnosed) return "resolved";
  if (signals.diagnosisSubmitted) return "submitted";
  if (signals.investigationStarted) return "in-progress";
  return "not-started";
}
