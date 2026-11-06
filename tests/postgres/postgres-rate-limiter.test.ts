/*
 * The PostgreSQL rate limiter on a real database: the shared contract, then what only a real, shared database
 * can show: limits that hold across independent pools (each standing in for an application instance), across
 * a "restart", and under the database's own clock.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runRateLimiterContract, type LimiterHarness } from "../ratelimit/rate-limiter-contract";
import { SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const START = Date.parse("2026-11-01T10:00:00Z");
const POLICY = { limit: 5, windowMs: 60_000 };
const fixture = pgFixture();

async function postgresHarness(): Promise<LimiterHarness> {
  const pg = await fixture();
  await pg.reset();
  let now = START;
  return {
    limiter: pg.newLimiter({ now: () => now }),
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

if (SKIP) {
  describe("PostgresRateLimiter (real PostgreSQL)", { skip: SKIP }, () => {
    test("skipped: no database", () => {});
  });
} else {
  runRateLimiterContract("PostgresRateLimiter", postgresHarness);

  describe("PostgresRateLimiter: shared across independent instances", () => {
    test("three instances, each with its own pool and connections, share one limit", async () => {
      const pg = await fixture();
      await pg.reset();
      const instances = [1, 2, 3].map(() => {
        const pool = pg.newPool(5);
        return pg.newLimiter({}, pool);
      });

      // 90 simultaneous hits, spread over the three instances, against a limit of 5.
      const results = await Promise.all(Array.from({ length: 90 }, (_, i) => instances[i % 3].consume("scope", "one-client", POLICY)));

      assert.equal(results.filter((r) => r.allowed).length, POLICY.limit, "exactly the limit, across all instances together");
      const counts = results.filter((r) => r.allowed).map((r) => r.used).sort((a, b) => a - b);
      assert.deepEqual(counts, [1, 2, 3, 4, 5]);
    });

    test("one instance sees the hits another made, sequentially", async () => {
      const pg = await fixture();
      await pg.reset();
      const a = pg.newLimiter({}, pg.newPool(2));
      const b = pg.newLimiter({}, pg.newPool(2));

      for (let i = 0; i < POLICY.limit; i += 1) assert.equal((await a.consume("scope", "client", POLICY)).allowed, true);
      const refused = await b.consume("scope", "client", POLICY);

      assert.equal(refused.allowed, false);
      assert.ok(refused.retryAfterSeconds >= 1 && refused.retryAfterSeconds <= 60);
    });

    test("the limit survives the instances going away: a new pool picks up where the old one left off", async () => {
      const pg = await fixture();
      await pg.reset();
      const before = pg.newPool(2);
      const limiter = pg.newLimiter({}, before);
      for (let i = 0; i < POLICY.limit; i += 1) await limiter.consume("scope", "client", POLICY);
      await before.end();

      const after = pg.newLimiter({}, pg.newPool(2));
      assert.equal((await after.consume("scope", "client", POLICY)).allowed, false);
    });
  });

  describe("PostgresRateLimiter: the database's own clock", () => {
    test("windows are measured by the database, not the application's clock", async () => {
      const pg = await fixture();
      await pg.reset();
      const limiter = pg.newLimiter();
      const realNow = Date.now;
      try {
        // An application whose clock is wildly wrong must not change anything.
        Date.now = () => realNow() + 10 * 365 * 24 * 3_600_000;
        const first = await limiter.consume("scope", "client", { limit: 1, windowMs: 60_000 });
        Date.now = () => 0;
        const second = await limiter.consume("scope", "client", { limit: 1, windowMs: 60_000 });

        assert.equal(first.allowed, true);
        assert.equal(second.allowed, false, "still inside the database's window");
        assert.ok(Math.abs(first.resetsAt - (realNow() + 60_000)) < 10_000, "the window end is the database's time plus the window");
      } finally {
        Date.now = realNow;
      }
    });

    test("a real, short window really does end", async () => {
      const pg = await fixture();
      await pg.reset();
      const limiter = pg.newLimiter();
      const policy = { limit: 2, windowMs: 400 };

      assert.equal((await limiter.consume("scope", "client", policy)).allowed, true);
      assert.equal((await limiter.consume("scope", "client", policy)).allowed, true);
      assert.equal((await limiter.consume("scope", "client", policy)).allowed, false);
      await new Promise((resolve) => setTimeout(resolve, 600));

      const fresh = await limiter.consume("scope", "client", policy);
      assert.equal(fresh.allowed, true);
      assert.equal(fresh.used, 1);
    });

    test("purging removes ended windows on the database clock, in batches", async () => {
      const pg = await fixture();
      await pg.reset();
      const limiter = pg.newLimiter();
      // 2,500 short windows (more than two purge batches) plus one that must survive.
      await pg.newPool(1).query(
        `INSERT INTO rate_limit_buckets (scope, bucket_key, window_started_at, hits, expires_at)
         SELECT 'bulk', 'k' || n, 1, 1, 2 FROM generate_series(1, 2500) AS n`,
      );
      await limiter.consume("scope", "alive", { limit: 5, windowMs: 3_600_000 });

      assert.equal(await limiter.purgeExpired(), 2500);
      const { rows } = await pg.newPool(1).query("SELECT count(*)::int AS n FROM rate_limit_buckets");
      assert.equal(rows[0].n, 1);
    });
  });
}
