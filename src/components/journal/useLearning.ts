"use client";

import { useSyncExternalStore } from "react";
import { EMPTY_RECORD, type LearningRecord, type RecallResponse, type Reflection } from "@/lib/learning/model";
import { recordPracticeOpened } from "@/lib/learning/practice";
import { clearReflections, deleteReflection, recordRecall, ReflectionError, saveReflection } from "@/lib/learning/schedule";
import { recordObservedSolve, SolveError } from "@/lib/learning/solves";
import { createLocalLearningStore, type LearningSnapshot, type LearningStore, type SaveResult } from "@/lib/learning/store";

/*
 * The learner's learning record, kept in this browser. One store for the
 * page: every component sees the same data, and a change in another tab is
 * picked up automatically. Actions apply a pure change (lib/learning) and save.
 */

export type LearningState = { status: "loading"; record: LearningRecord } | LearningSnapshot;
export type ActionResult = { ok: true } | { ok: false; message: string };

export interface LearningActions {
  recordSolve(challengeId: string): ActionResult;
  saveReflection(challengeId: string, reflection: Partial<Reflection>): ActionResult;
  deleteReflection(challengeId: string): ActionResult;
  clearReflections(): ActionResult;
  recordRecall(challengeId: string, response: RecallResponse): ActionResult;
  recordPracticeOpened(fromChallengeId: string, toChallengeId: string): ActionResult;
  /** Everything stored for the Learning Loop, as JSON text, or null when storage is unavailable. */
  exportData(): string | null;
}

const LOADING: LearningState = Object.freeze({ status: "loading", record: EMPTY_RECORD }) as LearningState;

let store: LearningStore | null = null;
const listeners = new Set<() => void>();

function getStore(): LearningStore {
  store ??= createLocalLearningStore({
    storage: () => (typeof window === "undefined" ? null : window.localStorage),
    events: typeof window === "undefined" ? null : window,
  });
  return store;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const unsubscribe = getStore().subscribe(onChange);
  return () => {
    listeners.delete(onChange);
    unsubscribe();
  };
}

const read = () => getStore().read();

function failure(result: Exclude<SaveResult, { ok: true }>): string {
  switch (result.reason) {
    case "quota":
      return "Your browser's storage is full, so this could not be saved.";
    case "unavailable":
      return "This browser is not letting BugLab save anything, so the journal is unavailable.";
    case "backup-failed":
      return "Some saved journal data could not be read, and a safe copy of it could not be made, so nothing was changed. Download your data from the journal first.";
    default:
      return "This could not be saved. Please try again.";
  }
}

function commit(change: (record: LearningRecord) => LearningRecord): ActionResult {
  const current = read();
  if (current.status !== "ready") return { ok: false, message: failure({ ok: false, reason: "unavailable" }) };
  let next: LearningRecord;
  try {
    next = change(current.record);
  } catch (error) {
    if (error instanceof ReflectionError || error instanceof SolveError) return { ok: false, message: error.message };
    throw error;
  }
  if (next === current.record) return { ok: true };
  const result = getStore().write(next);
  for (const listener of listeners) listener();
  return result.ok ? { ok: true } : { ok: false, message: failure(result) };
}

export const learningActions: LearningActions = {
  recordSolve: (challengeId) => commit((record) => recordObservedSolve(record, challengeId, new Date())),
  saveReflection: (challengeId, reflection) => commit((record) => saveReflection(record, challengeId, reflection, new Date())),
  deleteReflection: (challengeId) => commit((record) => deleteReflection(record, challengeId)),
  clearReflections: () => commit((record) => clearReflections(record)),
  recordRecall: (challengeId, response) => commit((record) => recordRecall(record, challengeId, response, new Date())),
  recordPracticeOpened: (from, to) => commit((record) => recordPracticeOpened(record, from, to, new Date())),
  exportData: () => getStore().exportData(new Date()),
};

/** The learning record and the actions that change it. Loading until the browser has read storage. */
export function useLearning(): { state: LearningState; actions: LearningActions } {
  const state = useSyncExternalStore<LearningState>(subscribe, read, () => LOADING);
  return { state, actions: learningActions };
}
