import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EMPTY_JOURNAL } from "@/lib/journal/model";
import { saveReflection } from "@/lib/journal/schedule";
import { createLocalJournalStore, JOURNAL_STORAGE_KEY } from "@/lib/journal/store";

const PUBLISHED = new Set(["challenge-001"]);
const journal = saveReflection(EMPTY_JOURNAL, "challenge-001", { takeaway: "Read the right cookie jar." }, new Date("2026-11-05T10:00:00Z"));

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function quotaError() {
  const error = new Error("full");
  error.name = "QuotaExceededError";
  return error;
}

describe("the browser-local journal store", () => {
  test("reads, writes and clears one versioned key", () => {
    const storage = memoryStorage();
    const store = createLocalJournalStore({ storage: () => storage, published: PUBLISHED });
    assert.deepEqual(store.read(), { status: "ready", journal: EMPTY_JOURNAL, discarded: 0, corrupt: false });
    assert.deepEqual(store.write(journal), { ok: true });
    assert.ok(storage.data.has(JOURNAL_STORAGE_KEY));
    assert.deepEqual(store.read().journal, journal);
    assert.deepEqual(store.clear(), { ok: true });
    assert.equal(storage.data.size, 0);
  });

  test("repeated reads of unchanged storage return the same snapshot object", () => {
    const storage = memoryStorage();
    const store = createLocalJournalStore({ storage: () => storage, published: PUBLISHED });
    store.write(journal);
    assert.equal(store.read(), store.read());
  });

  test("blocked storage is 'unavailable', never an exception", () => {
    const blocked = createLocalJournalStore({ storage: () => { throw new Error("SecurityError"); }, published: PUBLISHED });
    assert.equal(blocked.read().status, "unavailable");
    assert.deepEqual(blocked.write(journal), { ok: false, reason: "unavailable" });
    const none = createLocalJournalStore({ storage: () => null, published: PUBLISHED });
    assert.equal(none.read().status, "unavailable");
    const throwingRead = createLocalJournalStore({ storage: () => ({ ...memoryStorage(), getItem: () => { throw new Error("denied"); } }), published: PUBLISHED });
    assert.equal(throwingRead.read().status, "unavailable");
  });

  test("a full storage is reported as quota; other write errors as failed", () => {
    const full = createLocalJournalStore({ storage: () => ({ ...memoryStorage(), setItem: () => { throw quotaError(); } }), published: PUBLISHED });
    assert.deepEqual(full.write(journal), { ok: false, reason: "quota" });
    const broken = createLocalJournalStore({ storage: () => ({ ...memoryStorage(), setItem: () => { throw new Error("boom"); } }), published: PUBLISHED });
    assert.deepEqual(broken.write(journal), { ok: false, reason: "failed" });
  });

  test("corrupted stored data reads as an empty journal marked corrupt", () => {
    const storage = memoryStorage();
    storage.setItem(JOURNAL_STORAGE_KEY, "{oops");
    const snapshot = createLocalJournalStore({ storage: () => storage, published: PUBLISHED }).read();
    assert.equal(snapshot.status, "ready");
    assert.equal(snapshot.status === "ready" && snapshot.corrupt, true);
  });

  test("another tab's change to the journal key notifies subscribers; other keys do not", () => {
    const handlers = new Set<(event: { key: string | null }) => void>();
    const events = {
      addEventListener: (_type: "storage", listener: (event: { key: string | null }) => void) => void handlers.add(listener),
      removeEventListener: (_type: "storage", listener: (event: { key: string | null }) => void) => void handlers.delete(listener),
    };
    const store = createLocalJournalStore({ storage: memoryStorage, events, published: PUBLISHED });
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    for (const handler of handlers) handler({ key: JOURNAL_STORAGE_KEY });
    for (const handler of handlers) handler({ key: "something-else" });
    for (const handler of handlers) handler({ key: null });
    assert.equal(calls, 2);
    unsubscribe();
    assert.equal(handlers.size, 0);
  });
});
