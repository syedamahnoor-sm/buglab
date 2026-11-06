/*
 * Session-path composition for opt-in Gemini reasoning. Server-only.
 *
 * The live cookie diagnosis route is intentionally not wired here. Session
 * submissions already evaluate only after the Phase B claim/reserve win, so
 * duplicate replays do not invoke this evaluator.
 */
import "server-only";
import type { WorkspaceScenario } from "@/types/workspace";
import {
  deterministicDiagnosisEvaluator,
  type DiagnosisEvaluator,
} from "./evaluator";
import {
  createGeminiReasoningEvaluatorFromEnv,
  type GeminiGenerateContentClient,
  type GeminiOperationalEvent,
} from "./gemini-reasoning";
import { createComposedDiagnosisEvaluator } from "./verdict-composer";

export interface SessionGeminiEvaluatorOptions {
  /** Resolves the public scenario for a challenge. Must not return answer-key modules. */
  getPublicScenario: (challengeId: string) => WorkspaceScenario | undefined;
  env?: Record<string, string | undefined>;
  client?: GeminiGenerateContentClient;
  onEvent?: (event: GeminiOperationalEvent) => void;
}

/**
 * Returns a composed DiagnosisEvaluator when Gemini is explicitly enabled and keyed.
 * Otherwise returns the deterministic evaluator (default).
 */
export function resolveSessionDiagnosisEvaluator(options: SessionGeminiEvaluatorOptions): DiagnosisEvaluator {
  const reasoning = createGeminiReasoningEvaluatorFromEnv(options.env ?? process.env, {
    client: options.client,
    onEvent: options.onEvent,
  });
  if (!reasoning) return deterministicDiagnosisEvaluator;
  // Scenario is supplied per request by LearnerSessionService via getPublicScenario.
  return createComposedDiagnosisEvaluator({
    deterministic: deterministicDiagnosisEvaluator,
    reasoning,
  });
}
