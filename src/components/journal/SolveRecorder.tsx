"use client";

import { useEffect } from "react";
import { learningActions } from "./useLearning";

/*
 * Records an observed solve when a server-confirmed correct diagnosis is shown.
 * Rendered only in the correct branch of the diagnosis result, so an incorrect,
 * rejected or failed submission never records one.
 *
 * Each confirmation is recorded exactly once, keyed by the response object
 * itself: re-rendering, collapsing and expanding the panel, or React's
 * development double-invocation cannot record it twice. A new correct
 * submission is a new response and is recorded as another solve.
 */
const recorded = new WeakSet<object>();

export function SolveRecorder({ challengeId, confirmation }: { challengeId: string; confirmation: object }) {
  useEffect(() => {
    if (recorded.has(confirmation)) return;
    recorded.add(confirmation);
    learningActions.recordSolve(challengeId);
  }, [challengeId, confirmation]);
  return null;
}
