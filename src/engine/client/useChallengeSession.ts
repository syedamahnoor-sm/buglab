import { createContext, useContext } from "react";
import type { DiagnosisResponse } from "@/types/diagnosis";
import type { InvestigationStatus } from "@/types/workspace";
import type { SessionState } from "../types";

export interface ChallengeSessionValue {
  session: SessionState;
  /** The learner's status, derived from the session and workspace signals. */
  status: InvestigationStatus;
  /** Reports a server diagnosis response, unchanged. Stable across renders. */
  recordDiagnosisResponse: (response: DiagnosisResponse) => void;
}

export const ChallengeSessionContext = createContext<ChallengeSessionValue | null>(null);

export function useChallengeSession(): ChallengeSessionValue {
  const value = useContext(ChallengeSessionContext);
  if (!value) throw new Error("useChallengeSession must be used inside ChallengeSessionProvider");
  return value;
}
