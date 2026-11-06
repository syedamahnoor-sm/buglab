/*
 * Completion reads: has this learner completed a challenge in a session that is still current?
 * Read-only over the existing ChallengeSessionStore, which only ever returns CURRENT (never
 * superseded) sessions. Each record is re-checked here so the rule holds even if a store ever
 * returns something looser.
 *
 * Rules: current (supersededAt unset) + status "completed" + a completion time.
 *   - eligibility for ONE challenge (reflection create): find()
 *   - every completion of the learner (activity feed): listCurrentCompleted(), ordered completedAt DESC, id ASC
 */
import "server-only";

import type { ChallengeSessionRecord, ChallengeSessionStore } from "../session/types";
import { compareText } from "./derive";

export type ReflectionEligibleSession = {
  sessionId: string;
  learnerId: string;
  challengeId: string;
  completedAt: number;
};

/** The completion a record stands for, or null if it is not a current completed session. */
function completionOf(record: ChallengeSessionRecord): ReflectionEligibleSession | null {
  if (record.status !== "completed" || record.supersededAt !== undefined || typeof record.completedAt !== "number") {
    return null;
  }
  return {
    sessionId: record.id,
    learnerId: record.learnerId,
    challengeId: record.challengeId,
    completedAt: record.completedAt,
  };
}

export async function findReflectionEligibleSession(
  sessions: Pick<ChallengeSessionStore, "find">,
  learnerId: string,
  challengeId: string,
): Promise<ReflectionEligibleSession | null> {
  const current = await sessions.find({ learnerId, challengeId });
  if (!current || current.learnerId !== learnerId || current.challengeId !== challengeId) return null;
  return completionOf(current);
}

/** Every current completion of the learner, newest first (completedAt DESC, id ASC). Another learner's record is never kept. */
export async function listCompletions(
  sessions: Pick<ChallengeSessionStore, "listCurrentCompleted">,
  learnerId: string,
): Promise<ReflectionEligibleSession[]> {
  const completions: ReflectionEligibleSession[] = [];
  for (const record of await sessions.listCurrentCompleted(learnerId)) {
    const completion = record.learnerId === learnerId ? completionOf(record) : null;
    if (completion) completions.push(completion);
  }
  return completions.sort((a, b) => b.completedAt - a.completedAt || compareText(a.sessionId, b.sessionId));
}
