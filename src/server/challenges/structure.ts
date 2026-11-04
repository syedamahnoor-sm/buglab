/*
 * Structural checks on a challenge definition. Server-only.
 *
 * A definition arrives as TypeScript today, but the loader exists to take definitions from
 * other places (files, a store), where the type system promises nothing. This module checks
 * that every structure the rest of the module DEREFERENCES is really there, so a malformed
 * definition is reported as a ChallengeDefinitionError that names the problem, never as a
 * raw TypeError from deep inside the registry.
 *
 * It checks only what the code needs to run safely: lists are lists, items are objects, the
 * ids and references that later checks look up are strings, and header entries have a string
 * name and value (the public view copies them). It runs on a SNAPSHOT (plain-data.ts), which
 * has already been checked to be plain data, so it never meets a getter, a proxy or a value
 * that cannot be serialized. The values of fields (types, blanks, closed sets, ranges) are
 * fields.ts; what is deliberately not judged is listed there and in the foundation doc, section 8.7.
 *
 * Messages carry paths, never answer text. Any authored value they repeat goes through text.ts.
 */
import "server-only";
import { shown } from "./text";

type Issues = string[];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The object items of a list, each with its real position, so a message points at the right
 * index. A value that is not a list gives nothing: it is reported as a shape problem elsewhere.
 */
export function entriesOf(value: unknown): { item: Record<string, unknown>; index: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown, index: number) => (isRecord(item) ? [{ item, index }] : []));
}

function requireRecord(value: unknown, path: string, issues: Issues): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  issues.push(`${path} must be an object`);
  return null;
}

function requireString(owner: Record<string, unknown>, key: string, path: string, issues: Issues): void {
  if (typeof owner[key] !== "string") issues.push(`${path}.${key} must be a string`);
}

function requireList(value: unknown, path: string, issues: Issues): unknown[] | null {
  if (Array.isArray(value)) return value;
  issues.push(`${path} must be a list`);
  return null;
}

/** Every item must be an object. Returns the items that are, so callers check only those. */
function eachRecord(value: unknown, path: string, issues: Issues): { item: Record<string, unknown>; at: string }[] {
  const list = requireList(value, path, issues);
  if (!list) return [];
  const records: { item: Record<string, unknown>; at: string }[] = [];
  list.forEach((item, index) => {
    const at = `${path}[${index}]`;
    const record = requireRecord(item, at, issues);
    if (record) records.push({ item: record, at });
  });
  return records;
}

function checkScenario(scenario: Record<string, unknown>, issues: Issues): void {
  requireString(scenario, "entryFilePath", "scenario", issues);

  const challenge = requireRecord(scenario.challenge, "scenario.challenge", issues);
  if (challenge) {
    requireString(challenge, "id", "scenario.challenge", issues);
    requireList(challenge.tags, "scenario.challenge.tags", issues);
  }

  for (const { item, at } of eachRecord(scenario.files, "scenario.files", issues)) {
    requireString(item, "path", at, issues);
  }
  for (const { item, at } of eachRecord(scenario.logs, "scenario.logs", issues)) {
    requireString(item, "id", at, issues);
  }
  for (const { item, at } of eachRecord(scenario.network, "scenario.network", issues)) {
    requireString(item, "id", at, issues);
    // Optional (approved): a request may have no linked log. When it is there, it must be a string.
    if (item.serverLogId !== undefined && typeof item.serverLogId !== "string") {
      issues.push(`${at}.serverLogId must be a string when present`);
    }
    for (const key of ["requestHeaders", "responseHeaders"]) {
      // The public view reads `name` and `value` from every header, so every entry must be an object that has both.
      for (const { item: header, at: headerAt } of eachRecord(item[key], `${at}.${key}`, issues)) {
        requireString(header, "name", headerAt, issues);
        requireString(header, "value", headerAt, issues);
      }
    }
  }
  for (const { item, at } of eachRecord(scenario.rootCauseOptions, "scenario.rootCauseOptions", issues)) {
    requireString(item, "id", at, issues);
  }
}

function checkEvaluation(evaluation: Record<string, unknown>, issues: Issues): void {
  requireString(evaluation, "correctRootCauseId", "evaluation", issues);
  requireString(evaluation, "resolutionSummary", "evaluation", issues);

  for (const { item: observation, at } of eachRecord(evaluation.keyObservations, "evaluation.keyObservations", issues)) {
    requireString(observation, "id", at, issues);
    for (const { item: ref, at: refAt } of eachRecord(observation.refs, `${at}.refs`, issues)) {
      // The discriminated union: a "log" reference carries a logId, a "network" one a requestId.
      if (ref.kind === "log") requireString(ref, "logId", refAt, issues);
      else if (ref.kind === "network") requireString(ref, "requestId", refAt, issues);
      else issues.push(`${refAt}.kind must be "log" or "network", not ${shown(ref.kind)}`);
    }
  }
}

/** Problems with the shape of one definition. Empty means it is safe to inspect further. */
export function findStructureIssues(definition: unknown): string[] {
  const issues: Issues = [];
  const root = requireRecord(definition, "definition", issues);
  if (!root) return issues;

  if (typeof root.revision !== "string") issues.push("definition.revision must be a string");

  const scenario = requireRecord(root.scenario, "scenario", issues);
  if (scenario) checkScenario(scenario, issues);

  const evaluation = requireRecord(root.evaluation, "evaluation", issues);
  if (evaluation) checkEvaluation(evaluation, issues);

  return issues;
}
