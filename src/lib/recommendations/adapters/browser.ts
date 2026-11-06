import type { LearningRecord } from "@/lib/learning/model";
import { dueReflections } from "@/lib/learning/schedule";
import { isDay, isId, isInstant } from "../validation";
import { NO_LOCAL_SIGNALS, type LocalSignals } from "../types";

/** Read-only projection. Learner writing, recall attempts, grading and action methods never leave this boundary. */
export function projectBrowserSignals(record: LearningRecord, today: string, status: LocalSignals["status"], publishedIds: ReadonlySet<string>): LocalSignals {
  if (!isDay(today) || status === "unavailable") return NO_LOCAL_SIGNALS;
  return {
    status,
    solves: Object.values(record.solves).filter((s) => publishedIds.has(s.challengeId) && isId(s.challengeId) && isInstant(s.lastSolvedAt)).slice(0,300)
      .map((s) => ({ challengeId: s.challengeId, lastSolvedAt: s.lastSolvedAt })),
    recalls: dueReflections(record,today).filter((r) => publishedIds.has(r.challengeId) && isId(r.challengeId) && isDay(r.recall.dueOn)).slice(0,100)
      .map((r) => ({ challengeId: r.challengeId, dueOn: r.recall.dueOn })),
    practiceRequests: Object.values(record.reflections).filter((r) => r.recall.attempts.at(-1)?.response === "need-practice" && publishedIds.has(r.challengeId) && isId(r.challengeId)).slice(0,100).map((r) => r.challengeId),
  };
}