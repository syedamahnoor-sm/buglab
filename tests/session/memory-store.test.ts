import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { createExpiryPolicy, DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import { MemorySessionStore } from "@/server/session/memory-store";
import { issueSessionToken } from "@/server/session/token";
import { runSessionStoreContract, type StoreHarness } from "./store-contract";

afterEach(() => mock.restoreAll());

const START = Date.parse("2026-11-01T10:00:00Z");

/** An in-memory store on a clock the test controls. */
function memoryHarness(policy = DEFAULT_EXPIRY_POLICY): StoreHarness {
  let now = START;
  const store = new MemorySessionStore({ policy, now: () => now });
  return {
    store,
    policy,
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

// The same suite a durable store must pass.
runSessionStoreContract("MemorySessionStore", () => memoryHarness());
runSessionStoreContract("MemorySessionStore with a short policy", () =>
  memoryHarness(
    createExpiryPolicy({ idleTtlMs: 10_000, absoluteTtlMs: 25_000, touchIntervalMs: 1_000, purgeGraceMs: 4_000 }),
  ),
);

describe("MemorySessionStore: what is stored", () => {
  test("holds only the token hash, never the raw token", async () => {
    const h = memoryHarness();
    const { token, tokenHash } = issueSessionToken();
    await h.store.create({ tokenHash, challengeId: "challenge-001", challengeVersion: "1" });
    await h.store.touch(tokenHash, "write");

    const internals = (h.store as unknown as { entries: Map<string, unknown> }).entries;
    const everything = JSON.stringify([...internals.entries()]);

    assert.equal(internals.size, 1);
    assert.ok(everything.includes(tokenHash), "the hash is the key");
    assert.ok(!everything.includes(token), "the raw token is nowhere in the store");
  });

  test("the entries it keeps are never the objects it returns", async () => {
    const h = memoryHarness();
    const { tokenHash } = issueSessionToken();
    const record = await h.store.create({ tokenHash, challengeId: "challenge-001", challengeVersion: "1" });

    const internals = (h.store as unknown as { entries: Map<string, object> }).entries;

    assert.notEqual(internals.get(tokenHash), record);
    assert.equal(Object.isFrozen(record), true);
  });

  test("exposes only the SessionStore operations", () => {
    const methods = Object.getOwnPropertyNames(MemorySessionStore.prototype).sort();

    assert.deepEqual(methods, ["constructor", "create", "findByTokenHash", "purgeExpired", "touch"]);
  });
});

describe("MemorySessionStore: configuration", () => {
  test("uses the centralized default policy unless one is given", async () => {
    let now = START;
    const store = new MemorySessionStore({ now: () => now });
    const { tokenHash } = issueSessionToken();

    const record = await store.create({ tokenHash, challengeId: "challenge-001", challengeVersion: "1" });
    now += 1;

    assert.equal(record.idleExpiresAt - record.createdAt, DEFAULT_EXPIRY_POLICY.idleTtlMs);
    assert.equal(record.absoluteExpiresAt - record.createdAt, DEFAULT_EXPIRY_POLICY.absoluteTtlMs);
  });

  test("rejects an incoherent policy when it is built", () => {
    assert.throws(() => new MemorySessionStore({ policy: { idleTtlMs: -1 } }), RangeError);
    assert.throws(
      () => new MemorySessionStore({ policy: { idleTtlMs: 100 * 86_400_000 } }),
      RangeError,
      "idle longer than absolute",
    );
  });

  test("works on the real clock when none is injected", async () => {
    const store = new MemorySessionStore();
    const { tokenHash } = issueSessionToken();

    const record = await store.create({ tokenHash, challengeId: "challenge-001", challengeVersion: "1" });

    assert.ok(Math.abs(record.createdAt - Date.now()) < 5_000);
    assert.equal((await store.findByTokenHash(tokenHash)).state, "active");
  });

  test("takes internal ids from the injected generator", async () => {
    let counter = 0;
    const store = new MemorySessionStore({ newId: () => `id-${++counter}` });

    const a = await store.create({ tokenHash: issueSessionToken().tokenHash, challengeId: "c", challengeVersion: "1" });
    const b = await store.create({ tokenHash: issueSessionToken().tokenHash, challengeId: "c", challengeVersion: "1" });

    assert.deepEqual([a.id, b.id], ["id-1", "id-2"]);
  });

  test("two stores are independent: there is no shared global state", async () => {
    const first = memoryHarness();
    const second = memoryHarness();
    const { tokenHash } = issueSessionToken();

    await first.store.create({ tokenHash, challengeId: "challenge-001", challengeVersion: "1" });

    assert.deepEqual(await second.store.findByTokenHash(tokenHash), { state: "none" });
  });
});

describe("MemorySessionStore: logging", () => {
  test("a full session lifecycle writes nothing to the console", async () => {
    const calls = (["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
      mock.method(console, method, () => {}),
    );
    const h = memoryHarness();
    const { tokenHash } = issueSessionToken();

    await h.store.create({ tokenHash, challengeId: "challenge-001", challengeVersion: "1" });
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
