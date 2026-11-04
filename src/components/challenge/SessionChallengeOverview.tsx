"use client";

import { useChallengeSession } from "@/engine/client/useChallengeSession";
import type { ChallengeSummary } from "@/types/workspace";
import { ChallengeOverview } from "./ChallengeOverview";

/** Shows the challenge overview with the learner's status taken from the engine session. */
export function SessionChallengeOverview({ challenge }: { challenge: ChallengeSummary }) {
  const { status } = useChallengeSession();
  return <ChallengeOverview challenge={challenge} status={status} />;
}
