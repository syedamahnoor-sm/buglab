/*
 * The contract every DistributedRateLimiter must satisfy. Written only against the port, so the in-memory
 * limiter runs it without a database and the PostgreSQL limiter runs the same suite on a real one.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DistributedRateLimiter } from "@/server/ratelimit/types";

export interface LimiterHarness {
  limiter: DistributedRateLimiter;
  /** The limiter's current time, in milliseconds since the epoch. */
  now(): number;
  /** Moves the limiter's clock forward. */
  advance(ms: number): void;
}

const POLICY = { limit: 3, windowMs: 60_000 };
const SCOPE = "test:scope";

export function runRateLimiterContract(label: string, createHarness: () => LimiterHarness | Promise<LimiterHarness>): void {
  describe(`DistributedRateLimiter contract: ${label}`, () => {
    describe("counting", () => {
      test("the first hit is admitted and counted", async () => {
        const h = await createHarness();
        const result = await h.limiter.consume(SCOPE, "key-a", POLICY);
        assert.deepEqual({ ...result }, {
          allowed: true,
          used: 1,
          limit: 3,
          resetsAt: h.now() + POLICY.windowMs,
          retryAfterSeconds: 0,
        });
      });

      test("exactly `limit` hits are admitted in a window, and the next is refused", async () => {
        const h = await createHarness();
        const results = [];
        for (let i = 0; i < 5; i += 1) results.push(await h.limiter.consume(SCOPE, "key-a", POLICY));

        assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false, false]);
        assert.deepEqual(results.map((r) => r.used), [1, 2, 3, 3, 3], "used never exceeds the limit");
      });

      test("a refusal says how long to wait, in whole seconds and never less than one", async () => {
        const h = await createHarness();
        for (let i = 0; i < 3; i += 1) await h.limiter.consume(SCOPE, "key-a", POLICY);

        const refused = await h.limiter.consume(SCOPE, "key-a", POLICY);
        assert.equal(refused.allowed, false);
        assert.equal(refused.retryAfterSeconds, 60);

        h.advance(30_500);
        assert.equal((await h.limiter.consume(SCOPE, "key-a", POLICY)).retryAfterSeconds, 30, "29.5 seconds left rounds up to 30");

        h.advance(29_499);
        assert.equal((await h.limiter.consume(SCOPE, "key-a", POLICY)).retryAfterSeconds, 1, "1 ms left is still one second, never zero");
      });

      test("keys are independent of each other, and so are scopes", async () => {
        const h = await createHarness();
        for (let i = 0; i < 3; i += 1) await h.limiter.consume(SCOPE, "key-a", POLICY);

        assert.equal((await h.limiter.consume(SCOPE, "key-a", POLICY)).allowed, false);
        assert.equal((await h.limiter.consume(SCOPE, "key-b", POLICY)).allowed, true, "another key");
        assert.equal((await h.limiter.consume("other:scope", "key-a", POLICY)).allowed, true, "another scope");
      });
    });

    describe("the window", () => {
      test("a window lasts exactly windowMs: the instant it ends a new one starts", async () => {
        const h = await createHarness();
        for (let i = 0; i < 4; i += 1) await h.limiter.consume(SCOPE, "key-a", POLICY);

        h.advance(POLICY.windowMs - 1);
        assert.equal((await h.limiter.consume(SCOPE, "key-a", POLICY)).allowed, false, "1 ms before the end");

        h.advance(1);
        const fresh = await h.limiter.consume(SCOPE, "key-a", POLICY);
        assert.equal(fresh.allowed, true, "at the end");
        assert.equal(fresh.used, 1);
        assert.equal(fresh.resetsAt, h.now() + POLICY.windowMs, "a whole new window");
      });

      test("a refused hit does not extend the window, so retrying cannot keep a client locked out", async () => {
        const h = await createHarness();
        const first = await h.limiter.consume(SCOPE, "key-a", POLICY);
        for (let i = 0; i < 10; i += 1) {
          h.advance(5_000);
          await h.limiter.consume(SCOPE, "key-a", POLICY);
        }
        // 50 s in, hammering the whole time. The window is still the one that began at the first hit.
        h.advance(first.resetsAt - h.now());
        assert.equal((await h.limiter.consume(SCOPE, "key-a", POLICY)).allowed, true);
      });

      test("an ended window needs no purge to be ignored", async () => {
        const h = await createHarness();
        for (let i = 0; i < 4; i += 1) await h.limiter.consume(SCOPE, "key-a", POLICY);
        h.advance(POLICY.windowMs * 10);

        const result = await h.limiter.consume(SCOPE, "key-a", POLICY);
        assert.equal(result.allowed, true);
        assert.equal(result.used, 1);
      });
    });

    describe("purging", () => {
      test("deletes windows that have ended, keeps those still running, and reports how many", async () => {
        const h = await createHarness();
        await h.limiter.consume(SCOPE, "old-1", POLICY);
        await h.limiter.consume(SCOPE, "old-2", POLICY);
        h.advance(POLICY.windowMs - 1);
        await h.limiter.consume(SCOPE, "young", POLICY);
        h.advance(1);

        assert.equal(await h.limiter.purgeExpired(), 2);
        assert.equal(await h.limiter.purgeExpired(), 0, "nothing left to delete");

        // The young window survived the purge with its count intact.
        for (let i = 0; i < 2; i += 1) await h.limiter.consume(SCOPE, "young", POLICY);
        assert.equal((await h.limiter.consume(SCOPE, "young", POLICY)).allowed, false);
      });

      test("never changes what a later hit sees", async () => {
        const h = await createHarness();
        for (let i = 0; i < 3; i += 1) await h.limiter.consume(SCOPE, "key-a", POLICY);
        await h.limiter.purgeExpired();
        assert.equal((await h.limiter.consume(SCOPE, "key-a", POLICY)).allowed, false, "a running window is not purged");
      });
    });

    describe("rejected input", () => {
      test("refuses an empty or oversized scope or key, and an unusable policy", async () => {
        const h = await createHarness();
        const bad: [string, string, { limit: number; windowMs: number }][] = [
          ["", "k", POLICY],
          ["s".repeat(129), "k", POLICY],
          [SCOPE, "", POLICY],
          [SCOPE, "k".repeat(257), POLICY],
          [SCOPE, "k", { limit: 0, windowMs: 1000 }],
          [SCOPE, "k", { limit: 1.5, windowMs: 1000 }],
          [SCOPE, "k", { limit: 1_000_001, windowMs: 1000 }],
          [SCOPE, "k", { limit: 3, windowMs: 0 }],
          [SCOPE, "k", { limit: 3, windowMs: 1.5 }],
          [SCOPE, "k", { limit: 3, windowMs: Number.NaN }],
        ];
        for (const [scope, key, policy] of bad) {
          await assert.rejects(h.limiter.consume(scope, key, policy), TypeError, JSON.stringify([scope.length, key.length, policy]));
        }
        assert.equal((await h.limiter.consume(SCOPE, "k", POLICY)).used, 1, "and none of them counted");
      });
    });

    describe("concurrency", () => {
      test("simultaneous hits are admitted exactly `limit` times, never more", async () => {
        const h = await createHarness();
        const policy = { limit: 10, windowMs: 60_000 };
        const results = await Promise.all(Array.from({ length: 60 }, () => h.limiter.consume(SCOPE, "busy", policy)));

        assert.equal(results.filter((r) => r.allowed).length, 10);
        assert.equal(results.filter((r) => !r.allowed).length, 50);
        const admitted = results.filter((r) => r.allowed).map((r) => r.used).sort((a, b) => a - b);
        assert.deepEqual(admitted, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "each admitted hit saw a distinct count: no lost updates");
      });

      test("simultaneous hits on different keys do not interfere", async () => {
        const h = await createHarness();
        const policy = { limit: 2, windowMs: 60_000 };
        const keys = Array.from({ length: 8 }, (_, i) => `key-${i}`);
        const results = await Promise.all(keys.flatMap((key) => [1, 2, 3].map(() => h.limiter.consume(SCOPE, key, policy))));

        assert.equal(results.filter((r) => r.allowed).length, 16, "two per key");
      });
    });
  });
}
