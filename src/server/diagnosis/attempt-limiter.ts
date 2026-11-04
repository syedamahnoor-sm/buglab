/*
 * Fixed-window counter used to limit diagnosis attempts. Server-only.
 *
 * BEST-EFFORT, NOT PRODUCTION-GRADE: state lives in this process's memory,
 * so it resets on restart and is not shared across instances or serverless
 * invocations. Replace with a shared store (or the Challenge Engine) before
 * relying on it.
 */
import "server-only";

interface Window {
  count: number;
  startedAt: number;
}

export interface LimitStatus {
  used: number;
  limit: number;
  remaining: number;
  blocked: boolean;
  resetsAt?: number;
  retryAfterSeconds: number;
}

export interface FixedWindowLimiterOptions {
  limit: number;
  windowMs: number;
  /** Upper bound on tracked keys so unique keys can't grow memory forever. */
  maxEntries?: number;
  now?: () => number;
}

export class FixedWindowLimiter {
  readonly limit: number;
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, Window>();

  constructor({ limit, windowMs, maxEntries = 10_000, now = Date.now }: FixedWindowLimiterOptions) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  private active(key: string): Window | undefined {
    const window = this.windows.get(key);
    if (window && this.now() - window.startedAt >= this.windowMs) {
      this.windows.delete(key);
      return undefined;
    }
    return window;
  }

  status(key: string): LimitStatus {
    const window = this.active(key);
    const used = window?.count ?? 0;
    const resetsAt = window ? window.startedAt + this.windowMs : undefined;
    const blocked = used >= this.limit;
    return {
      used,
      limit: this.limit,
      remaining: Math.max(0, this.limit - used),
      blocked,
      resetsAt,
      retryAfterSeconds:
        blocked && resetsAt ? Math.max(1, Math.ceil((resetsAt - this.now()) / 1000)) : 0,
    };
  }

  increment(key: string): LimitStatus {
    const window = this.active(key);
    if (window) {
      window.count += 1;
    } else {
      this.prune();
      this.windows.set(key, { count: 1, startedAt: this.now() });
    }
    return this.status(key);
  }

  private prune() {
    if (this.windows.size < this.maxEntries) return;
    for (const key of [...this.windows.keys()]) this.active(key);
    // Still full: drop the oldest entries (Map preserves insertion order).
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxEntries) break;
      this.windows.delete(key);
    }
  }
}
