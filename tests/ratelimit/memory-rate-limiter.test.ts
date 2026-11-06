import { MemoryRateLimiter } from "@/server/ratelimit/memory-rate-limiter";
import { runRateLimiterContract, type LimiterHarness } from "./rate-limiter-contract";

const START = Date.parse("2026-11-01T10:00:00Z");

function memoryHarness(): LimiterHarness {
  let now = START;
  return {
    limiter: new MemoryRateLimiter({ now: () => now }),
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

// The same suite the PostgreSQL limiter runs on a real database (tests/postgres/postgres-rate-limiter.test.ts).
runRateLimiterContract("MemoryRateLimiter", memoryHarness);
