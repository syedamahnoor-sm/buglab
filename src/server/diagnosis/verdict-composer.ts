/*
 * Combines the deterministic root-cause gate with an optional reasoning assessment.
 * Server-only.
 *
 * Deterministic root-cause matching is authoritative:
 * - Incorrect root cause → incorrect (reasoning cannot complete or flip the verdict).
 * - Correct root cause + strong reasoning → existing correct behavior.
 * - Correct root cause + weak reasoning → internal partial reasoning recorded, public
 *   status stays correct and completion semantics are unchanged until Phase E approval.
 *
 * When reasoning is unavailable, the deterministic EvaluationResult is returned alone.
 */
import "server-only";
import type { DiagnosisFeedback } from "@/types/diagnosis";
import type { WorkspaceScenario } from "@/types/workspace";
import type { EvaluationResult } from "./evaluate";
import {
  assertSafeReasoningRequest,
  DeterministicDiagnosisEvaluator,
  toReasoningEvaluationRequest,
  type DeterministicEvaluationRequest,
  type DiagnosisEvaluator,
  type ReasoningEvaluationRequest,
} from "./evaluator";
import {
  isStrongReasoning,
  isWeakReasoning,
  type ReasoningAssessment,
  type ReasoningEvaluator,
  unavailableReasoningEvaluator,
} from "./reasoning";
import { sanitizeReasoningAssessment, sanitizeReasoningRequest } from "./reasoning-safety";

export interface ComposeVerdictInput {
  readonly deterministic: EvaluationResult;
  readonly reasoning: ReasoningAssessment;
}

/**
 * Server-only composition result. `result` is the public EvaluationResult.
 * `reasoning` and `internalPartialReasoning` must not be copied into DiagnosisResponse.
 */
export interface ComposedEvaluation {
  readonly result: EvaluationResult;
  readonly reasoning: ReasoningAssessment;
  /**
   * True when the root cause matched and reasoning was ok but not strong.
   * Internal only — does not change AttemptOutcome or completion.
   */
  readonly internalPartialReasoning: boolean;
}

/**
 * Builds the existing EvaluationResult plus an internal reasoning record.
 * Binary public status only.
 */
export function composeVerdictDetailed(input: ComposeVerdictInput): ComposedEvaluation {
  const { deterministic, reasoning: rawReasoning } = input;
  const reasoning = sanitizeReasoningAssessment(rawReasoning);

  if (reasoning.status !== "ok") {
    return { result: deterministic, reasoning, internalPartialReasoning: false };
  }

  if (deterministic.status === "incorrect") {
    const hints = mergeHints(deterministic.feedback.hints, [
      ...reasoning.identifiedGaps,
      ...(reasoning.feedback ? [reasoning.feedback] : []),
    ]);
    return {
      result: { status: "incorrect", feedback: withHints(deterministic.feedback, hints) },
      reasoning,
      internalPartialReasoning: false,
    };
  }

  if (isStrongReasoning(reasoning)) {
    return { result: deterministic, reasoning, internalPartialReasoning: false };
  }

  // Correct root cause + weak reasoning: keep completion semantics; record internal partial.
  const coaching = mergeHints(deterministic.feedback.hints, [
    ...reasoning.identifiedGaps,
    reasoning.feedback,
    "Your root cause matches the incident, but the explanation or evidence could be stronger for a full write-up.",
  ]);
  return {
    result: {
      status: "correct",
      feedback: withHints(deterministic.feedback, coaching),
      resolution: deterministic.resolution,
    },
    reasoning,
    internalPartialReasoning: isWeakReasoning(reasoning),
  };
}

/** Convenience: public EvaluationResult only. */
export function composeVerdict(input: ComposeVerdictInput): EvaluationResult {
  return composeVerdictDetailed(input).result;
}

function withHints(feedback: DiagnosisFeedback, hints: readonly string[]): DiagnosisFeedback {
  return {
    headline: feedback.headline,
    hints: [...hints],
    evidenceSummary: { ...feedback.evidenceSummary },
  };
}

function mergeHints(base: readonly string[], extra: readonly string[]): string[] {
  const seen = new Set(base);
  const out = [...base];
  for (const hint of extra) {
    if (!hint || seen.has(hint)) continue;
    seen.add(hint);
    out.push(hint);
  }
  return out;
}

export interface ComposedDiagnosisEvaluatorOptions {
  deterministic?: DiagnosisEvaluator;
  reasoning?: ReasoningEvaluator;
  /**
   * Public scenario used when the per-request `scenario` is omitted.
   * Prefer passing `scenario` on DeterministicEvaluationRequest for multi-challenge services.
   */
  scenario?: WorkspaceScenario;
  /** Optional lookup used when neither constructor nor request supplies a scenario. */
  resolveScenario?: (request: DeterministicEvaluationRequest) => WorkspaceScenario | undefined;
  onReasoningRequest?: (request: ReasoningEvaluationRequest) => void;
  /** Optional hook for tests inspecting the internal composition record. */
  onComposed?: (composed: ComposedEvaluation) => void;
}

/**
 * DiagnosisEvaluator that runs the deterministic gate, then optional reasoning, then
 * composeVerdict. Reasoning never completes a session on its own.
 */
export class ComposedDiagnosisEvaluator implements DiagnosisEvaluator {
  private readonly deterministic: DiagnosisEvaluator;
  private readonly reasoning: ReasoningEvaluator;
  private readonly scenario: WorkspaceScenario | undefined;
  private readonly resolveScenario: ((request: DeterministicEvaluationRequest) => WorkspaceScenario | undefined) | undefined;
  private readonly onReasoningRequest: ((request: ReasoningEvaluationRequest) => void) | undefined;
  private readonly onComposed: ((composed: ComposedEvaluation) => void) | undefined;

  constructor(options: ComposedDiagnosisEvaluatorOptions = {}) {
    this.deterministic = options.deterministic ?? new DeterministicDiagnosisEvaluator();
    this.reasoning = options.reasoning ?? unavailableReasoningEvaluator;
    this.scenario = options.scenario;
    this.resolveScenario = options.resolveScenario;
    this.onReasoningRequest = options.onReasoningRequest;
    this.onComposed = options.onComposed;
  }

  async evaluate(request: DeterministicEvaluationRequest): Promise<EvaluationResult> {
    const composed = await this.evaluateDetailed(request);
    return composed.result;
  }

  async evaluateDetailed(request: DeterministicEvaluationRequest): Promise<ComposedEvaluation> {
    const deterministic = await this.deterministic.evaluate(request);
    const scenario = request.scenario ?? this.scenario ?? this.resolveScenario?.(request);
    if (!scenario) {
      const composed: ComposedEvaluation = {
        result: deterministic,
        reasoning: { status: "unavailable", reason: "provider-error" },
        internalPartialReasoning: false,
      };
      this.onComposed?.(composed);
      return composed;
    }

    const reasoningRequest = sanitizeReasoningRequest(toReasoningEvaluationRequest(request.submission, scenario));
    assertSafeReasoningRequest(reasoningRequest);
    this.onReasoningRequest?.(reasoningRequest);

    let reasoning: ReasoningAssessment;
    try {
      reasoning = await this.reasoning.assess(reasoningRequest);
    } catch {
      reasoning = { status: "unavailable", reason: "provider-error" };
    }
    const composed = composeVerdictDetailed({ deterministic, reasoning });
    this.onComposed?.(composed);
    return composed;
  }
}

export function createComposedDiagnosisEvaluator(options: ComposedDiagnosisEvaluatorOptions = {}): DiagnosisEvaluator {
  return new ComposedDiagnosisEvaluator(options);
}
