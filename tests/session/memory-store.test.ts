import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { createExpiryPolicy, DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import { MemoryStore } from "@/server/session/memory-store";
import { issueSessionToken } from "@/server/session/token";
import { RESULT, runAttemptStoreContract } from "./attempt-contract";
import { runChallengeSessionStoreContract } from "./challenge-session-contract";
import { runLearnerStoreContract, type StoreHarness } from "./store-contract";

afterEach(() => mock.restoreAll());

const START = Date.parse("2026-11-01T10:00:00Z");
const WINDOW = { limit: 3, windowMs: 600_000 };

/** An in-memory store on a clock the test controls. */
function memoryHarness(policy = DEFAULT_EXPIRY_POLICY): StoreHarness {
  let now = START;
  const store = new MemoryStore({ policy, now: () => now });
  return {
    store,
    policy,
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

const shortPolicy = () =>
  createExpiryPolicy({ idleTtlMs: 10_000, absoluteTtlMs: 25_000, touchIntervalMs: 1_000, purgeGraceMs: 4_000 });

// The same suites a durable store must pass.
runLearnerStoreContract("MemoryStore", () => memoryHarness());
runLearnerStoreContract("MemoryStore with a short policy", () => memoryHarness(shortPolicy()));
runChallengeSessionStoreContract("MemoryStore", () => memoryHarness());
runChallengeSessionStoreContract("MemoryStore with a short policy", () => memoryHarness(shortPolicy()));
runAttemptStoreContract("MemoryStore", () => memoryHarness());
runAttemptStoreContract("MemoryStore with a short policy", () => memoryHarness(shortPolicy()));

describe("MemoryStore: what is stored", () => {
  test("holds only the token hash, never the raw token", async () => {
    const h = memoryHarness();
    const { token, tokenHash } = issueSessionToken();
    await h.store.create({ tokenHash });
    await h.store.touch(tokenHash, "write");

    const internals = (h.store as unknown as { learners: Map<string, unknown> }).learners;
    const everything = JSON.stringify([...internals.entries()]);

    assert.equal(internals.size, 1);
    assert.ok(everything.includes(tokenHash), "the hash is the key");
    assert.ok(!everything.includes(token), "the raw token is nowhere in the store");
  });

  test("the entries it keeps are never the objects it returns", async () => {
    const h = memoryHarness();
    const { tokenHash } = issueSessionToken();
    const learner = await h.store.create({ tokenHash });
    const { session } = await h.store.start({ learnerId: learner.id, challengeId: "challenge-001", challengeVersion: "1" });

    const internals = h.store as unknown as {
      learners: Map<string, object>;
      sessions: Map<string, object>;
    };

    assert.notEqual(internals.learners.get(tokenHash), learner);
    assert.notEqual(internals.sessions.get(session.id), session);
    assert.equal(Object.isFrozen(learner), true);
    assert.equal(Object.isFrozen(session), true);
  });

  test("exposes only the port operations, and no way to mark a session completed", () => {
    const privateHelpers = ["indexKey", "ownedSession", "removeLearnerData", "windowOf"];
    const methods = Object.getOwnPropertyNames(MemoryStore.prototype)
      .filter((name) => !privateHelpers.includes(name))
      .sort();

    assert.deepEqual(methods, [
      "constructor",
      "create",
      "find",
      "findByTokenHash",
      "list",
      "purgeExpired",
      "record",
      "restart",
      "start",
      "touch",
      "windowStatus",
    ]);
  });

  test("keeps no answer-key data: a stored attempt is the submission and its outcome, nothing derived from the key", async () => {
    const h = memoryHarness();
    const learner = await h.store.create({ tokenHash: issueSessionToken().tokenHash });
    const { session } = await h.store.start({ learnerId: learner.id, challengeId: "challenge-001", challengeVersion: "1" });
    await h.store.record({
      learnerId: learner.id,
      sessionId: session.id,
      submissionId: "submission-1",
      requestHash: "0".repeat(64),
      rootCauseId: "option-a",
      explanation: "An explanation.",
      evidence: [{ kind: "log", logId: "log-01" }],
      outcome: "incorrect",
      window: WINDOW,
    });

    const internals = h.store as unknown as { attempts: Map<string, object[]> };
    const stored = [...internals.attempts.values()].flat();

    assert.equal(stored.length, 1);
    assert.ok(
      Object.keys(stored[0]).every((key) => !/key|observation|resolution|feedback|hint/i.test(key)),
      "no stored field is derived from the answer key",
    );
  });
});

describe("MemoryStore: configuration", () => {
  test("uses the centralized default policy unless one is given", async () => {
    let now = START;
    const store = new MemoryStore({ now: () => now });
    const { tokenHash } = issueSessionToken();

    const record = await store.create({ tokenHash });
    now += 1;

    assert.equal(record.idleExpiresAt - record.createdAt, DEFAULT_EXPIRY_POLICY.idleTtlMs);
    assert.equal(record.absoluteExpiresAt - record.createdAt, DEFAULT_EXPIRY_POLICY.absoluteTtlMs);
  });

  test("rejects an incoherent policy when it is built", () => {
    assert.throws(() => new MemoryStore({ policy: { idleTtlMs: -1 } }), RangeError);
    assert.throws(
      () => new MemoryStore({ policy: { idleTtlMs: 100 * 86_400_000 } }),
      RangeError,
      "idle longer than absolute",
    );
  });

  test("works on the real clock when none is injected", async () => {
    const store = new MemoryStore();
    const { tokenHash } = issueSessionToken();

    const record = await store.create({ tokenHash });

    assert.ok(Math.abs(record.createdAt - Date.now()) < 5_000);
    assert.equal((await store.findByTokenHash(tokenHash)).state, "active");
  });

  test("takes internal ids from the injected generator, for learners, sessions and attempts", async () => {
    let counter = 0;
    const store = new MemoryStore({ newId: () => `id-${++counter}` });

    const learner = await store.create({ tokenHash: issueSessionToken().tokenHash });
    const { session } = await store.start({ learnerId: learner.id, challengeId: "c", challengeVersion: "1" });
    const result = await store.record({
      learnerId: learner.id,
      sessionId: session.id,
      submissionId: "s-1",
      requestHash: "0".repeat(64),
      rootCauseId: "option-a",
      explanation: "x",
      evidence: [],
      outcome: "incorrect",
      window: WINDOW,
    });

    assert.deepEqual([learner.id, session.id], ["id-1", "id-2"]);
    assert.ok(result.kind === "recorded" && result.attempt.id === "id-3");
  });

  test("two stores are independent: there is no shared global state", async () => {
    const first = memoryHarness();
    const second = memoryHarness();
    const { tokenHash } = issueSessionToken();

    await first.store.create({ tokenHash });

    assert.deepEqual(await second.store.findByTokenHash(tokenHash), { state: "none" });
  });
});

describe("MemoryStore: logging", () => {
  test("a full lifecycle writes nothing to the console", async () => {
    const calls = (["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
      mock.method(console, method, () => {}),
    );
    const h = memoryHarness();
    const { tokenHash } = issueSessionToken();

    const learner = await h.store.create({ tokenHash });
    const { session } = await h.store.start({ learnerId: learner.id, challengeId: "challenge-001", challengeVersion: "1" });
    const other = await h.store.start({ learnerId: learner.id, challengeId: "challenge-002", challengeVersion: "1" });
    await h.store.restart({ learnerId: learner.id, challengeId: "challenge-002", challengeVersion: "2", supersedes: other.session.id });
    await h.store.record({
      learnerId: learner.id,
      sessionId: session.id,
      submissionId: "submission-1",
      requestHash: "0".repeat(64),
      rootCauseId: "option-a",
      explanation: "x",
      evidence: [],
      outcome: "correct",
      result: RESULT,
      window: WINDOW,
    });
    await h.store.list({ learnerId: learner.id, sessionId: session.id });
    await h.store.findByTokenHash(tokenHash);
    await h.store.touch(tokenHash, "write");
    h.advance(DEFAULT_EXPIRY_POLICY.absoluteTtlMs + DEFAULT_EXPIRY_POLICY.purgeGraceMs);
    await h.store.touch(tokenHash, "write");
    await h.store.purgeExpired();
    await assert.rejects(h.store.findByTokenHash("nope" as never));

    assert.deepEqual(
      calls.map((call) => call.mock.callCount()),
      [0, 0, 0, 0, 0, 0],
    );
  });
});
