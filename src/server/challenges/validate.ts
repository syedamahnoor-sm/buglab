/*
 * Startup validation of challenge definitions. Server-only.
 *
 * Every definition is first copied, once, into a SNAPSHOT of plain data (plain-data.ts): getters,
 * proxies, class instances and other non-plain values are refused, and nothing reads the original
 * again. Everything after that, the checks here and the registry built from the result, uses only
 * the snapshot, so a definition cannot show one value to the validator and another to the registry.
 *
 * Then three passes over the snapshot. The SHAPE (structure.ts): are the lists lists and the
 * ids strings. The FIELDS (fields.ts): the primitive type, blankness, closed set and numeric
 * range of each field the existing types define. And, only if the shape is sound, the MEANING:
 * unique ids, references that resolve, a supported contract version, a valid challenge id and
 * revision. Whatever is wrong, the result is a ChallengeDefinitionError, never a raw TypeError,
 * whatever was passed in.
 *
 * It reports every problem it finds at once (up to a limit, so one broken definition cannot
 * flood a log), so an author fixes a definition in one pass, and the registry refuses to exist
 * until there are none. A message names ids, paths and sources. Values an author typed are
 * quoted through text.ts: one line, bounded, control characters escaped. A message may name a
 * private key-observation id (an author needs it to fix the definition) but never the correct
 * root cause or the resolution text. A message is for the server log: it is never sent to a client.
 *
 * Across definitions it also requires challenge numbers to be unique (Syeda's decision).
 *
 * Not checked, each by Syeda's decision (fields.ts lists them and the foundation doc, section 8.7,
 * explains them): request URL and path formats, unexpected properties (ignored, never published or
 * graded), languages, Windows reserved file names, log ordering and request durations against log text.
 */
import "server-only";
import { types } from "node:util";
import { getEvidenceId } from "@/lib/evidence";
import {
  CHALLENGE_ID_MAX_LENGTH,
  ChallengeDefinitionError,
  REVISION_MAX_LENGTH,
  SUPPORTED_CONTRACT_VERSIONS,
  isValidChallengeId,
  isValidRevision,
  type ChallengeDefinition,
} from "./definition";
import { findFieldIssues } from "./fields";
import { clonePlainData } from "./plain-data";
import { findStructureIssues, isRecord } from "./structure";
import { reasonOf, safe, shown } from "./text";

/** Per definition, so one badly broken definition cannot flood the log. */
const MAX_ISSUES_PER_DEFINITION = 20;
/** Across all definitions. */
const MAX_ISSUES_TOTAL = 100;

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

/** The meaning checks for one definition whose shape is already known to be sound. */
function describeDefinition(definition: ChallengeDefinition): string[] {
  const { scenario, evaluation } = definition;
  const issues: string[] = [];

  if (!SUPPORTED_CONTRACT_VERSIONS.includes(scenario.contractVersion)) {
    issues.push(`contract version ${safe(scenario.contractVersion)} is not supported`);
  }
  if (!isValidRevision(definition.revision)) {
    issues.push(
      `revision ${shown(definition.revision)} is not valid: use letters, digits, dots and hyphens, ` +
        `starting with a letter or digit, ${REVISION_MAX_LENGTH} characters at most (no "+" or spaces)`,
    );
  }
  // This registry produces diagnosis challenges (DiagnosisChallenge), and nothing else can complete one.
  if (scenario.challenge.completion !== "diagnosis") {
    issues.push(`completion must be "diagnosis", not ${shown(scenario.challenge.completion)}`);
  }

  const filePaths = scenario.files.map((file) => file.path);
  const logIds = scenario.logs.map((entry) => entry.id);
  const requestIds = scenario.network.map((request) => request.id);
  const optionIds = scenario.rootCauseOptions.map((option) => option.id);

  if (!filePaths.includes(scenario.entryFilePath)) {
    issues.push(`entry file ${shown(scenario.entryFilePath)} is not one of the scenario files`);
  }
  for (const path of duplicates(filePaths)) issues.push(`file path ${shown(path)} is used more than once`);
  for (const id of duplicates(logIds)) issues.push(`log id ${shown(id)} is used more than once`);
  for (const id of duplicates(requestIds)) issues.push(`network request id ${shown(id)} is used more than once`);
  for (const id of duplicates(optionIds)) issues.push(`root-cause option id ${shown(id)} is used more than once`);

  const files = new Set(filePaths);
  const logs = new Set(logIds);
  const requests = new Set(requestIds);
  for (const request of scenario.network) {
    // The link is optional (approved), so only a SUPPLIED serverLogId must point at a log. Several requests may share one.
    if (request.serverLogId !== undefined && !logs.has(request.serverLogId)) {
      issues.push(`network request ${shown(request.id)}: serverLogId ${shown(request.serverLogId)} is not a log entry`);
    }
    if (request.initiator !== undefined && !files.has(request.initiator)) {
      issues.push(`network request ${shown(request.id)}: initiator ${shown(request.initiator)} is not a scenario file`);
    }
  }

  // The value is left out on purpose: it is the answer.
  if (!optionIds.includes(evaluation.correctRootCauseId)) {
    issues.push("the correct root cause is not one of the public root-cause options");
  }

  for (const group of duplicates(evaluation.keyObservations.map((observation) => observation.id))) {
    issues.push(`key observation id ${shown(group)} is used more than once`);
  }
  const owner = new Map<string, string>();
  for (const observation of evaluation.keyObservations) {
    if (observation.refs.length === 0) {
      issues.push(`key observation ${shown(observation.id)} has no evidence, so it could never be covered`);
    }
    for (const ref of observation.refs) {
      // The shape check has already guaranteed a valid kind, so this lookup is by the right id.
      const evidenceId = getEvidenceId(ref);
      const exists = ref.kind === "log" ? logs.has(ref.logId) : requests.has(ref.requestId);
      if (!exists) {
        issues.push(`key observation ${shown(observation.id)} refers to unknown evidence ${safe(evidenceId)}`);
        continue;
      }
      const previous = owner.get(evidenceId);
      if (previous === undefined) {
        owner.set(evidenceId, observation.id);
      } else if (previous === observation.id) {
        issues.push(`evidence ${safe(evidenceId)} is listed twice in key observation ${shown(observation.id)}`);
      } else {
        issues.push(
          `evidence ${safe(evidenceId)} is in both key observation ${shown(previous)} and ${shown(observation.id)}`,
        );
      }
    }
  }

  return issues;
}

/** The challenge id of a snapshot, if it has a string one. A snapshot is plain data, so this reads nothing but own data. */
function idOf(snapshot: unknown): string | undefined {
  if (!isRecord(snapshot) || !isRecord(snapshot.scenario) || !isRecord(snapshot.scenario.challenge)) return undefined;
  const id = snapshot.scenario.challenge.id;
  return typeof id === "string" ? id : undefined;
}

/** The manifest `number` of a snapshot, if it has a non-blank string one. */
function numberOf(snapshot: unknown): string | undefined {
  if (!isRecord(snapshot) || !isRecord(snapshot.scenario) || !isRecord(snapshot.scenario.challenge)) return undefined;
  const number = snapshot.scenario.challenge.number;
  return typeof number === "string" && number.trim().length > 0 ? number : undefined;
}

/**
 * The challenge id of a definition that could NOT be snapshotted, for naming its problems only.
 * It walks own data properties through their descriptors, so it never calls a getter and never asks
 * a proxy anything. Nothing validated or published ever comes from here.
 */
function peekId(definition: unknown): string | undefined {
  const own = (value: unknown, key: string): unknown => {
    if (typeof value !== "object" || value === null || types.isProxy(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  const id = own(own(own(definition, "scenario"), "challenge"), "id");
  return typeof id === "string" ? id : undefined;
}

/** At most MAX_ISSUES_PER_DEFINITION problems, then one line saying how many more there were. */
function capped(issues: string[]): string[] {
  const kept = issues.slice(0, MAX_ISSUES_PER_DEFINITION);
  if (issues.length > kept.length) kept.push(`...and ${issues.length - kept.length} more problems`);
  return kept;
}

/**
 * The problems of one SNAPSHOT: its shape (structure.ts), the values of its fields (fields.ts) and,
 * only if the shape is sound, its meaning. Shape and field problems are reported together, so an
 * author sees everything wrong with a definition in one pass.
 */
function issuesOfSnapshot(snapshot: unknown): string[] {
  try {
    const structure = findStructureIssues(snapshot);
    const fields = findFieldIssues(snapshot);
    const meaning = structure.length === 0 ? describeDefinition(snapshot as ChallengeDefinition) : [];
    return capped([...structure, ...fields, ...meaning]);
  } catch (error) {
    // Something the checks did not anticipate. Still a definition error, never a raw one.
    return [`could not be validated: ${reasonOf(error)}`];
  }
}

/** One definition, read ONCE into a snapshot, or the reasons it could not be. Nothing reads the original again. */
function snapshotOf(definition: unknown): { snapshot?: unknown; issues: string[] } {
  try {
    return { snapshot: clonePlainData(definition, "definition"), issues: [] };
  } catch (error) {
    return {
      issues: capped(error instanceof ChallengeDefinitionError ? [...error.issues] : [`could not be read: ${reasonOf(error)}`]),
    };
  }
}

/** What checking a list of definitions produced: every problem, and the snapshots that were successfully taken. */
export interface DefinitionCheck {
  readonly issues: readonly string[];
  /** Snapshots of the definitions that could be read. Meaningful as a registry's input only when `issues` is empty. */
  readonly snapshots: readonly ChallengeDefinition[];
}

/**
 * Checks untrusted definitions. Every definition is first copied, once, into a snapshot of plain
 * data (plain-data.ts), and every check, and the registry after it, uses only the snapshot: the
 * original is never read a second time, so it cannot show one value to the validator and
 * another to the registry. Each problem is prefixed with its challenge id (or its position, when
 * it has no usable id) and, when `origins` names where each definition came from, its source.
 * This function does not throw whatever it is given.
 */
export function checkDefinitions(definitions: unknown, origins: readonly (string | undefined)[] = []): DefinitionCheck {
  if (!Array.isArray(definitions) || types.isProxy(definitions)) {
    return { issues: ["definitions must be a list"], snapshots: [] };
  }

  const items: unknown[] = [];
  try {
    for (let index = 0; index < definitions.length; index += 1) items.push(definitions[index]);
  } catch (error) {
    return { issues: [`definitions could not be read: ${reasonOf(error)}`], snapshots: [] };
  }

  const taken = items.map(snapshotOf);
  const ids = taken.map((entry, index) => (entry.snapshot === undefined ? peekId(items[index]) : idOf(entry.snapshot)));
  const issues: string[] = [];

  // Across definitions: every id is valid, and none is used twice.
  ids.forEach((id, index) => {
    if (id !== undefined && !isValidChallengeId(id)) {
      issues.push(
        `definition #${index + 1}: challenge id ${shown(id)} is not valid: use lowercase letters and digits ` +
          `in groups separated by single hyphens, ${CHALLENGE_ID_MAX_LENGTH} characters at most`,
      );
    }
  });
  for (const id of duplicates(ids.filter((value): value is string => value !== undefined))) {
    const sources = ids.flatMap((value, index) => (value === id && origins[index] ? [shown(origins[index])] : []));
    issues.push(`challenge id ${shown(id)} is defined more than once${sources.length > 0 ? ` (sources: ${sources.join(", ")})` : ""}`);
  }

  // Challenge numbers are unique across the registry (approved). Compared exactly as written: "001" and "1"
  // are different strings, and equivalence between them is not judged.
  const byNumber = new Map<string, string[]>();
  taken.forEach((entry, index) => {
    const number = numberOf(entry.snapshot);
    if (number === undefined) return;
    const owner = isValidChallengeId(ids[index]) ? (ids[index] as string) : `definition #${index + 1}`;
    byNumber.set(number, [...(byNumber.get(number) ?? []), owner]);
  });
  for (const [number, owners] of byNumber) {
    if (owners.length > 1) issues.push(`challenge number ${shown(number)} is used by more than one challenge (${owners.join(", ")})`);
  }

  taken.forEach((entry, index) => {
    const id = ids[index];
    const name = isValidChallengeId(id) ? id : `definition #${index + 1}`;
    const origin = origins[index];
    const prefix = `${name}${origin ? ` (source ${shown(origin)})` : ""}: `;
    const problems = entry.issues.length > 0 ? entry.issues : issuesOfSnapshot(entry.snapshot);
    for (const issue of problems) issues.push(`${prefix}${issue}`);
  });

  if (issues.length > MAX_ISSUES_TOTAL) {
    const omitted = issues.length - MAX_ISSUES_TOTAL;
    issues.length = MAX_ISSUES_TOTAL;
    issues.push(`...and ${omitted} more problems in other definitions`);
  }
  return { issues, snapshots: taken.flatMap((entry) => (entry.snapshot === undefined ? [] : [entry.snapshot as ChallengeDefinition])) };
}

/** Every problem across the definitions. Empty means valid. */
export function findDefinitionIssues(definitions: unknown, origins: readonly (string | undefined)[] = []): string[] {
  return [...checkDefinitions(definitions, origins).issues];
}

/**
 * Throws a ChallengeDefinitionError listing every problem, or returns the validated snapshots.
 * Build from the returned snapshots, never from `definitions`.
 */
export function assertValidDefinitions(
  definitions: unknown,
  origins: readonly (string | undefined)[] = [],
): readonly ChallengeDefinition[] {
  const { issues, snapshots } = checkDefinitions(definitions, origins);
  if (issues.length > 0) throw new ChallengeDefinitionError([...issues]);
  return snapshots;
}
