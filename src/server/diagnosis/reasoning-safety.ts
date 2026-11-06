/*
 * Security and reliability guards for model-facing reasoning. Server-only.
 *
 * Applied before a prompt is built and after a model assessment is parsed.
 * Goals: bound payload size, strip control characters, and drop model text that
 * appears to echo answer-key vocabulary. These guards do not replace the
 * deterministic root-cause gate.
 */
import "server-only";
import type { ReasoningEvaluationRequest } from "./evaluator";
import type { ReasoningAssessment } from "./reasoning";

export const MAX_REASONING_EXPLANATION_CHARS = 2_000;
export const MAX_REASONING_EVIDENCE_ITEMS = 24;
export const MAX_REASONING_OPTIONS = 12;
export const MAX_REASONING_GAP_CHARS = 240;
export const MAX_REASONING_GAPS = 6;
export const MAX_REASONING_FEEDBACK_CHARS = 400;
export const MAX_EXCERPT_CHARS = 280;

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ANSWER_KEY_LEAK =
  /correctRootCauseId|resolutionSummary|keyObservations|keyEvidence|answerKey|learnerId|sessionId|attemptId|tokenHash|buglab_attempt|__Host-/i;

function cleanText(value: string, max: number): string {
  return value.replace(CONTROL, "").trim().slice(0, max);
}

/** Bounds and cleans a reasoning request before it is prompted. */
export function sanitizeReasoningRequest(request: ReasoningEvaluationRequest): ReasoningEvaluationRequest {
  return {
    challenge: {
      id: cleanText(request.challenge.id, 128),
      title: cleanText(request.challenge.title, 200),
      incident: cleanText(request.challenge.incident, 600),
    },
    rootCauseOptions: request.rootCauseOptions.slice(0, MAX_REASONING_OPTIONS).map((option) => ({
      id: cleanText(option.id, 128),
      label: cleanText(option.label, 200),
      description: cleanText(option.description, 600),
    })),
    selectedRootCauseId: cleanText(request.selectedRootCauseId, 128),
    explanation: cleanText(request.explanation, MAX_REASONING_EXPLANATION_CHARS),
    evidence: request.evidence.slice(0, MAX_REASONING_EVIDENCE_ITEMS).map((item) => ({
      kind: item.kind,
      id: cleanText(item.id, 128),
      excerpt: cleanText(item.excerpt, MAX_EXCERPT_CHARS),
    })),
  };
}

function safeLine(value: string, max: number): string | undefined {
  const cleaned = cleanText(value, max);
  if (!cleaned || ANSWER_KEY_LEAK.test(cleaned)) return undefined;
  return cleaned;
}

/**
 * Drops model text that looks like a secret leak. An empty or fully-redacted ok
 * assessment becomes unavailable rather than teaching the learner a poisoned hint.
 */
export function sanitizeReasoningAssessment(assessment: ReasoningAssessment): ReasoningAssessment {
  if (assessment.status !== "ok") return assessment;
  const feedback = safeLine(assessment.feedback, MAX_REASONING_FEEDBACK_CHARS);
  if (!feedback) return { status: "unavailable", reason: "invalid-response" };
  const identifiedGaps = assessment.identifiedGaps
    .slice(0, MAX_REASONING_GAPS)
    .map((gap) => safeLine(gap, MAX_REASONING_GAP_CHARS))
    .filter((gap): gap is string => gap !== undefined);
  return {
    status: "ok",
    reasoningQuality: assessment.reasoningQuality,
    evidenceRelevance: assessment.evidenceRelevance,
    explanationClarity: assessment.explanationClarity,
    identifiedGaps,
    feedback,
  };
}

/** True when an error message must not be shown or logged as-is. */
export function errorMessageLeaksSecret(message: string, apiKey?: string): boolean {
  if (apiKey && apiKey.length > 0 && message.includes(apiKey)) return true;
  return ANSWER_KEY_LEAK.test(message);
}
