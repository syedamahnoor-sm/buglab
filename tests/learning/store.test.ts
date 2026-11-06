/*
 * The local learning store: migration from the version 1 journal without
 * touching it, recovery copies before overwriting unreadable data, export,
 * storage failures and cross-tab updates. Uses an in-memory storage double.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EMPTY_RECORD, parseRecord, serializeRecord } from "@/lib/learning/model";
import { saveReflection } from "@/lib/learning/schedule";
import { recordObservedSolve } from "@/lib/learning/solves";
import { createLocalLearningStore, LEARNING_STORAGE_KEY, LEGACY_JOURNAL_KEY, RECOVERY_KEY_PREFIX, type StorageLike } from "@/lib/learning/store";

class MemoryStorage implements StorageLike {
  items = new Map<string, string>();
  /** Returns an error name to throw for a write to `key`, or null to let it succeed. */
  failWrites: (key: string) => string | null = () => null;
  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.items.set(key, value);
  }
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    const failure = this.failWrites(key);
    if (failure) {
      const error = new Error(failure);
      error.name = failure;
      throw error;
    }
    this.items.set(key, value);
  }
}

const NOW = new Date(2026, 10, 5, 10);
const record = () => saveReflection(recordObservedSolve(EMPTY_RECORD, "challenge-001", NOW), "challenge-001", { takeaway: "Keep the takeaway." }, NOW);
const V1 = JSON.stringify({
  version: 1,
  entries: {
    "challenge-016": {
      challengeId: "challenge-016",
      reflection: { evidence: "e", cause: "c", lookFor: "l", takeaway: "Aggregate after the join." },
      reflectedAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
      recall: { stage: 0, dueAt: "2026-11-02T10:00:00.000Z", attempts: [] },
    },
  },
});
const storeFor = (storage: MemoryStorage) => createLocalLearningStore({ storage: () => storage });

describe("reading", () => {
  test("nothing stored: an empty, ready record", () => {
    const snapshot = storeFor(new MemoryStorage()).read();
    assert.equal(snapshot.status, "ready");
    assert.ok(snapshot.status === "ready" && snapshot.origin === "empty" && snapshot.problems.length === 0);
  });

  test("a version 1 journal is migrated on read; the version 1 key is kept unchanged, even after saving", () => {
    const storage = new MemoryStorage({ [LEGACY_JOURNAL_KEY]: V1 });
    const store = storeFor(storage);
    const snapshot = store.read();
    assert.ok(snapshot.status === "ready" && snapshot.origin === "migrated-v1" && snapshot.hasLegacyJournal);
    assert.equal(snapshot.record.reflections["challenge-016"].reflection.takeaway, "Aggregate after the join.");
    assert.deepEqual(store.write(snapshot.record), { ok: true });
    assert.equal(storage.getItem(LEGACY_JOURNAL_KEY), V1, "the original stays byte for byte");
    const after = store.read();
    assert.ok(after.status === "ready" && after.origin === "stored" && after.hasLegacyJournal);
  });

  test("snapshots are cached until the stored data changes", () => {
    const storage = new MemoryStorage();
    const store = storeFor(storage);
    assert.equal(store.read(), store.read());
    store.write(record());
    assert.notEqual(store.read().record, EMPTY_RECORD);
  });

  test("blocked storage is 'unavailable', never an exception", () => {
    const store = createLocalLearningStore({
      storage: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    assert.equal(store.read().status, "unavailable");
    assert.deepEqual(store.write(record()), { ok: false, reason: "unavailable" });
    assert.equal(store.exportData(NOW), null);
  });
});

describe("never losing learner text", () => {
  test("unreadable stored text is copied to a recovery key before it is written over", () => {
    const storage = new MemoryStorage({ [LEARNING_STORAGE_KEY]: "{broken" });
    const store = storeFor(storage);
    const snapshot = store.read();
    assert.ok(snapshot.status === "ready" && snapshot.problems[0].kind === "unreadable");
    assert.deepEqual(store.write(record()), { ok: true });
    const recovery = [...storage.items.entries()].filter(([key]) => key.startsWith(RECOVERY_KEY_PREFIX));
    assert.equal(recovery.length, 1);
    assert.equal(recovery[0][1], "{broken");
    const after = store.read();
    assert.ok(after.status === "ready" && after.recoveryKeys.length === 1 && after.problems.length === 0);
  });

  test("a record with an invalid entry is copied before writing, so the unreadable entry is not lost", () => {
    const raw = JSON.parse(serializeRecord(record()));
    raw.reflections["challenge-002"] = { challengeId: "challenge-002", reflection: { takeaway: "lost?" } };
    const text = JSON.stringify(raw);
    const storage = new MemoryStorage({ [LEARNING_STORAGE_KEY]: text });
    storeFor(storage).write(parseRecord(text).record);
    assert.ok([...storage.items.values()].includes(text));
  });

  test("the same unreadable text is copied only once", () => {
    const storage = new MemoryStorage({ [LEARNING_STORAGE_KEY]: "{broken" });
    const store = storeFor(storage);
    store.write(record());
    storage.items.set(LEARNING_STORAGE_KEY, "{broken");
    store.write(record());
    assert.equal([...storage.items.keys()].filter((key) => key.startsWith(RECOVERY_KEY_PREFIX)).length, 1);
  });

  test("if the recovery copy cannot be saved, nothing is written over the original", () => {
    const storage = new MemoryStorage({ [LEARNING_STORAGE_KEY]: "{broken" });
    storage.failWrites = (key) => (key.startsWith(RECOVERY_KEY_PREFIX) ? "QuotaExceededError" : null);
    assert.deepEqual(storeFor(storage).write(record()), { ok: false, reason: "backup-failed" });
    assert.equal(storage.getItem(LEARNING_STORAGE_KEY), "{broken");
  });

  test("a full storage is reported as a quota failure", () => {
    const storage = new MemoryStorage();
    storage.failWrites = () => "QuotaExceededError";
    assert.deepEqual(storeFor(storage).write(record()), { ok: false, reason: "quota" });
  });

  test("export includes the record, the version 1 journal and every recovery copy", () => {
    const storage = new MemoryStorage({ [LEGACY_JOURNAL_KEY]: V1, [LEARNING_STORAGE_KEY]: "{broken" });
    const store = storeFor(storage);
    store.write(record());
    const exported = JSON.parse(store.exportData(NOW)!);
    assert.equal(exported.exportedAt, NOW.toISOString());
    assert.equal(exported[LEGACY_JOURNAL_KEY], V1);
    assert.deepEqual(JSON.parse(exported[LEARNING_STORAGE_KEY]), record());
    assert.deepEqual(Object.values(exported.recovery), ["{broken"]);
  });
});

describe("other tabs", () => {
  test("changes to learning keys notify; other keys do not; unsubscribe stops it", () => {
    const listeners = new Set<(event: { key: string | null }) => void>();
    const events = { addEventListener: (_: "storage", fn: (event: { key: string | null }) => void) => listeners.add(fn), removeEventListener: (_: "storage", fn: (event: { key: string | null }) => void) => listeners.delete(fn) };
    const store = createLocalLearningStore({ storage: () => new MemoryStorage(), events });
    let calls = 0;
    const off = store.subscribe(() => calls++);
    for (const key of [LEARNING_STORAGE_KEY, LEGACY_JOURNAL_KEY, `${RECOVERY_KEY_PREFIX}x`, null, "buglab.theme"]) listeners.forEach((fn) => fn({ key }));
    assert.equal(calls, 4);
    off();
    assert.equal(listeners.size, 0);
  });
});
