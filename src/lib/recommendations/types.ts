import type { CategoryId } from "@/types/catalog";
import type { Difficulty } from "@/types/workspace";
import type { VerifiedCompletion } from "@/lib/verified/model";

export const RECOMMENDATION_VERSION = 1;
export const RECOMMENDATION_PATH = "/api/recommendations/v1";
export const DIFFICULTIES: readonly Difficulty[] = ["beginner", "intermediate", "advanced"];
export const WEIGHTS = Object.freeze({ difficulty: 30, goal: 20, practice: 20, coverage: 15, continuity: 10, time: 5 });

/** Explicit public allow-list, never a scenario, session, reflection or grading object. */
export interface RecommendationChallenge {
  id: string;
  number: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  category: CategoryId;
  tags: readonly string[];
  technologies: readonly string[];
  estimatedMinutes: number;
}
export interface Candidate extends RecommendationChallenge {
  publication: "published" | "draft" | "archived";
  available: boolean;
  completion: "diagnosis" | "fix";
}
export interface Preferences {
  category: CategoryId | null;
  difficulty: Difficulty | null;
  minutes: number | null;
  allowStretch: boolean;
  useLocalSignals: boolean;
}
export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({ category: null, difficulty: null, minutes: null, allowStretch: false, useLocalSignals: true });
export interface LocalSignals {
  status: "ready" | "partial" | "unavailable";
  solves: readonly { challengeId: string; lastSolvedAt: string }[];
  recalls: readonly { challengeId: string; dueOn: string }[];
  practiceRequests: readonly string[];
}
export const NO_LOCAL_SIGNALS: Readonly<LocalSignals> = Object.freeze({ status: "unavailable", solves: [], recalls: [], practiceRequests: [] });
export type VerifiedHistory =
  | { status: "ready"; coverage: "complete" | "partial"; completions: readonly VerifiedCompletion[];
      /** Optional future trusted/version-matched facts. Never inferred from current catalog difficulty. */
      difficultyEvidence?: readonly { challengeId: string; contentVersion: string; difficulty: Difficulty }[] }
  | { status: "not-connected" | "no-learner" | "expired" | "unavailable" };
export const DISCONNECTED_HISTORY: VerifiedHistory = Object.freeze({ status: "not-connected" });
export interface RecommendationInput {
  now: string;
  today: string | null;
  catalog: readonly Candidate[];
  verified: VerifiedHistory;
  local: LocalSignals;
  preferences: Preferences;
}
export type Basis = "catalog" | "preference" | "browser-local" | "server-verified";
export type ReasonCode = "starting-point" | "difficulty-fit" | "goal-match" | "practice-request" | "coverage-opportunity" | "related-practice" | "fits-time" | "recall-due" | "path-variety";
export interface Reason {
  code: ReasonCode;
  basis: Basis;
  category?: CategoryId;
  difficulty?: Difficulty;
  completedCount?: number;
  availableCount?: number;
  dueOn?: string;
}
export type ScoreFactors = Record<keyof typeof WEIGHTS, number>;
export interface ChallengeRecommendation {
  kind: "challenge";
  challenge: RecommendationChallenge;
  score: number;
  factors: ScoreFactors;
  reasons: readonly Reason[];
}
export interface RecallRecommendation {
  kind: "recall";
  challenge: RecommendationChallenge;
  dueOn: string;
  overdueDays: number;
  reasons: readonly Reason[];
}
export type Notice = "completion-history-unavailable" | "partial-verified-history" | "local-data-unavailable" | "partial-local-data";
export interface RecommendationPlan {
  version: 1;
  strategy: "deterministic-v1";
  mode: "cold-start" | "personalized" | "limited-data";
  target: { difficulty: Difficulty; basis: "default" | "preference" | "verified-exposure" };
  evidence: { verified: VerifiedHistory["status"]; local: LocalSignals["status"] | "disabled" };
  availableCount: number;
  eligibleCount: number;
  next: ChallengeRecommendation | null;
  path: readonly ChallengeRecommendation[];
  practice: readonly ChallengeRecommendation[];
  recalls: readonly RecallRecommendation[];
  notices: readonly Notice[];
}
/** The public request can carry local observations only. Verified history is a server port. */
export interface RecommendationRequest {
  version: 1;
  today: string | null;
  preferences: Preferences;
  local: LocalSignals;
}
export interface RecommendationEngine {
  readonly strategy: string;
  recommend(input: RecommendationInput): RecommendationPlan;
}