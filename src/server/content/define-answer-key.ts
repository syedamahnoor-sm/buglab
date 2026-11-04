/*
 * The authoring format for answer keys. Server-only.
 *
 * An answer key is written next to its scenario as answer-key.server.ts and
 * registered in ./index.ts. It names evidence by position (log 4, request 2),
 * the same numbering defineChallenge uses, and is checked against the scenario
 * here, so a key that points at evidence the scenario does not have, or at an
 * option it does not offer, fails as soon as the server loads it.
 *
 * Nothing here is public. The scenario it is given is, but the key is only
 * ever read by the diagnosis registry and the challenge registry.
 */
import "server-only";
import { logId, requestId } from "@/lib/authoring/define-challenge";
import type { CatalogEntry } from "@/types/catalog";
import type { EvidenceRef } from "@/types/investigation";
import type { WorkspaceScenario } from "@/types/workspace";

export interface ObservationSpec {
  id: string;
  /** Why this evidence matters. Documentation for authors and reviewers; never sent anywhere. */
  why: string;
  /** 1-based log line positions. */
  logs?: number[];
  /** 1-based network request positions. */
  requests?: number[];
}

export interface AnswerKeySpec {
  /** Bump by hand whenever anything below changes; see tests/challenges/revision-pin.test.ts. */
  revision: string;
  correctRootCauseId: string;
  /** Shown to the learner only after a correct diagnosis. */
  resolutionSummary: string;
  observations: ObservationSpec[];
  /**
   * Shown after any incorrect diagnosis, identical for every wrong option, so
   * they point at how to investigate this incident, never at the answer.
   */
  investigationHints: string[];
}

/** An authored challenge as the server holds it: the public scenario, its private evaluation and its revision. */
export interface AuthoredChallenge {
  readonly scenario: WorkspaceScenario;
  readonly revision: string;
  readonly evaluation: {
    readonly correctRootCauseId: string;
    readonly resolutionSummary: string;
    readonly keyObservations: readonly { readonly id: string; readonly refs: readonly EvidenceRef[] }[];
  };
  readonly investigationHints: readonly string[];
}

export function defineAnswerKey({ scenario }: CatalogEntry, spec: AnswerKeySpec): AuthoredChallenge {
  const id = scenario.challenge.id;
  const problems: string[] = [];
  const logIds = new Set(scenario.logs.map((entry) => entry.id));
  const requestIds = new Set(scenario.network.map((request) => request.id));

  if (!scenario.rootCauseOptions.some((option) => option.id === spec.correctRootCauseId)) {
    problems.push("the correct root cause is not one of the options");
  }
  if (spec.observations.length === 0) problems.push("there are no key observations");
  if (spec.investigationHints.length === 0) problems.push("there are no investigation hints");

  const keyObservations = spec.observations.map((observation) => {
    const refs: EvidenceRef[] = [
      ...(observation.logs ?? []).map((n): EvidenceRef => ({ kind: "log", logId: logId(n) })),
      ...(observation.requests ?? []).map((n): EvidenceRef => ({ kind: "network", requestId: requestId(n) })),
    ];
    if (refs.length === 0) problems.push(`observation "${observation.id}" has no evidence`);
    for (const ref of refs) {
      const known = ref.kind === "log" ? logIds.has(ref.logId) : requestIds.has(ref.requestId);
      if (!known) problems.push(`observation "${observation.id}" refers to ${ref.kind === "log" ? ref.logId : ref.requestId}, which does not exist`);
    }
    return { id: observation.id, refs };
  });

  if (problems.length > 0) throw new Error(`Answer key for ${id} is invalid:\n  - ${problems.join("\n  - ")}`);

  return {
    scenario,
    revision: spec.revision,
    evaluation: {
      correctRootCauseId: spec.correctRootCauseId,
      resolutionSummary: spec.resolutionSummary,
      keyObservations,
    },
    investigationHints: spec.investigationHints,
  };
}
