import { EMPTY_RECORD, type LearningRecord } from "@/lib/learning/model";
import { DEFAULT_PREFERENCES, DISCONNECTED_HISTORY, type Candidate, type RecommendationInput, type RecommendationRequest } from "@/lib/recommendations/types";
export const NOW = "2026-11-06T12:00:00.000Z";
export const TODAY = "2026-11-06";
export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return { id: "challenge-a", number: "001", title: "A public investigation", description: "Investigate a learner-visible incident.", difficulty: "beginner", category: "api", tags: ["HTTP"], technologies: ["TypeScript"], estimatedMinutes: 15, publication: "published", available: true, completion: "diagnosis", ...overrides };
}
export function input(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return { now: NOW, today: TODAY, catalog: [candidate()], verified: DISCONNECTED_HISTORY, local: { status: "ready", solves: [], recalls: [], practiceRequests: [] }, preferences: { ...DEFAULT_PREFERENCES }, ...overrides };
}
export function request(overrides: Partial<RecommendationRequest> = {}): RecommendationRequest {
  return { version: 1, today: TODAY, preferences: { ...DEFAULT_PREFERENCES }, local: { status: "ready", solves: [], recalls: [], practiceRequests: [] }, ...overrides };
}
export function privateRecord(): LearningRecord {
  const id = "challenge-a";
  return { ...EMPTY_RECORD, solves: { [id]: { challengeId: id, firstSolvedAt: NOW, lastSolvedAt: NOW, timesSolved: 1, source: "browser" } }, reflections: { [id]: {
    challengeId: id, reflectedAt: NOW, updatedAt: NOW,
    reflection: { cause: "PRIVATE_WRITING", evidence: "PRIVATE_EVIDENCE", misunderstanding: "PRIVATE_MISUNDERSTANDING", nextTime: "PRIVATE_NEXT", takeaway: "PRIVATE_TAKEAWAY" },
    recall: { stage: 0, stageBefore: 0, dueOn: TODAY, lastReviewedOn: TODAY, attempts: [{ at: NOW, day: TODAY, response: "need-practice" }] },
  } }, practice: [] };
}