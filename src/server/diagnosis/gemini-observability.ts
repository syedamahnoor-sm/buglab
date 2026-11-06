/*
 * Sanitized metrics and log shaping for Gemini reasoning. Server-only.
 *
 * Events never carry API keys, cookies, raw explanations, full prompts, or answer keys.
 */
import "server-only";
import type { GeminiOperationalEvent, GeminiProviderFailureKind } from "./gemini-reasoning";

export type GeminiMetricCounter =
  | "success"
  | "fallback"
  | "timeout"
  | "validation_failure"
  | "error"
  | "rate_limited"
  | "input_too_large";

export interface GeminiMetricsSnapshot {
  readonly provider: "gemini";
  readonly success: number;
  readonly fallback: number;
  readonly timeout: number;
  readonly validationFailure: number;
  readonly error: number;
  readonly rateLimited: number;
  readonly inputTooLarge: number;
  readonly inFlight: number;
  /** Mean duration of completed assess() calls in ms, or 0 when none. */
  readonly meanDurationMs: number;
}

const FORBIDDEN_LOG =
  /GEMINI_API_KEY|BUGLAB_GEMINI_API_KEY|correctRootCauseId|resolutionSummary|keyObservations|answerKey|tokenHash|__Host-|buglab_attempt/i;

/**
 * Process-local counters. Suitable for tests and single-instance ops mirrors.
 * Not a distributed metrics backend.
 */
export class GeminiMetrics {
  private success = 0;
  private fallback = 0;
  private timeout = 0;
  private validationFailure = 0;
  private error = 0;
  private rateLimited = 0;
  private inputTooLarge = 0;
  private inFlight = 0;
  private durationTotalMs = 0;
  private durationSamples = 0;

  begin(): void {
    this.inFlight += 1;
  }

  /** Records a completed assess() that held a concurrency slot. */
  end(event: GeminiOperationalEvent): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.record(event);
  }

  /** Records an outcome that never entered the provider (oversized input, etc.). */
  record(event: GeminiOperationalEvent): void {
    if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)) {
      this.durationTotalMs += Math.max(0, event.durationMs);
      this.durationSamples += 1;
    }
    switch (event.kind) {
      case "success":
        this.success += 1;
        break;
      case "timeout":
        this.timeout += 1;
        this.fallback += 1;
        break;
      case "invalid-response":
      case "input-too-large":
        this.validationFailure += 1;
        this.fallback += 1;
        if (event.kind === "input-too-large") this.inputTooLarge += 1;
        break;
      case "rate-limited":
        this.rateLimited += 1;
        this.fallback += 1;
        break;
      case "network":
      case "provider-error":
      case "disabled":
      case "missing-key":
        this.error += 1;
        this.fallback += 1;
        break;
    }
  }

  snapshot(): GeminiMetricsSnapshot {
    return {
      provider: "gemini",
      success: this.success,
      fallback: this.fallback,
      timeout: this.timeout,
      validationFailure: this.validationFailure,
      error: this.error,
      rateLimited: this.rateLimited,
      inputTooLarge: this.inputTooLarge,
      inFlight: this.inFlight,
      meanDurationMs: this.durationSamples === 0 ? 0 : Math.round(this.durationTotalMs / this.durationSamples),
    };
  }
}

/** Shared default metrics sink for the process. Tests may construct their own. */
export const defaultGeminiMetrics = new GeminiMetrics();

/**
 * Returns a JSON-safe, secret-free record suitable for structured logging.
 * Throws if the shaped payload would still contain a forbidden token.
 */
export function sanitizeGeminiLogFields(event: GeminiOperationalEvent): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {
    provider: "gemini",
    kind: event.kind,
  };
  if (event.model) fields.model = event.model;
  if (event.challengeId) fields.challengeId = event.challengeId;
  if (typeof event.status === "number") fields.status = event.status;
  if (typeof event.durationMs === "number") fields.durationMs = event.durationMs;
  if (typeof event.inFlight === "number") fields.inFlight = event.inFlight;
  const serialized = JSON.stringify(fields);
  if (FORBIDDEN_LOG.test(serialized)) {
    throw new Error("Gemini log fields would include a forbidden secret token.");
  }
  return fields;
}

/** Maps a failure kind onto the coarse metric bucket used in ops dashboards. */
export function metricBucketFor(kind: GeminiProviderFailureKind | "success"): GeminiMetricCounter {
  switch (kind) {
    case "success":
      return "success";
    case "timeout":
      return "timeout";
    case "invalid-response":
      return "validation_failure";
    case "input-too-large":
      return "input_too_large";
    case "rate-limited":
      return "rate_limited";
    default:
      return kind === "network" || kind === "provider-error" || kind === "disabled" || kind === "missing-key"
        ? "error"
        : "fallback";
  }
}
