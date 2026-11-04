/*
 * Helpers for tests that change ONE field of Challenge 001 and expect ONE specific message.
 * Shared by the field, path, timestamp and limit tests, so they all hold the same standard:
 * the mutation produces exactly one issue, at exactly one path, and the registry refuses it.
 */
import assert from "node:assert/strict";
import { ChallengeDefinitionError } from "@/server/challenges/definition";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { shown } from "@/server/challenges/text";
import { findDefinitionIssues } from "@/server/challenges/validate";
import { draftOf, type Draft } from "./helpers";

export type Loose = { [key: string]: unknown };
export const loose = (value: unknown) => value as Loose;
export const MISSING = Symbol("missing");

/** Sets a field, or removes it when the value is MISSING. */
export function put(owner: unknown, key: string, value: unknown): void {
  if (value === MISSING) delete loose(owner)[key];
  else loose(owner)[key] = value;
}
export const asShown = (value: unknown) => shown(value === MISSING ? undefined : value);

export const PREFIX = "challenge-001: ";
export const issuesFor = (change: (draft: Draft) => void) => findDefinitionIssues([draftOf(change)]);

/** The mutation must produce exactly this one issue, at this path, and the registry must refuse it. */
export function exactly(change: (draft: Draft) => void, expected: string): void {
  assert.deepEqual(issuesFor(change), [`${PREFIX}${expected}`]);
  assert.throws(
    () => createChallengeRegistry([draftOf(change)]),
    (error: unknown) => error instanceof ChallengeDefinitionError && error.issues.includes(`${PREFIX}${expected}`),
  );
}

export function accepted(change: (draft: Draft) => void): void {
  assert.deepEqual(issuesFor(change), []);
  assert.doesNotThrow(() => createChallengeRegistry([draftOf(change)]));
}

// Records that nothing else refers to, so changing one of their fields produces one issue and no more.
export const freeFile = (d: Draft) =>
  d.scenario.files.findIndex(
    (file) => file.path !== d.scenario.entryFilePath && !d.scenario.network.some((request) => request.initiator === file.path),
  );
export const freeLog = (d: Draft) =>
  d.scenario.logs.findIndex(
    (entry) =>
      !d.scenario.network.some((request) => request.serverLogId === entry.id) &&
      !d.evaluation.keyObservations.some((group) => group.refs.some((ref) => ref.kind === "log" && ref.logId === entry.id)),
  );
export const wrongOption = (d: Draft) => d.scenario.rootCauseOptions.findIndex((option) => option.id !== d.evaluation.correctRootCauseId);
