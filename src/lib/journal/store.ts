/*
 * Where the journal lives. The rest of the app talks to JournalStore only, so
 * browser storage can later be replaced by an approved server API without
 * touching the UI.
 *
 * The local store keeps one versioned key in localStorage. Every storage call is
 * guarded: private modes, blocked site data and full storage turn into an
 * "unavailable" state or a failed save, never an exception in the page.
 */
import { EMPTY_JOURNAL, parseJournal, serializeJournal, type Journal } from "./model";

export const JOURNAL_STORAGE_KEY = "buglab.journal.v1";

export type JournalSnapshot =
  | { status: "unavailable"; journal: Journal }
  | { status: "ready"; journal: Journal; discarded: number; corrupt: boolean };

export type SaveResult = { ok: true } | { ok: false; reason: "unavailable" | "quota" | "failed" };

export interface JournalStore {
  read(): JournalSnapshot;
  write(journal: Journal): SaveResult;
  clear(): SaveResult;
  /** Calls back when another tab changes the journal. Returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface EventSource {
  addEventListener(type: "storage", listener: (event: { key: string | null }) => void): void;
  removeEventListener(type: "storage", listener: (event: { key: string | null }) => void): void;
}

export function createLocalJournalStore(options: {
  /** Returns the storage to use; it may throw, as window.localStorage does when blocked. */
  storage: () => StorageLike | null;
  events?: EventSource | null;
  published: ReadonlySet<string>;
}): JournalStore {
  const storage = (): StorageLike | null => {
    try {
      return options.storage();
    } catch {
      return null;
    }
  };

  // Snapshots are cached per stored text so repeated reads return the same object.
  let cachedText: string | null | undefined;
  let cached: JournalSnapshot | undefined;

  function read(): JournalSnapshot {
    const store = storage();
    if (!store) return UNAVAILABLE;
    let text: string | null;
    try {
      text = store.getItem(JOURNAL_STORAGE_KEY);
    } catch {
      return UNAVAILABLE;
    }
    if (cached && text === cachedText) return cached;
    const parsed = parseJournal(text, options.published);
    cachedText = text;
    cached = { status: "ready", ...parsed };
    return cached;
  }

  function attempt(action: (store: StorageLike) => void): SaveResult {
    const store = storage();
    if (!store) return { ok: false, reason: "unavailable" };
    try {
      action(store);
      return { ok: true };
    } catch (error) {
      const name = (error as { name?: string } | null)?.name ?? "";
      return { ok: false, reason: /quota/i.test(name) ? "quota" : "failed" };
    }
  }

  return {
    read,
    write: (journal) => attempt((store) => store.setItem(JOURNAL_STORAGE_KEY, serializeJournal(journal))),
    clear: () => attempt((store) => store.removeItem(JOURNAL_STORAGE_KEY)),
    subscribe(onChange) {
      const events = options.events;
      if (!events) return () => {};
      const listener = (event: { key: string | null }) => {
        if (event.key === null || event.key === JOURNAL_STORAGE_KEY) onChange();
      };
      events.addEventListener("storage", listener);
      return () => events.removeEventListener("storage", listener);
    },
  };
}

const UNAVAILABLE: JournalSnapshot = Object.freeze({ status: "unavailable", journal: EMPTY_JOURNAL }) as JournalSnapshot;
