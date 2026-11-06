/*
 * Where the learning record lives. The rest of the app talks to LearningStore
 * only, so browser storage can later be replaced by an approved server API
 * (Habin's backend) without touching the UI.
 *
 * The local store uses versioned keys in localStorage and never loses learner
 * text:
 *   buglab.learning.v2          the current record
 *   buglab.journal.v1           a Sprint 9B journal: read and migrated, never
 *                               modified or removed
 *   buglab.learning.recovery.*  copies of stored text that could not be read
 *                               faithfully, saved BEFORE anything is written
 *                               over it; if the copy cannot be saved, the write
 *                               is refused
 * Everything can be exported as one file. Every storage call is guarded:
 * private modes, blocked site data and full storage become an "unavailable"
 * state or a failed save, never an exception in the page.
 */
import { migrateJournalV1 } from "./migrate";
import { EMPTY_RECORD, parseRecord, serializeRecord, type LearningRecord, type ParseProblem } from "./model";

export const LEARNING_STORAGE_KEY = "buglab.learning.v2";
export const LEGACY_JOURNAL_KEY = "buglab.journal.v1";
export const RECOVERY_KEY_PREFIX = "buglab.learning.recovery.";

export type LearningSnapshot =
  | { status: "unavailable"; record: LearningRecord }
  | {
      status: "ready";
      record: LearningRecord;
      /** Where the record came from: nothing stored, the version 2 key, or a migrated version 1 journal. */
      origin: "empty" | "stored" | "migrated-v1";
      /** A version 1 journal exists in this browser (kept unchanged). */
      hasLegacyJournal: boolean;
      /** Problems reading the stored data; its original text is kept before any write. */
      problems: ParseProblem[];
      /** Recovery copies already saved in this browser. */
      recoveryKeys: string[];
    };

export type SaveResult = { ok: true } | { ok: false; reason: "unavailable" | "quota" | "failed" | "backup-failed" };

export interface LearningStore {
  read(): LearningSnapshot;
  write(record: LearningRecord): SaveResult;
  /** Everything this browser holds for the Learning Loop, as JSON, for the learner to download. */
  exportData(now: Date): string | null;
  /** Calls back when another tab changes the record. Returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly length: number;
  key(index: number): string | null;
}

interface EventSource {
  addEventListener(type: "storage", listener: (event: { key: string | null }) => void): void;
  removeEventListener(type: "storage", listener: (event: { key: string | null }) => void): void;
}

const relevant = (key: string | null) =>
  key === null || key === LEARNING_STORAGE_KEY || key === LEGACY_JOURNAL_KEY || key.startsWith(RECOVERY_KEY_PREFIX);

export function createLocalLearningStore(options: {
  /** Returns the storage to use; it may throw, as window.localStorage does when blocked. */
  storage: () => StorageLike | null;
  events?: EventSource | null;
}): LearningStore {
  const storage = (): StorageLike | null => {
    try {
      return options.storage();
    } catch {
      return null;
    }
  };

  function recoveryKeys(store: StorageLike): string[] {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (key?.startsWith(RECOVERY_KEY_PREFIX)) keys.push(key);
    }
    return keys.sort();
  }

  // Snapshots are cached per stored state so repeated reads return the same object.
  let cachedState: string | undefined;
  let cached: LearningSnapshot | undefined;

  function read(): LearningSnapshot {
    const store = storage();
    if (!store) return UNAVAILABLE;
    let current: string | null;
    let legacy: string | null;
    let recoveries: string[];
    try {
      current = store.getItem(LEARNING_STORAGE_KEY);
      legacy = store.getItem(LEGACY_JOURNAL_KEY);
      recoveries = recoveryKeys(store);
    } catch {
      return UNAVAILABLE;
    }
    const state = JSON.stringify([current, legacy, recoveries]);
    if (cached && state === cachedState) return cached;
    let snapshot: LearningSnapshot;
    if (current !== null && current !== "") {
      const parsed = parseRecord(current);
      snapshot = { status: "ready", record: parsed.record, origin: "stored", hasLegacyJournal: legacy !== null, problems: parsed.problems, recoveryKeys: recoveries };
    } else if (legacy !== null && legacy !== "") {
      const migrated = migrateJournalV1(legacy);
      // The version 1 key itself is the untouched original, so its problems need no extra copy.
      snapshot = { status: "ready", record: migrated.record, origin: "migrated-v1", hasLegacyJournal: true, problems: migrated.problems, recoveryKeys: recoveries };
    } else {
      snapshot = { status: "ready", record: EMPTY_RECORD, origin: "empty", hasLegacyJournal: false, problems: [], recoveryKeys: recoveries };
    }
    cachedState = state;
    cached = snapshot;
    return snapshot;
  }

  function failure(error: unknown): SaveResult {
    const name = (error as { name?: string } | null)?.name ?? "";
    return { ok: false, reason: /quota/i.test(name) ? "quota" : "failed" };
  }

  function write(record: LearningRecord): SaveResult {
    const store = storage();
    if (!store) return { ok: false, reason: "unavailable" };
    let current: string | null;
    try {
      current = store.getItem(LEARNING_STORAGE_KEY);
    } catch (error) {
      return failure(error);
    }
    // Never write over stored text that could not be read faithfully until a copy of it is safe.
    if (current && parseRecord(current).problems.length > 0) {
      let alreadyKept = false;
      try {
        alreadyKept = recoveryKeys(store).some((key) => store.getItem(key) === current);
      } catch {
        alreadyKept = false;
      }
      if (!alreadyKept) {
        try {
          store.setItem(`${RECOVERY_KEY_PREFIX}${new Date().toISOString()}`, current);
        } catch {
          return { ok: false, reason: "backup-failed" };
        }
      }
    }
    try {
      store.setItem(LEARNING_STORAGE_KEY, serializeRecord(record));
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  function exportData(now: Date): string | null {
    const store = storage();
    if (!store) return null;
    try {
      const keys = recoveryKeys(store);
      return JSON.stringify(
        {
          exportedAt: now.toISOString(),
          note: "BugLab Learning Journal, exported from this browser. Contains the learner's own reflections and recall history.",
          [LEARNING_STORAGE_KEY]: store.getItem(LEARNING_STORAGE_KEY),
          [LEGACY_JOURNAL_KEY]: store.getItem(LEGACY_JOURNAL_KEY),
          recovery: Object.fromEntries(keys.map((key) => [key, store.getItem(key)])),
        },
        null,
        2,
      );
    } catch {
      return null;
    }
  }

  return {
    read,
    write,
    exportData,
    subscribe(onChange) {
      const events = options.events;
      if (!events) return () => {};
      const listener = (event: { key: string | null }) => {
        if (relevant(event.key)) onChange();
      };
      events.addEventListener("storage", listener);
      return () => events.removeEventListener("storage", listener);
    },
  };
}

const UNAVAILABLE: LearningSnapshot = Object.freeze({ status: "unavailable", record: EMPTY_RECORD }) as LearningSnapshot;
