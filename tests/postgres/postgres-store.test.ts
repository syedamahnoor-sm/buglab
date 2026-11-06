/*
 * The PostgreSQL store against the SAME contract suites MemoryStore passes, unchanged, on a real PostgreSQL.
 * The contract files are imported, not copied: a behaviour the memory store guarantees and this one does not
 * is a failing test here.
 *
 * The suites move time forward, so the stores are built with the test-only clock override. Behaviour on the
 * database's own clock is covered separately in database-clock.test.ts.
 */
import { describe, test } from "node:test";
import { createExpiryPolicy, DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import { runAttemptStoreContract } from "../session/attempt-contract";
import { runSubmissionClaimContract } from "../session/submission-claim-contract";
import { runChallengeSessionStoreContract } from "../session/challenge-session-contract";
import { runLearnerStoreContract, type StoreHarness } from "../session/store-contract";
import { SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const START = Date.parse("2026-11-01T10:00:00Z");
const fixture = pgFixture();

async function postgresHarness(policy = DEFAULT_EXPIRY_POLICY): Promise<StoreHarness> {
  const pg = await fixture();
  await pg.reset();
  let now = START;
  return {
    store: pg.newStore({ policy, now: () => now }),
    policy,
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

const shortPolicy = () =>
  createExpiryPolicy({ idleTtlMs: 10_000, absoluteTtlMs: 25_000, touchIntervalMs: 1_000, purgeGraceMs: 4_000 });

if (SKIP) {
  describe("PostgresStore contract suites (real PostgreSQL)", { skip: SKIP }, () => {
    test("skipped: no database", () => {});
  });
} else {
  runLearnerStoreContract("PostgresStore", () => postgresHarness());
  runLearnerStoreContract("PostgresStore with a short policy", () => postgresHarness(shortPolicy()));
  runChallengeSessionStoreContract("PostgresStore", () => postgresHarness());
  runChallengeSessionStoreContract("PostgresStore with a short policy", () => postgresHarness(shortPolicy()));
  runAttemptStoreContract("PostgresStore", () => postgresHarness());
  runAttemptStoreContract("PostgresStore with a short policy", () => postgresHarness(shortPolicy()));
  runSubmissionClaimContract("PostgresStore", () => postgresHarness(), SKIP);
}
