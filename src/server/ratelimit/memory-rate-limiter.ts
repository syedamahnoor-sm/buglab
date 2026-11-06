/*
 * An in-memory DistributedRateLimiter. Server-only.
 *
 * DEVELOPMENT AND TEST ONLY. Despite implementing the "distributed" port, its counters live in
 * this process's memory: they are lost on restart and are not shared with any other process or
 * instance. It exists so code written against the port can run without a database, and so the
 * port's contract suite can be run against a second implementation. It is NOT durable and NOT
 * shared, and it must not be used where a limit has to hold across instances.
 */
import "server-only";
import {
  assertRateLimitInput,
  toRateLimitResult,
  type DistributedRateLimiter,
  type RateLimitPolicy,
  type RateLimitResult,
} from "./types";

interface Bucket {
  hits: number;
  expiresAt: number;
}

export class MemoryRateLimiter implements DistributedRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor({ now = Date.now }: { now?: () => number } = {}) {
    this.now = now;
  }

  async consume(scope: string, key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    assertRateLimitInput(scope, key, policy);
    const now = this.now();
    const id = JSON.stringify([scope, key]);
    const existing = this.buckets.get(id);

    let bucket: Bucket;
    if (existing && existing.expiresAt > now) {
      existing.hits = Math.min(existing.hits + 1, policy.limit + 1);
      bucket = existing;
    } else {
      bucket = { hits: 1, expiresAt: now + policy.windowMs };
      this.buckets.set(id, bucket);
    }
    return toRateLimitResult(bucket.hits, policy.limit, bucket.expiresAt, now);
  }

  async purgeExpired(): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const [id, bucket] of this.buckets) {
      if (bucket.expiresAt > now) continue;
      this.buckets.delete(id);
      removed += 1;
    }
    return removed;
  }
}
