import type { ChallengeSummary } from "@/types/workspace";
import type { SessionConfig } from "../types";

/** The session config for a challenge, from its static metadata alone. */
export function sessionConfigForChallenge(challenge: ChallengeSummary): SessionConfig {
  switch (challenge.completion) {
    case "diagnosis":
      return { challengeId: challenge.id, completion: "diagnosis" };
    case "fix":
      // Fix Mode needs editable files and a runner, which do not exist yet.
      throw new Error(`Challenge ${challenge.id}: Fix Mode is not implemented`);
  }
}
