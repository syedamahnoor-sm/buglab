/*
 * The challenge registry. Server-only.
 *
 * One validated set of definitions, three separate ways in:
 *
 *   list(), getPublic()     learner-visible content only
 *   getDiagnosis()          the existing DiagnosisChallenge (validation context + answer key)
 *   contentVersion()        which version of the content this is
 *
 * `diagnosisRegistry` is the same data as a ReadonlyMap<string, DiagnosisChallenge>, which is
 * what the diagnosis handler and the learner-session service already take, so they work
 * unchanged. The private half is reachable only through getDiagnosis() and that map, both of
 * which exist only on the server.
 *
 * The registry cannot be changed once built, from outside or by accident:
 *   - the registry object is frozen, so no method can be replaced, added or removed;
 *   - `diagnosisRegistry` is a ReadOnlyMap and every Set inside the answer key and the
 *     validation context is a ReadOnlySet (read-only.ts), because freezing a Map or a Set
 *     does not stop set(), delete(), clear() or add();
 *   - every DiagnosisChallenge, answer key and key observation is frozen;
 *   - everything is built from a snapshot taken once during validation: nothing the registry
 *     holds is shared with a definition, so neither later edits to a definition nor a getter on
 *     it can reach a registry that is already built, or make it differ from what was validated.
 * This guards against a bug or a careless tool changing grading for every learner at once.
 * It is not a sandbox: code running in this process can already read the answer key.
 *
 * Building a registry validates every definition and, if there is any problem, throws one
 * ChallengeDefinitionError that lists them all. A registry that exists is one whose snapshots
 * passed every check: references resolve, and the fields have the types and values listed in
 * fields.ts. It is not a claim that the content is correct (timestamps, URLs and paths beyond
 * the malformed cases are not judged).
 */
import "server-only";
import {
  buildKeyObservations,
  validationContextFor,
  type DiagnosisChallenge,
  type DiagnosisRegistry,
} from "@/server/diagnosis/registry";
import type { ChallengeSummary, WorkspaceScenario } from "@/types/workspace";
import { ChallengeDefinitionError, type ChallengeDefinition } from "./definition";
import { toPublicChallenge } from "./public-view";
import { ReadOnlyMap, ReadOnlySet } from "./read-only";
import { reasonOf, safe } from "./text";
import { assertValidDefinitions } from "./validate";
import { contentVersionOf } from "./version";

export interface ChallengeRegistry {
  /** Public summaries, in registration order. */
  readonly list: () => readonly ChallengeSummary[];
  /** Learner-visible content, or undefined for an unknown challenge. Frozen. */
  readonly getPublic: (challengeId: string) => WorkspaceScenario | undefined;
  /** The existing diagnosis types: validation context and answer key. Server code only. Frozen. */
  readonly getDiagnosis: (challengeId: string) => DiagnosisChallenge | undefined;
  /** `<revision>+<fingerprint of the public content>`, or undefined for an unknown challenge. */
  readonly contentVersion: (challengeId: string) => string | undefined;
  /** The same diagnosis data in the shape the handler and the session service already accept. Read-only. */
  readonly diagnosisRegistry: DiagnosisRegistry;
}

/**
 * A DiagnosisChallenge that nothing can change: frozen objects and read-only collections,
 * all built from copies. This is the only place the private half is assembled.
 */
function sealDiagnosisChallenge(
  challengeId: string,
  validation: ReturnType<typeof validationContextFor>,
  definition: ChallengeDefinition,
): DiagnosisChallenge {
  const { evaluation } = definition;
  return Object.freeze({
    challengeId,
    validation: Object.freeze({
      rootCauseIds: new ReadOnlySet(validation.rootCauseIds),
      logIds: new ReadOnlySet(validation.logIds),
      requestIds: new ReadOnlySet(validation.requestIds),
    }),
    answerKey: Object.freeze({
      correctRootCauseId: evaluation.correctRootCauseId,
      resolutionSummary: evaluation.resolutionSummary,
      keyObservations: Object.freeze(
        buildKeyObservations(evaluation.keyObservations, validation).map((observation) =>
          Object.freeze({ id: observation.id, evidenceIds: new ReadOnlySet(observation.evidenceIds) }),
        ),
      ),
    }),
  });
}

/**
 * `origins` optionally names where each definition came from (the loader passes the source
 * names), so a validation error can say which source a problem is in.
 */
export function createChallengeRegistry(
  definitions: readonly ChallengeDefinition[],
  origins: readonly (string | undefined)[] = [],
): ChallengeRegistry {
  // Validation snapshots every definition once and returns the snapshots. Everything below is built
  // from them and never from `definitions`, so what was validated is exactly what is published and graded.
  const snapshots = assertValidDefinitions(definitions, origins);

  const publicById = new Map<string, WorkspaceScenario>();
  const versions = new Map<string, string>();
  const diagnosis = new Map<string, DiagnosisChallenge>();

  // Validation has passed, so none of this should fail. If a case it did not anticipate does,
  // it is still reported as a definition error that names the challenge, never a raw TypeError.
  let building = "a definition";
  try {
    for (const definition of snapshots) {
      building = definition.scenario.challenge.id;
      const publicChallenge = toPublicChallenge(definition.scenario);
      const id = publicChallenge.challenge.id;

      publicById.set(id, publicChallenge);
      versions.set(id, contentVersionOf(definition.revision, publicChallenge));
      diagnosis.set(id, sealDiagnosisChallenge(id, validationContextFor(publicChallenge), definition));
    }
  } catch (error) {
    if (error instanceof ChallengeDefinitionError) throw error;
    throw new ChallengeDefinitionError([`${safe(building)}: could not be built: ${reasonOf(error)}`]);
  }

  const summaries = Object.freeze([...publicById.values()].map((scenario) => scenario.challenge));
  // A copy, so the Map built above is not reachable from anywhere once this function returns.
  const diagnosisRegistry = new ReadOnlyMap(diagnosis);

  return Object.freeze({
    list: () => summaries,
    getPublic: (challengeId: string) => publicById.get(challengeId),
    getDiagnosis: (challengeId: string) => diagnosisRegistry.get(challengeId),
    contentVersion: (challengeId: string) => versions.get(challengeId),
    diagnosisRegistry,
  });
}
