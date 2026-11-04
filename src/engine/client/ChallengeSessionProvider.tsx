"use client";

import { useMemo, useReducer, type ReactNode } from "react";
import { applyDiagnosisResponse, createProgress, progressStatus } from "../session/progress";
import type { SessionConfig } from "../types";
import { ChallengeSessionContext, type ChallengeSessionValue } from "./useChallengeSession";

interface ChallengeSessionProviderProps {
  config: SessionConfig;
  /**
   * Whether the learner has begun investigating. There is no approved source for
   * this yet, so the caller supplies it; the provider does not guess.
   */
  investigationStarted: boolean;
  children: ReactNode;
}

/** Owns the learner's engine session for one challenge. In memory only: it resets on refresh. */
export function ChallengeSessionProvider({
  config,
  investigationStarted,
  children,
}: ChallengeSessionProviderProps) {
  const [progress, recordDiagnosisResponse] = useReducer(
    applyDiagnosisResponse,
    config,
    createProgress,
  );

  const value = useMemo<ChallengeSessionValue>(
    () => ({
      session: progress.session,
      status: progressStatus(progress, investigationStarted),
      recordDiagnosisResponse,
    }),
    [progress, investigationStarted],
  );

  return <ChallengeSessionContext value={value}>{children}</ChallengeSessionContext>;
}
