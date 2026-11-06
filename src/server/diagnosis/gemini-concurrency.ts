/*
 * In-process concurrency gate for Gemini provider calls. Server-only.
 *
 * This is not a second learner rate limiter. Attempt-window and IP limits already
 * bound submissions. This gate only caps simultaneous outbound provider calls so
 * a burst of distinct first-time submissions cannot open unbounded Gemini sockets.
 */
import "server-only";

export const DEFAULT_GEMINI_MAX_CONCURRENT = 4;
export const GEMINI_MAX_CONCURRENT_ENV = "GEMINI_MAX_CONCURRENT";

export class GeminiConcurrencyGate {
  private inFlight = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number = DEFAULT_GEMINI_MAX_CONCURRENT) {
    if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
      throw new Error("GeminiConcurrencyGate requires maxConcurrent >= 1.");
    }
    this.maxConcurrent = maxConcurrent;
  }

  get active(): number {
    return this.inFlight;
  }

  get limit(): number {
    return this.maxConcurrent;
  }

  /** Returns false when the call should be refused without contacting the provider. */
  tryEnter(): boolean {
    if (this.inFlight >= this.maxConcurrent) return false;
    this.inFlight += 1;
    return true;
  }

  leave(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }
}

export function parseGeminiMaxConcurrent(value: string | undefined, fallback = DEFAULT_GEMINI_MAX_CONCURRENT): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
