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
import { AUTHORED_CHALLENGES } from "@/server/content";
import type { EvidenceRef } from "@/types/investigation";
import type { WorkspaceScenario } from "@/types/workspace";

export interface KeyObservation {
  id: string;
  /** Equivalent evidence, in getEvidenceId() form, e.g. "network:req-04". */
  evidenceIds: ReadonlySet<string>;
}

export interface DiagnosisAnswerKey {
  correctRootCauseId: string;
  resolutionSummary: string;
  keyObservations: readonly KeyObservation[];
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

/**
 * Builds key-observation groups, failing fast if any evidence ID is unknown
 * to the scenario or belongs to more than one group.
 */
export function buildKeyObservations(
  groups: readonly { id: string; refs: readonly EvidenceRef[] }[],
  validation: DiagnosisValidationContext,
): KeyObservation[] {
  const owner = new Map<string, string>();
  return groups.map((group) => {
    const evidenceIds = new Set<string>();
    for (const ref of group.refs) {
      const exists =
        ref.kind === "log" ? validation.logIds.has(ref.logId) : validation.requestIds.has(ref.requestId);
      const evidenceId = getEvidenceId(ref);
      if (!exists) throw new Error(`Key observation "${group.id}" refers to unknown evidence ${evidenceId}`);
      const previous = owner.get(evidenceId);
      if (previous) {
        throw new Error(`Evidence ${evidenceId} is in both "${previous}" and "${group.id}"`);
      }
      owner.set(evidenceId, group.id);
      evidenceIds.add(evidenceId);
    }
    return { id: group.id, evidenceIds };
  });
}

export function createDefaultRegistry(): DiagnosisRegistry {
  const validation = validationContextFor(challenge001);
  if (!validation.rootCauseIds.has(provisionalAnswerKey.correctRootCauseId)) {
    throw new Error("challenge-001 answer key does not match its root-cause options");
  }
  const keyObservations = buildKeyObservations(provisionalAnswerKey.keyObservations, validation);

  const registry = new Map<string, DiagnosisChallenge>([
    [
      challenge001.challenge.id,
      {
        challengeId: challenge001.challenge.id,
        validation,
        answerKey: {
          correctRootCauseId: provisionalAnswerKey.correctRootCauseId,
          resolutionSummary: provisionalAnswerKey.resolutionSummary,
          keyObservations,
        },
      },
    ],
  ]);

  // Every challenge authored with src/server/content, checked the same way.
  for (const authored of AUTHORED_CHALLENGES) {
    const challengeId = authored.scenario.challenge.id;
    if (registry.has(challengeId)) throw new Error(`${challengeId} is registered twice`);
    const context = validationContextFor(authored.scenario);
    if (!context.rootCauseIds.has(authored.evaluation.correctRootCauseId)) {
      throw new Error(`${challengeId} answer key does not match its root-cause options`);
    }
    registry.set(challengeId, {
      challengeId,
      validation: context,
      answerKey: {
        correctRootCauseId: authored.evaluation.correctRootCauseId,
        resolutionSummary: authored.evaluation.resolutionSummary,
        keyObservations: buildKeyObservations(authored.evaluation.keyObservations, context),
      },
    });
  }
  return registry;
}
