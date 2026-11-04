/*
 * The internal shape of one challenge, as authored. Server-only.
 *
 * A definition keeps the two halves of a challenge apart:
 *
 *   scenario    what a learner may see (the existing WorkspaceScenario, unchanged)
 *   evaluation  what only the server may know: the answer and the key observations
 *
 * Nothing here is a public schema. It is an internal seam that adapts what Challenge
 * 001 already is, so the public contract (still under review) can change on its own
 * schedule. The registry never hands a definition out: it builds a public view field
 * by field and the existing DiagnosisChallenge from it.
 */
import "server-only";
import type { EvidenceRef } from "@/types/investigation";
import type { WorkspaceScenario } from "@/types/workspace";

/** The WorkspaceScenario contract versions this loader understands. Frozen: it is a rule, not a setting. */
export const SUPPORTED_CONTRACT_VERSIONS: readonly number[] = Object.freeze([1]);

/**
 * Challenge id format. An id appears in URLs (`/api/challenges/:id/...`) and as a storage
 * key, so it is restricted to what is safe in both: lowercase letters and digits in groups
 * separated by single hyphens, 1 to 64 characters.
 *   valid:   challenge-001   sql-joins-2   a
 *   invalid: Challenge-001   challenge_001   challenge--1   -a   a-   ../a   "a b"   __proto__
 */
export const CHALLENGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CHALLENGE_ID_MAX_LENGTH = 64;

/**
 * Revision format. The content version is `<revision>+<fingerprint>`, so a revision must
 * never contain "+" or whitespace or the version could not be split back apart. Letters,
 * digits, dots and hyphens, starting with a letter or digit, 1 to 32 characters.
 *   valid:   1   2   1.2   r7   2026-11-03
 *   invalid: ""   "1+x"   "1 2"   -1   .1   "é"
 */
export const REVISION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.-]*$/;
export const REVISION_MAX_LENGTH = 32;

export function isValidChallengeId(value: unknown): value is string {
  return typeof value === "string" && value.length <= CHALLENGE_ID_MAX_LENGTH && CHALLENGE_ID_PATTERN.test(value);
}

export function isValidRevision(value: unknown): value is string {
  return typeof value === "string" && value.length <= REVISION_MAX_LENGTH && REVISION_PATTERN.test(value);
}

/** Private. Equivalent evidence for one thing the diagnosis should be able to show. */
export interface KeyObservationConfig {
  readonly id: string;
  readonly refs: readonly EvidenceRef[];
}

/** Private. Everything needed to judge a diagnosis, and nothing a learner may see. */
export interface EvaluationConfig {
  readonly correctRootCauseId: string;
  /** Shown to the learner only after a correct diagnosis. */
  readonly resolutionSummary: string;
  readonly keyObservations: readonly KeyObservationConfig[];
}

export interface ChallengeDefinition {
  /** Learner-visible content, exactly as the workspace renders it. */
  readonly scenario: WorkspaceScenario;
  /** Server-only evaluation configuration. */
  readonly evaluation: EvaluationConfig;
  /**
   * Bumped by hand when the content changes in a way the public content cannot show,
   * such as a corrected answer key. It is part of the content version.
   */
  readonly revision: string;
}

/** A challenge source could not be loaded, or a definition is inconsistent. Carries every problem found. */
export class ChallengeDefinitionError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid challenge definitions:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ChallengeDefinitionError";
    this.issues = issues;
  }
}
