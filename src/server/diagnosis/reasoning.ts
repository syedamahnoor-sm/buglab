/*
 * Structured reasoning assessment. Server-only.
 *
 * A ReasoningEvaluator sees only ReasoningEvaluationRequest (no answer key). Its
 * output is an internal ReasoningAssessment. VerdictComposer combines that with
 * the deterministic root-cause gate into the existing EvaluationResult. The
 * public DiagnosisResponse / AttemptOutcome contracts stay binary until Phase E.
 *
 * Phase C ships a fixture-driven fake. No paid model calls.
 */
import "server-only";
import { assertSafeReasoningRequest, type ReasoningEvaluationRequest } from "./evaluator";

/** Bounded classification for overall reasoning quality. */
export type ReasoningQuality = "strong" | "adequate" | "weak" | "poor";

/** Bounded classification for how well cited evidence supports the write-up. */
export type EvidenceRelevance = "relevant" | "mixed" | "irrelevant";

/** Bounded classification for explanation clarity. */
export type ExplanationClarity = "clear" | "adequate" | "unclear";

export type ReasoningUnavailableReason = "timeout" | "invalid-response" | "provider-error";

/**
 * Structured assessment from a reasoning evaluator. Never sent to the client as-is.
 * `ok` is a successful parse; `unavailable` is timeout, invalid JSON, or provider failure.
 */
export type ReasoningAssessment =
  | {
      readonly status: "ok";
      readonly reasoningQuality: ReasoningQuality;
      readonly evidenceRelevance: EvidenceRelevance;
      readonly explanationClarity: ExplanationClarity;
      readonly identifiedGaps: readonly string[];
      readonly feedback: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason: ReasoningUnavailableReason;
    };

export interface ReasoningEvaluator {
  assess(request: ReasoningEvaluationRequest): Promise<ReasoningAssessment>;
}

const QUALITIES = new Set<ReasoningQuality>(["strong", "adequate", "weak", "poor"]);
const RELEVANCES = new Set<EvidenceRelevance>(["relevant", "mixed", "irrelevant"]);
const CLARITIES = new Set<ExplanationClarity>(["clear", "adequate", "unclear"]);
const MAX_GAPS = 8;
const MAX_GAP_CHARS = 240;
const MAX_FEEDBACK_CHARS = 600;

/** Strong overall: high quality, relevant evidence, and at least adequate clarity. */
export function isStrongReasoning(assessment: Extract<ReasoningAssessment, { status: "ok" }>): boolean {
  return (
    assessment.reasoningQuality === "strong" &&
    assessment.evidenceRelevance === "relevant" &&
    (assessment.explanationClarity === "clear" || assessment.explanationClarity === "adequate")
  );
}

/** Correct root cause with non-strong reasoning is an internal partial — not a public status. */
export function isWeakReasoning(assessment: Extract<ReasoningAssessment, { status: "ok" }>): boolean {
  return !isStrongReasoning(assessment);
}

/**
 * Rejects contradictory combinations (for example "strong" reasoning with
 * "irrelevant" evidence). Used by parse and by the fake "contradictory" fixture.
 */
export function isContradictoryAssessment(assessment: Extract<ReasoningAssessment, { status: "ok" }>): boolean {
  if (assessment.reasoningQuality === "strong" && assessment.evidenceRelevance === "irrelevant") return true;
  if (assessment.reasoningQuality === "poor" && assessment.evidenceRelevance === "relevant" && assessment.explanationClarity === "clear") {
    return true;
  }
  return false;
}

/**
 * Validates a structured reasoning payload (for example JSON from a model or fixture).
 * Rejects malformed, out-of-bounds, missing, or contradictory assessments.
 */
export function parseReasoningAssessment(value: unknown): ReasoningAssessment {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { status: "unavailable", reason: "invalid-response" };
  }
  const body = value as Record<string, unknown>;
  if (body.status === "unavailable") {
    const reason = body.reason;
    if (reason === "timeout" || reason === "invalid-response" || reason === "provider-error") {
      return { status: "unavailable", reason };
    }
    return { status: "unavailable", reason: "invalid-response" };
  }
  if (body.status !== "ok") return { status: "unavailable", reason: "invalid-response" };
  if (typeof body.reasoningQuality !== "string" || !QUALITIES.has(body.reasoningQuality as ReasoningQuality)) {
    return { status: "unavailable", reason: "invalid-response" };
  }
  if (typeof body.evidenceRelevance !== "string" || !RELEVANCES.has(body.evidenceRelevance as EvidenceRelevance)) {
    return { status: "unavailable", reason: "invalid-response" };
  }
  if (typeof body.explanationClarity !== "string" || !CLARITIES.has(body.explanationClarity as ExplanationClarity)) {
    return { status: "unavailable", reason: "invalid-response" };
  }
  if (typeof body.feedback !== "string" || body.feedback.trim().length === 0 || body.feedback.length > MAX_FEEDBACK_CHARS) {
    return { status: "unavailable", reason: "invalid-response" };
  }
  if (!Array.isArray(body.identifiedGaps) || body.identifiedGaps.length > MAX_GAPS) {
    return { status: "unavailable", reason: "invalid-response" };
  }
  if (!body.identifiedGaps.every((gap) => typeof gap === "string" && gap.length > 0 && gap.length <= MAX_GAP_CHARS)) {
    return { status: "unavailable", reason: "invalid-response" };
  }
  const ok = {
    status: "ok" as const,
    reasoningQuality: body.reasoningQuality as ReasoningQuality,
    evidenceRelevance: body.evidenceRelevance as EvidenceRelevance,
    explanationClarity: body.explanationClarity as ExplanationClarity,
    identifiedGaps: Object.freeze([...body.identifiedGaps]) as string[],
    feedback: body.feedback.trim(),
  };
  if (isContradictoryAssessment(ok)) return { status: "unavailable", reason: "invalid-response" };
  return ok;
}

/** Named fixtures for FakeReasoningEvaluator. No network. */
export type FakeReasoningFixture =
  | "strong-reasoning"
  | "weak-reasoning"
  | "relevant-evidence"
  | "irrelevant-evidence"
  | "contradictory-explanation"
  | "invalid-assessment"
  | "timeout"
  | "unavailable";

const FIXTURE_ASSESSMENTS: Record<
  Exclude<FakeReasoningFixture, "invalid-assessment" | "timeout" | "unavailable" | "contradictory-explanation">,
  Extract<ReasoningAssessment, { status: "ok" }>
> = {
  "strong-reasoning": {
    status: "ok",
    reasoningQuality: "strong",
    evidenceRelevance: "relevant",
    explanationClarity: "clear",
    identifiedGaps: [],
    feedback: "The explanation ties the cited evidence to the chosen option clearly.",
  },
  "weak-reasoning": {
    status: "ok",
    reasoningQuality: "weak",
    evidenceRelevance: "mixed",
    explanationClarity: "adequate",
    identifiedGaps: ["Connect each claim to a specific log line or network request."],
    feedback: "The root-cause choice may be stated, but the write-up needs stronger support.",
  },
  "relevant-evidence": {
    status: "ok",
    reasoningQuality: "adequate",
    evidenceRelevance: "relevant",
    explanationClarity: "adequate",
    identifiedGaps: ["Clarify the causal chain between the evidence and the chosen option."],
    feedback: "Cited evidence is on-topic; the causal explanation could be sharper.",
  },
  "irrelevant-evidence": {
    status: "ok",
    reasoningQuality: "weak",
    evidenceRelevance: "irrelevant",
    explanationClarity: "unclear",
    identifiedGaps: ["The cited evidence does not support the claims in the explanation."],
    feedback: "Evidence appears unrelated to the chosen root-cause option.",
  },
};

export type FakeReasoningBehavior =
  | { readonly kind: "fixture"; readonly fixture: FakeReasoningFixture }
  | { readonly kind: "assessment"; readonly assessment: ReasoningAssessment }
  | { readonly kind: "raw"; readonly value: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "throw"; readonly error?: Error }
  | {
      readonly kind: "by-selected-root-cause";
      readonly map: Readonly<Record<string, FakeReasoningBehavior>>;
      readonly fallback?: FakeReasoningBehavior;
    };

/**
 * Fixture-driven reasoning evaluator for tests and CI. Never calls a model.
 * Default fixture is `unavailable`, so composing it leaves deterministic grading alone.
 */
export class FakeReasoningEvaluator implements ReasoningEvaluator {
  private readonly behavior: FakeReasoningBehavior;

  constructor(
    behavior: FakeReasoningBehavior | FakeReasoningFixture = {
      kind: "fixture",
      fixture: "unavailable",
    },
  ) {
    this.behavior = typeof behavior === "string" ? { kind: "fixture", fixture: behavior } : behavior;
  }

  async assess(request: ReasoningEvaluationRequest): Promise<ReasoningAssessment> {
    assertSafeReasoningRequest(request);
    return this.run(this.behavior, request);
  }

  private async run(behavior: FakeReasoningBehavior, request: ReasoningEvaluationRequest): Promise<ReasoningAssessment> {
    switch (behavior.kind) {
      case "assessment":
        return behavior.assessment;
      case "raw":
        return parseReasoningAssessment(behavior.value);
      case "timeout":
        return { status: "unavailable", reason: "timeout" };
      case "throw":
        throw behavior.error ?? new Error("reasoning provider failed");
      case "fixture":
        return this.fromFixture(behavior.fixture);
      case "by-selected-root-cause": {
        const next =
          behavior.map[request.selectedRootCauseId] ??
          behavior.fallback ?? { kind: "fixture" as const, fixture: "unavailable" as const };
        return this.run(next, request);
      }
    }
  }

  private fromFixture(fixture: FakeReasoningFixture): ReasoningAssessment {
    switch (fixture) {
      case "timeout":
        return { status: "unavailable", reason: "timeout" };
      case "unavailable":
        return { status: "unavailable", reason: "provider-error" };
      case "invalid-assessment":
        return parseReasoningAssessment({ status: "ok", reasoningQuality: "maybe" });
      case "contradictory-explanation":
        // Intentionally contradictory: parse must reject this shape.
        return parseReasoningAssessment({
          status: "ok",
          reasoningQuality: "strong",
          evidenceRelevance: "irrelevant",
          explanationClarity: "clear",
          identifiedGaps: [],
          feedback: "Contradictory fixture.",
        });
      default:
        return FIXTURE_ASSESSMENTS[fixture];
    }
  }
}

/** @deprecated Prefer FakeReasoningEvaluator. Alias kept for earlier Phase C call sites. */
export const StubReasoningEvaluator = FakeReasoningEvaluator;
export type StubReasoningBehavior = FakeReasoningBehavior;

/** Shared no-op: reasoning unavailable, composer uses the deterministic result alone. */
export const unavailableReasoningEvaluator: ReasoningEvaluator = new FakeReasoningEvaluator("unavailable");
