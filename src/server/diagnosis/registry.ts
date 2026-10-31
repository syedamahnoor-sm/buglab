/*
 * Server-side registry of challenges that accept diagnosis submissions.
 * This is the integration seam for the Challenge Engine: it can replace this
 * registry (answer keys and validation context) without touching the UI.
 */
import "server-only";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import type { DiagnosisValidationContext } from "@/lib/diagnosis/validate";
import { getEvidenceId } from "@/lib/evidence";
import type { WorkspaceScenario } from "@/types/workspace";

export interface DiagnosisAnswerKey {
  correctRootCauseId: string;
  resolutionSummary: string;
  /** Evidence IDs in getEvidenceId() form, e.g. "network:req-04". */
  keyEvidenceIds: ReadonlySet<string>;
}

export interface DiagnosisChallenge {
  challengeId: string;
  validation: DiagnosisValidationContext;
  answerKey: DiagnosisAnswerKey;
}

export type DiagnosisRegistry = ReadonlyMap<string, DiagnosisChallenge>;

export function validationContextFor(scenario: WorkspaceScenario): DiagnosisValidationContext {
  return {
    rootCauseIds: new Set(scenario.rootCauseOptions.map((option) => option.id)),
    logIds: new Set(scenario.logs.map((entry) => entry.id)),
    requestIds: new Set(scenario.network.map((request) => request.id)),
  };
}

export function createDefaultRegistry(): DiagnosisRegistry {
  const validation = validationContextFor(challenge001);
  if (!validation.rootCauseIds.has(provisionalAnswerKey.correctRootCauseId)) {
    throw new Error("challenge-001 answer key does not match its root-cause options");
  }

  return new Map([
    [
      challenge001.challenge.id,
      {
        challengeId: challenge001.challenge.id,
        validation,
        answerKey: {
          correctRootCauseId: provisionalAnswerKey.correctRootCauseId,
          resolutionSummary: provisionalAnswerKey.resolutionSummary,
          keyEvidenceIds: new Set(provisionalAnswerKey.keyEvidenceRefs.map(getEvidenceId)),
        },
      },
    ],
  ]);
}
