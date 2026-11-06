/*
 * Server-side diagnosis evaluation boundary. Server-only.
 *
 * Callers (the live diagnosis handler and LearnerSessionService) depend on this
 * contract, not on a particular algorithm. Deterministic grading may see the
 * answer key. Reasoning evaluation must take ReasoningEvaluationRequest only.
 */
import "server-only";
import type { DiagnosisSubmission, RootCauseOption } from "@/types/diagnosis";
import type { EvidenceRef } from "@/types/investigation";
import type { WorkspaceScenario } from "@/types/workspace";
import { evaluateDiagnosis, type EvaluationResult } from "./evaluate";
import type { DiagnosisAnswerKey } from "./registry";

export type { EvaluationResult };

/**
 * Server-only input for the deterministic grader. It may carry the answer key.
 * Never serialize this object to a client or a model prompt.
 */
export interface DeterministicEvaluationRequest {
  readonly submission: DiagnosisSubmission;
  readonly answerKey: DiagnosisAnswerKey;
  /** Challenge investigation hints for incorrect diagnoses; generic hints apply when omitted. */
  readonly investigationHints?: readonly string[];
  /**
   * Public challenge material for the optional reasoning path. Never includes the
   * answer key. Required when a ComposedDiagnosisEvaluator will call reasoning.
   */
  readonly publicContext?: PublicChallengeContext;
  /**
   * Public workspace scenario for building ReasoningEvaluationRequest excerpts.
   * Must never be the answer-key module. Optional; without it the composed path
   * falls back to deterministic-only.
   */
  readonly scenario?: WorkspaceScenario;
}

/** @deprecated Use DeterministicEvaluationRequest. Kept so existing call sites keep compiling. */
export type DiagnosisEvaluationRequest = DeterministicEvaluationRequest;

/** Public challenge surface shared with a reasoning evaluator. No answer-key fields. */
export interface PublicChallengeContext {
  readonly challenge: {
    readonly id: string;
    readonly title: string;
    readonly incident: string;
  };
  readonly rootCauseOptions: readonly Pick<RootCauseOption, "id" | "label" | "description">[];
}

/** One learner-cited evidence item with a permitted public excerpt. */
export interface ReasoningEvidenceItem {
  readonly kind: EvidenceRef["kind"];
  readonly id: string;
  /** Short public excerpt from the scenario log/network row. Never an answer-key note. */
  readonly excerpt: string;
}

/**
 * Model-facing input. Public scenario + submission fields only. No answer key,
 * resolution, key-observation ids, learner/session/attempt ids, cookies or tokens.
 */
export interface ReasoningEvaluationRequest {
  readonly challenge: PublicChallengeContext["challenge"];
  readonly rootCauseOptions: PublicChallengeContext["rootCauseOptions"];
  readonly selectedRootCauseId: string;
  readonly explanation: string;
  readonly evidence: readonly ReasoningEvidenceItem[];
}

const REASONING_KEYS = new Set([
  "challenge",
  "rootCauseOptions",
  "selectedRootCauseId",
  "explanation",
  "evidence",
  "id",
  "title",
  "incident",
  "label",
  "description",
  "kind",
  "excerpt",
]);

const FORBIDDEN_KEYS = new Set([
  "correctRootCauseId",
  "resolutionSummary",
  "keyObservations",
  "keyEvidence",
  "answerKey",
  "learnerId",
  "sessionId",
  "attemptId",
  "cookie",
  "token",
  "tokenHash",
  "investigationHints",
  "rootCauseId",
]);

const MAX_EXCERPT_CHARS = 280;

function collectKeys(value: unknown, found: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      found.push(key);
      collectKeys((value as Record<string, unknown>)[key], found);
    }
  }
}

/** Rejects a reasoning request that carries a server secret or an unexpected field. */
export function assertSafeReasoningRequest(value: ReasoningEvaluationRequest): void {
  const found: string[] = [];
  collectKeys(value, found);
  for (const key of found) {
    if (FORBIDDEN_KEYS.has(key) || !REASONING_KEYS.has(key)) {
      throw new Error("A reasoning request has a field that is not model-facing.");
    }
  }
}

/** Builds the public challenge slice from a workspace scenario. Does not read an answer key. */
export function buildPublicChallengeContext(scenario: WorkspaceScenario): PublicChallengeContext {
  return {
    challenge: {
      id: scenario.challenge.id,
      title: scenario.challenge.title,
      incident: scenario.challenge.incident,
    },
    rootCauseOptions: scenario.rootCauseOptions.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
    })),
  };
}

function excerptFor(ref: EvidenceRef, scenario: WorkspaceScenario): string {
  if (ref.kind === "log") {
    const entry = scenario.logs.find((log) => log.id === ref.logId);
    if (!entry) return "";
    return `${entry.level} ${entry.source}: ${entry.message}`.slice(0, MAX_EXCERPT_CHARS);
  }
  const request = scenario.network.find((item) => item.id === ref.requestId);
  if (!request) return "";
  return `${request.method} ${request.path} → ${request.status} ${request.statusText}`.slice(0, MAX_EXCERPT_CHARS);
}

/**
 * Builds the model-facing view of a submission against public scenario material.
 * Does not accept or read an answer key.
 */
export function toReasoningEvaluationRequest(
  submission: DiagnosisSubmission,
  scenario: WorkspaceScenario,
): ReasoningEvaluationRequest {
  const publicContext = buildPublicChallengeContext(scenario);
  const request: ReasoningEvaluationRequest = {
    challenge: publicContext.challenge,
    rootCauseOptions: publicContext.rootCauseOptions,
    selectedRootCauseId: submission.rootCauseId,
    explanation: submission.explanation,
    evidence: submission.evidence.map((ref) =>
      ref.kind === "log"
        ? { kind: "log" as const, id: ref.logId, excerpt: excerptFor(ref, scenario) }
        : { kind: "network" as const, id: ref.requestId, excerpt: excerptFor(ref, scenario) },
    ),
  };
  assertSafeReasoningRequest(request);
  return request;
}

/**
 * Judges a validated submission. Sync today; implementations may return a Promise
 * (callers always await). Must not mutate the submission or answer key.
 * This is the deterministic boundary. A reasoning model must take ReasoningEvaluationRequest, not this.
 */
export interface DiagnosisEvaluator {
  evaluate(request: DeterministicEvaluationRequest): EvaluationResult | Promise<EvaluationResult>;
}

/** The production deterministic evaluator: wraps evaluateDiagnosis unchanged. */
export class DeterministicDiagnosisEvaluator implements DiagnosisEvaluator {
  evaluate(request: DeterministicEvaluationRequest): EvaluationResult {
    return evaluateDiagnosis(request.submission, request.answerKey, request.investigationHints);
  }
}

/** Shared default instance for composition roots that do not inject an evaluator. */
export const deterministicDiagnosisEvaluator: DiagnosisEvaluator = new DeterministicDiagnosisEvaluator();
