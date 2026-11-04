import assert from "node:assert/strict";
import { challenge001Definition } from "@/server/challenges/challenge-001";
import type { ChallengeDefinition } from "@/server/challenges/definition";
import type { EvidenceRef } from "@/types/investigation";
import type { WorkspaceScenario } from "@/types/workspace";

/** A definition that tests may edit freely. */
export interface Draft {
  scenario: WorkspaceScenario;
  evaluation: {
    correctRootCauseId: string;
    resolutionSummary: string;
    keyObservations: { id: string; refs: EvidenceRef[] }[];
  };
  revision: string;
}

/** A deep, private copy of Challenge 001's definition, optionally changed. */
export function draftOf(change?: (draft: Draft) => void): Draft {
  const draft = structuredClone(challenge001Definition) as unknown as Draft;
  change?.(draft);
  return draft;
}

export function definitionOf(change?: (draft: Draft) => void): ChallengeDefinition {
  return draftOf(change);
}

/**
 * Map-like and Set-like values (real or read-only) as plain data, so two registries can be compared
 * structurally even though one holds read-only views and the other real Maps and Sets.
 */
export function toPlain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object" && value !== null) {
    const shape = value as { entries?: unknown; get?: unknown; has?: unknown; values?: unknown };
    if (typeof shape.entries === "function" && typeof shape.get === "function" && typeof shape.has === "function") {
      const entries = [...(value as ReadonlyMap<unknown, unknown>).entries()];
      return { __map: entries.map(([key, item]) => [key, toPlain(item)]) };
    }
    if (typeof shape.has === "function" && typeof shape.values === "function") {
      return { __set: [...(value as ReadonlySet<unknown>).values()].map(toPlain) };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlain(item)]));
  }
  return value;
}

/** A content version is `<revision>+<12 hex>`, with the revision taken from the definition, not hardcoded. */
export function assertContentVersion(version: string | undefined, revision: string): void {
  assert.ok(version !== undefined, "expected a content version");
  assert.ok(version.startsWith(`${revision}+`), `${version} should start with "${revision}+"`);
  assert.match(version.slice(revision.length + 1), /^[0-9a-f]{12}$/);
}

/** What a browser would receive: JSON, so an `undefined` field and a missing one are the same. */
export function onTheWire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}
