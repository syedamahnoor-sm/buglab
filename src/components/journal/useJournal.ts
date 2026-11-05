"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { EMPTY_JOURNAL, type Journal, type RecallResponse, type Reflection } from "@/lib/journal/model";
import { deleteEntry, recordRecall, ReflectionError, saveReflection } from "@/lib/journal/schedule";
import { createLocalJournalStore, type JournalSnapshot, type JournalStore, type SaveResult } from "@/lib/journal/store";

export type JournalState = { status: "loading"; journal: Journal } | JournalSnapshot;

export type ActionResult = { ok: true } | { ok: false; message: string };

const LOADING: JournalState = Object.freeze({ status: "loading", journal: EMPTY_JOURNAL }) as JournalState;

// One store per set of published ids, shared by every component on the page.
const stores = new Map<string, JournalStore>();
const listeners = new Set<() => void>();

function storeFor(publishedIds: readonly string[]): JournalStore {
  const key = [...publishedIds].sort().join(",");
  let store = stores.get(key);
  if (!store) {
    store = createLocalJournalStore({
      storage: () => (typeof window === "undefined" ? null : window.localStorage),
      events: typeof window === "undefined" ? null : window,
      published: new Set(publishedIds),
    });
    stores.set(key, store);
  }
  return store;
}

const failure = (result: SaveResult): string =>
  result.ok
    ? ""
    : result.reason === "quota"
      ? "Your browser's storage is full, so this could not be saved."
      : result.reason === "unavailable"
        ? "This browser is not letting BugLab save anything, so the journal is unavailable."
        : "This could not be saved. Please try again.";

/**
 * The learner's journal, kept in this browser. Every tab and component sees the
 * same data; a change in another tab is picked up automatically.
 */
export function useJournal(publishedIds: readonly string[]) {
  const store = useMemo(() => storeFor(publishedIds), [publishedIds]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      const unsubscribe = store.subscribe(onChange);
      return () => {
        listeners.delete(onChange);
        unsubscribe();
      };
    },
    [store],
  );
  const state = useSyncExternalStore<JournalState>(subscribe, store.read, () => LOADING);

  const commit = useCallback(
    (change: (journal: Journal) => Journal): ActionResult => {
      const current = store.read();
      if (current.status !== "ready") return { ok: false, message: failure({ ok: false, reason: "unavailable" }) };
      let next: Journal;
      try {
        next = change(current.journal);
      } catch (error) {
        if (error instanceof ReflectionError) return { ok: false, message: error.message };
        throw error;
      }
      const result = store.write(next);
      for (const listener of listeners) listener();
      return result.ok ? { ok: true } : { ok: false, message: failure(result) };
    },
    [store],
  );

  return {
    state,
    saveReflection: (challengeId: string, reflection: Partial<Reflection>) =>
      commit((journal) => saveReflection(journal, challengeId, reflection, new Date())),
    recordRecall: (challengeId: string, response: RecallResponse) =>
      commit((journal) => recordRecall(journal, challengeId, response, new Date())),
    deleteEntry: (challengeId: string) => commit((journal) => deleteEntry(journal, challengeId)),
    clear: (): ActionResult => {
      const result = store.clear();
      for (const listener of listeners) listener();
      return result.ok ? { ok: true } : { ok: false, message: failure(result) };
    },
  };
}
