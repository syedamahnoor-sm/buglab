"use client";

/*
 * The learner's journey through one challenge, in memory only.
 *
 * Wraps the engine's ChallengeSessionProvider and gives it the one signal only
 * the workspace can see: whether the learner has started investigating (added
 * evidence, a hypothesis or an observation). It also carries the links shown
 * once a diagnosis is confirmed. Nothing here is stored: a refresh starts over.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ChallengeSessionProvider } from "@/engine/client/ChallengeSessionProvider";
import { sessionConfigForChallenge } from "@/engine/session/config";
import type { ChallengeSummary } from "@/types/workspace";

export interface ChallengeLink {
  href: string;
  number: string;
  title: string;
}

interface ChallengeJourneyValue {
  libraryHref: string;
  /** The next published challenge in catalog order, or null after the last one. */
  next: ChallengeLink | null;
  markInvestigationStarted: () => void;
}

const ChallengeJourneyContext = createContext<ChallengeJourneyValue | null>(null);

interface ChallengeJourneyProps {
  challenge: ChallengeSummary;
  libraryHref: string;
  next: ChallengeLink | null;
  children: ReactNode;
}

export function ChallengeJourney({ challenge, libraryHref, next, children }: ChallengeJourneyProps) {
  // Sticky for the page session: once started, it stays started.
  const [investigationStarted, setInvestigationStarted] = useState(false);
  const markInvestigationStarted = useCallback(() => setInvestigationStarted(true), []);
  const config = useMemo(() => sessionConfigForChallenge(challenge), [challenge]);
  const value = useMemo(() => ({ libraryHref, next, markInvestigationStarted }), [libraryHref, next, markInvestigationStarted]);

  return (
    <ChallengeJourneyContext value={value}>
      <ChallengeSessionProvider config={config} investigationStarted={investigationStarted}>
        {children}
      </ChallengeSessionProvider>
    </ChallengeJourneyContext>
  );
}

/**
 * Whether the learner has started investigating: they have recorded evidence, a
 * hypothesis or an observation. Opening files or reading logs does not count.
 */
export function hasRecordedWork(investigation: {
  evidence: readonly unknown[];
  hypotheses: readonly unknown[];
  observations: readonly unknown[];
}): boolean {
  return investigation.evidence.length + investigation.hypotheses.length + investigation.observations.length > 0;
}

/** The journey around the current challenge, or null outside one (for example in isolated component tests). */
export function useChallengeJourney(): ChallengeJourneyValue | null {
  return useContext(ChallengeJourneyContext);
}
