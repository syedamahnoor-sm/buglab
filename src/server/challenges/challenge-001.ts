/*
 * Adapts the existing Challenge 001 modules into a ChallengeDefinition. Server-only.
 *
 * Nothing is copied: `scenario` IS the existing public scenario and `evaluation` is
 * read from the existing answer key. The data stays where it is, and the files that
 * own it are unchanged.
 */
import "server-only";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import type { ChallengeDefinition } from "./definition";
import { staticChallengeSource } from "./loader";

/** Bump when the provisional answer key changes in a way the public content does not show. */
const CHALLENGE_001_REVISION = "1";

export const challenge001Definition: ChallengeDefinition = {
  scenario: challenge001,
  evaluation: {
    correctRootCauseId: provisionalAnswerKey.correctRootCauseId,
    resolutionSummary: provisionalAnswerKey.resolutionSummary,
    keyObservations: provisionalAnswerKey.keyObservations.map((observation) => ({
      id: observation.id,
      refs: observation.refs,
    })),
  },
  revision: CHALLENGE_001_REVISION,
};

export const challenge001Source = staticChallengeSource("challenge-001", [challenge001Definition]);
