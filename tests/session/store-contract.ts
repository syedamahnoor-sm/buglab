/*
 * The contract every SessionStore must satisfy. It is written only against the
 * SessionStore interface, so the in-memory store runs it today and a durable store
 * must run the same suite unchanged. All time arithmetic uses the policy the
 * harness reports, never a hard-coded duration.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExpiryPolicy } from "@/server/session/expiry";
import { issueSessionToken } from "@/server/session/token";
import {
  SessionStoreError,
  type SessionRecord,
  type SessionStore,
  type TokenHash,
} from "@/server/session/types";

export interface StoreHarness {
  store: SessionStore;
  /** The expiry policy the store was built with. */
  policy: ExpiryPolicy;
  /** The store's current time, in milliseconds since the epoch. */
  now(): number;
  /** Moves the store's clock forward. */
  advance(ms: number): void | Promise<void>;
}

const CHALLENGE_ID = "challenge-001";
const CHALLENGE_VERSION = "1";

async function startSession(harness: StoreHarness, challengeId = CHALLENGE_ID) {
  const { tokenHash } = issueSessionToken();
  const record = await harness.store.create({ tokenHash, challengeId, challengeVersion: CHALLENGE_VERSION });
  return { tokenHash, record };
}

function activeSession(lookup: Awaited<ReturnType<SessionStore["findByTokenHash"]>>): SessionRecord {
  assert.equal(lookup.state, "active");
  assert.ok(lookup.state === "active");
  return lookup.session;
}

/**
 * Moves the clock to exactly `target`, writing to the session along the way so it
 * never goes idle. Without this, a session left alone for months is long gone.
 */
async function keepAliveUntil(harness: StoreHarness, tokenHash: TokenHash, target: number) {
  const step = harness.policy.idleTtlMs / 2;
  while (harness.now() + step < target) {
    await harness.advance(step);
    const touch = await harness.store.touch(tokenHash, "write");
    assert.equal(touch.state, "active", "the session must stay alive on the way to the target");
  }
  await harness.advance(target - harness.now());
}

/** Calls a mutating function on a value the store returned. A frozen copy throws, a plain copy does not. */
function tryToMutate(value: object, changes: Record<string, unknown>) {
  try {
    Object.assign(value, changes);
  } catch {
    // Frozen copies reject the write. Either outcome is fine: what matters is the store.
  }
}

export function runSessionStoreContract(
  label: string,
  createHarness: () => StoreHarness | Promise<StoreHarness>,
): void {
  describe(`SessionStore contract: ${label}`, () => {
    describe("creation and lookup", () => {
      test("creates a session and finds it again as an equal but separate copy", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);

        const found = activeSession(await h.store.findByTokenHash(tokenHash));

        assert.deepEqual(found, record);
        assert.notEqual(found, record, "each call returns its own copy");
      });

      test("a new record carries the documented fields, with every time taken from creation", async () => {
        const h = await createHarness();
        const created = h.now();

        const { record } = await startSession(h);

        assert.equal(typeof record.id, "string");
        assert.ok(record.id.length > 0);
        assert.equal(record.challengeId, CHALLENGE_ID);
        assert.equal(record.challengeVersion, CHALLENGE_VERSION);
        assert.equal(record.revision, 0);
        assert.equal(record.createdAt, created);
        assert.equal(record.updatedAt, created);
        assert.equal(record.lastTouchedAt, created);
        assert.equal(record.idleExpiresAt, created + h.policy.idleTtlMs);
        assert.equal(record.absoluteExpiresAt, created + h.policy.absoluteTtlMs);
      });

      test("gives every session its own id", async () => {
        const h = await createHarness();

        const ids = new Set<string>();
        for (let i = 0; i < 20; i++) ids.add((await startSession(h)).record.id);

        assert.equal(ids.size, 20);
      });

      test("a record never contains the token hash or anything resembling a token", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        const found = activeSession(await h.store.findByTokenHash(tokenHash));

        for (const value of [record, found]) {
          assert.ok(!("tokenHash" in value) && !("token" in value));
          assert.ok(!JSON.stringify(value).includes(tokenHash));
        }
      });

      test("an unknown hash is reported as none by lookup and by touch", async () => {
        const h = await createHarness();
        const { tokenHash } = issueSessionToken();

        assert.deepEqual(await h.store.findByTokenHash(tokenHash), { state: "none" });
        assert.deepEqual(await h.store.touch(tokenHash, "read"), { state: "none" });
        assert.deepEqual(await h.store.touch(tokenHash, "write"), { state: "none" });
      });

      test("lookup does not change anything", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await h.advance(h.policy.touchIntervalMs * 3);

        const first = activeSession(await h.store.findByTokenHash(tokenHash));
        const second = activeSession(await h.store.findByTokenHash(tokenHash));

        assert.deepEqual(first, record);
        assert.deepEqual(second, record);
      });

      test("sessions are independent: touching one leaves another alone", async () => {
        const h = await createHarness();
        const a = await startSession(h);
        const b = await startSession(h);
        await h.advance(h.policy.touchIntervalMs * 2);

        await h.store.touch(a.tokenHash, "write");

        assert.deepEqual(activeSession(await h.store.findByTokenHash(b.tokenHash)), b.record);
      });
    });

    describe("rejected input", () => {
      test("rejects anything that is not a token hash, including a raw token", async () => {
        const h = await createHarness();
        const { token, tokenHash } = issueSessionToken();
        const bad = [token, tokenHash.toUpperCase(), tokenHash.slice(1), `${tokenHash}0`, "", "not a hash"];

        for (const value of bad) {
          const input = { tokenHash: value as TokenHash, challengeId: CHALLENGE_ID, challengeVersion: CHALLENGE_VERSION };
          await assert.rejects(h.store.create(input), (error: unknown) => error instanceof SessionStoreError && error.code === "invalid-input", `create ${value}`);
          await assert.rejects(h.store.findByTokenHash(value as TokenHash), SessionStoreError, `find ${value}`);
          await assert.rejects(h.store.touch(value as TokenHash, "read"), SessionStoreError, `touch ${value}`);
        }
      });

      test("rejects an empty challenge id or challenge version, and stores nothing", async () => {
        const h = await createHarness();
        const { tokenHash } = issueSessionToken();

        await assert.rejects(
          h.store.create({ tokenHash, challengeId: "", challengeVersion: CHALLENGE_VERSION }),
          (error: unknown) => error instanceof SessionStoreError && error.code === "invalid-input",
        );
        await assert.rejects(
          h.store.create({ tokenHash, challengeId: CHALLENGE_ID, challengeVersion: "" }),
          (error: unknown) => error instanceof SessionStoreError && error.code === "invalid-input",
        );
        assert.deepEqual(await h.store.findByTokenHash(tokenHash), { state: "none" });
      });

      test("refuses to create a second session for an existing hash, and leaves the first untouched", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await h.advance(h.policy.touchIntervalMs);

        await assert.rejects(
          h.store.create({ tokenHash, challengeId: "challenge-002", challengeVersion: "9" }),
          (error: unknown) => error instanceof SessionStoreError && error.code === "duplicate-token",
        );

        assert.deepEqual(activeSession(await h.store.findByTokenHash(tokenHash)), record);
      });
    });

    describe("idle expiry", () => {
      test("is active just before the idle deadline and expired from the deadline, with no record", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);

        await h.advance(record.idleExpiresAt - h.now() - 1);
        assert.equal((await h.store.findByTokenHash(tokenHash)).state, "active");

        await h.advance(1);
        const lookup = await h.store.findByTokenHash(tokenHash);
        assert.deepEqual(lookup, { state: "expired", by: "idle" });
        assert.ok(!("session" in lookup), "an expired session is reported without its data");
      });

      test("a write refreshes the idle expiry from now, and counts as a change", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await h.advance(Math.floor(h.policy.idleTtlMs / 3));
        const now = h.now();

        const touch = await h.store.touch(tokenHash, "write");

        assert.equal(touch.state, "active");
        assert.ok(touch.state === "active");
        assert.equal(touch.refreshed, true);
        assert.equal(touch.session.idleExpiresAt, now + h.policy.idleTtlMs);
        assert.equal(touch.session.lastTouchedAt, now);
        assert.equal(touch.session.updatedAt, now);
        assert.equal(touch.session.revision, 1);
        assert.equal(touch.session.createdAt, record.createdAt);
        assert.equal(touch.session.absoluteExpiresAt, record.absoluteExpiresAt, "the absolute expiry never moves");
        assert.deepEqual(activeSession(await h.store.findByTokenHash(tokenHash)), touch.session);
      });

      test("activity keeps a session alive past its original idle deadline", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await h.advance(h.policy.idleTtlMs - 1);
        await h.store.touch(tokenHash, "write");
        await h.advance(2);

        assert.ok(h.now() > record.idleExpiresAt);
        assert.equal((await h.store.findByTokenHash(tokenHash)).state, "active");
      });

      test("a read inside the touch interval changes nothing", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await h.advance(h.policy.touchIntervalMs - 1);

        const touch = await h.store.touch(tokenHash, "read");

        assert.ok(touch.state === "active");
        assert.equal(touch.refreshed, false);
        assert.deepEqual(touch.session, record);
        assert.deepEqual(activeSession(await h.store.findByTokenHash(tokenHash)), record);
      });

      test("a read refreshes once the touch interval has passed, then not again straight away", async () => {
        const h = await createHarness();
        const { tokenHash } = await startSession(h);
        await h.advance(h.policy.touchIntervalMs);

        const first = await h.store.touch(tokenHash, "read");
        const second = await h.store.touch(tokenHash, "read");

        assert.ok(first.state === "active" && second.state === "active");
        assert.equal(first.refreshed, true);
        assert.equal(first.session.revision, 1);
        assert.equal(first.session.idleExpiresAt, h.now() + h.policy.idleTtlMs);
        assert.equal(second.refreshed, false);
        assert.deepEqual(second.session, first.session);
      });
    });

    describe("absolute expiry", () => {
      test("activity never extends a session beyond its absolute expiry", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await keepAliveUntil(h, tokenHash, record.absoluteExpiresAt - h.policy.idleTtlMs / 2);

        const touch = await h.store.touch(tokenHash, "write");

        assert.ok(touch.state === "active");
        assert.equal(touch.session.idleExpiresAt, record.absoluteExpiresAt, "capped, not now + idle");
        assert.equal(touch.session.absoluteExpiresAt, record.absoluteExpiresAt);
      });

      test("a session that is kept busy still ends at the absolute deadline", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);

        // Touch every touch interval until the last instant before the deadline.
        while (h.now() + h.policy.touchIntervalMs < record.absoluteExpiresAt) {
          await h.advance(h.policy.touchIntervalMs);
          const touch = await h.store.touch(tokenHash, "write");
          assert.ok(touch.state === "active");
          assert.ok(touch.session.idleExpiresAt <= record.absoluteExpiresAt);
        }

        await h.advance(record.absoluteExpiresAt - h.now() - 1);
        assert.equal((await h.store.findByTokenHash(tokenHash)).state, "active");

        await h.advance(1);
        assert.deepEqual(await h.store.findByTokenHash(tokenHash), { state: "expired", by: "absolute" });
      });

      test("reports absolute when both limits have passed", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await keepAliveUntil(h, tokenHash, record.absoluteExpiresAt - 1);
        await h.store.touch(tokenHash, "write"); // idle expiry is now capped at the absolute expiry

        await h.advance(2);

        assert.ok(h.now() > record.absoluteExpiresAt);
        assert.deepEqual(await h.store.findByTokenHash(tokenHash), { state: "expired", by: "absolute" });
      });
    });

    describe("expired sessions", () => {
      test("cannot be revived by a write, a read, or creating the same hash again", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await h.advance(record.idleExpiresAt - h.now());

        assert.deepEqual(await h.store.touch(tokenHash, "write"), { state: "expired", by: "idle" });
        assert.deepEqual(await h.store.touch(tokenHash, "read"), { state: "expired", by: "idle" });
        await assert.rejects(
          h.store.create({ tokenHash, challengeId: CHALLENGE_ID, challengeVersion: CHALLENGE_VERSION }),
          (error: unknown) => error instanceof SessionStoreError && error.code === "duplicate-token",
        );
        assert.deepEqual(await h.store.findByTokenHash(tokenHash), { state: "expired", by: "idle" });
      });

      test("an absolutely expired session cannot be revived either", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await keepAliveUntil(h, tokenHash, record.absoluteExpiresAt);

        assert.equal(h.now(), record.absoluteExpiresAt);
        assert.deepEqual(await h.store.touch(tokenHash, "write"), { state: "expired", by: "absolute" });
        assert.deepEqual(await h.store.findByTokenHash(tokenHash), { state: "expired", by: "absolute" });
      });

      test("is reported as expired for the purge grace period, then as none, before any cleanup runs", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await h.advance(record.idleExpiresAt - h.now());

        await h.advance(h.policy.purgeGraceMs - 1);
        assert.deepEqual(await h.store.findByTokenHash(tokenHash), { state: "expired", by: "idle" });

        await h.advance(1);
        assert.deepEqual(await h.store.findByTokenHash(tokenHash), { state: "none" });
        assert.deepEqual(await h.store.touch(tokenHash, "write"), { state: "none" });
      });
    });

    describe("cleanup", () => {
      test("deletes sessions past the grace period and keeps active and in-grace sessions", async () => {
        const h = await createHarness();
        const old = await startSession(h);
        await h.advance(old.record.idleExpiresAt - h.now() + h.policy.purgeGraceMs); // old: past grace
        const inGrace = await startSession(h);
        await h.advance(inGrace.record.idleExpiresAt - h.now()); // inGrace: just expired
        const live = await startSession(h);

        assert.equal(await h.store.purgeExpired(), 1);

        assert.deepEqual(await h.store.findByTokenHash(old.tokenHash), { state: "none" });
        assert.deepEqual(await h.store.findByTokenHash(inGrace.tokenHash), { state: "expired", by: "idle" });
        assert.deepEqual(activeSession(await h.store.findByTokenHash(live.tokenHash)), live.record);
      });

      test("is repeatable: a second cleanup finds nothing more to delete", async () => {
        const h = await createHarness();
        const old = await startSession(h);
        await h.advance(old.record.absoluteExpiresAt - h.now() + h.policy.purgeGraceMs);

        assert.equal(await h.store.purgeExpired(), 1);
        assert.equal(await h.store.purgeExpired(), 0);
      });

      test("changes nothing when there is nothing to delete", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);

        assert.equal(await h.store.purgeExpired(), 0);

        assert.deepEqual(activeSession(await h.store.findByTokenHash(tokenHash)), record);
      });
    });

    describe("defensive copies", () => {
      test("changing a returned record does not change what the store holds", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        const expected = { ...record };

        tryToMutate(record, { idleExpiresAt: 0, absoluteExpiresAt: 0, challengeId: "tampered", revision: 99 });
        const found = activeSession(await h.store.findByTokenHash(tokenHash));
        tryToMutate(found, { idleExpiresAt: 0, challengeId: "tampered" });
        const touched = await h.store.touch(tokenHash, "write");
        assert.ok(touched.state === "active");
        tryToMutate(touched.session, { absoluteExpiresAt: 0 });

        const after = activeSession(await h.store.findByTokenHash(tokenHash));
        assert.equal(after.challengeId, expected.challengeId);
        assert.equal(after.absoluteExpiresAt, expected.absoluteExpiresAt);
        assert.ok(after.idleExpiresAt > 0);
        assert.notEqual(after.revision, 99);
      });

      test("changing a returned result object does not change later results", async () => {
        const h = await createHarness();
        const { tokenHash } = await startSession(h);

        const first = await h.store.findByTokenHash(tokenHash);
        tryToMutate(first, { state: "none" });
        const second = await h.store.findByTokenHash(tokenHash);

        assert.equal(second.state, "active");
      });
    });

    describe("concurrent operations", () => {
      test("many creates for different hashes all succeed and are all findable", async () => {
        const h = await createHarness();
        const issued = Array.from({ length: 50 }, () => issueSessionToken().tokenHash);

        const records = await Promise.all(
          issued.map((tokenHash) =>
            h.store.create({ tokenHash, challengeId: CHALLENGE_ID, challengeVersion: CHALLENGE_VERSION }),
          ),
        );

        assert.equal(new Set(records.map((record) => record.id)).size, 50);
        for (const [index, tokenHash] of issued.entries()) {
          assert.deepEqual(activeSession(await h.store.findByTokenHash(tokenHash)), records[index]);
        }
      });

      test("racing creates for the same hash produce exactly one session", async () => {
        const h = await createHarness();
        const { tokenHash } = issueSessionToken();

        const results = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            h.store.create({ tokenHash, challengeId: CHALLENGE_ID, challengeVersion: CHALLENGE_VERSION }),
          ),
        );

        const fulfilled = results.filter((result) => result.status === "fulfilled");
        const rejected = results.filter((result) => result.status === "rejected");
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 9);
        for (const result of rejected) {
          assert.ok(result.reason instanceof SessionStoreError && result.reason.code === "duplicate-token");
        }
        assert.equal((await h.store.findByTokenHash(tokenHash)).state, "active");
      });

      test("racing writes are all counted, and leave one consistent idle expiry", async () => {
        const h = await createHarness();
        const { tokenHash } = await startSession(h);
        await h.advance(h.policy.touchIntervalMs);

        const touches = await Promise.all(Array.from({ length: 20 }, () => h.store.touch(tokenHash, "write")));

        for (const touch of touches) assert.ok(touch.state === "active" && touch.refreshed);
        const final = activeSession(await h.store.findByTokenHash(tokenHash));
        assert.equal(final.revision, 20);
        assert.equal(final.idleExpiresAt, h.now() + h.policy.idleTtlMs);
        assert.deepEqual(
          touches.map((touch) => touch.state === "active" && touch.session.revision).sort((a, b) => Number(a) - Number(b)),
          Array.from({ length: 20 }, (_, index) => index + 1),
          "each write saw its own revision",
        );
      });

      test("racing reads refresh at most once per touch interval", async () => {
        const h = await createHarness();
        const { tokenHash } = await startSession(h);
        await h.advance(h.policy.touchIntervalMs);

        const touches = await Promise.all(Array.from({ length: 20 }, () => h.store.touch(tokenHash, "read")));

        const refreshed = touches.filter((touch) => touch.state === "active" && touch.refreshed);
        assert.equal(refreshed.length, 1);
        assert.equal(activeSession(await h.store.findByTokenHash(tokenHash)).revision, 1);
      });

      test("a cleanup racing with touches on an expired session never revives it", async () => {
        const h = await createHarness();
        const { tokenHash, record } = await startSession(h);
        await h.advance(record.idleExpiresAt - h.now());

        const results = await Promise.all([
          h.store.touch(tokenHash, "write"),
          h.store.purgeExpired(),
          h.store.touch(tokenHash, "read"),
          h.store.findByTokenHash(tokenHash),
        ]);

        assert.deepEqual(results[0], { state: "expired", by: "idle" });
        assert.deepEqual(results[2], { state: "expired", by: "idle" });
        assert.deepEqual(results[3], { state: "expired", by: "idle" });
        assert.deepEqual(await h.store.findByTokenHash(tokenHash), { state: "expired", by: "idle" });
      });
    });
  });
}
