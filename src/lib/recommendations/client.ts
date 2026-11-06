import { CATEGORY_IDS } from "@/data/catalog/categories";
import { DIFFICULTIES, RECOMMENDATION_PATH, type RecommendationPlan, type RecommendationRequest } from "./types";
import { isDay, isId, isRecord } from "./validation";

const REASONS = ["starting-point", "difficulty-fit", "goal-match", "practice-request", "coverage-opportunity", "related-practice", "fits-time", "recall-due", "path-variety"];
function challenge(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isId(value.id) && typeof value.title === "string" && value.title.length <= 80 && typeof value.description === "string"
    && typeof value.number === "string" && /^\d{3,9}$/.test(value.number) && CATEGORY_IDS.has(value.category as never)
    && DIFFICULTIES.includes(value.difficulty as never) && typeof value.estimatedMinutes === "number" && value.estimatedMinutes > 0
    && Array.isArray(value.tags) && value.tags.every((s) => typeof s === "string") && Array.isArray(value.technologies) && value.technologies.every((s) => typeof s === "string");
}
function reasons(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 8 && value.every((r) => isRecord(r) && REASONS.includes(String(r.code)) && ["catalog", "preference", "browser-local", "server-verified"].includes(String(r.basis))
    && (r.category === undefined || CATEGORY_IDS.has(r.category as never)) && (r.difficulty === undefined || DIFFICULTIES.includes(r.difficulty as never))
    && (r.dueOn === undefined || isDay(r.dueOn)) && (r.completedCount === undefined || Number.isInteger(r.completedCount)) && (r.availableCount === undefined || Number.isInteger(r.availableCount)));
}
function recommendation(value: unknown): boolean {
  return isRecord(value) && value.kind === "challenge" && challenge(value.challenge) && reasons(value.reasons)
    && typeof value.score === "number" && value.score >= 0 && value.score <= 100 && isRecord(value.factors)
    && ["difficulty", "goal", "practice", "coverage", "continuity", "time"].every((key) => typeof (value.factors as Record<string,unknown>)[key] === "number");
}
export function isRecommendationPlan(value: unknown): value is RecommendationPlan {
  return isRecord(value) && value.version === 1 && value.strategy === "deterministic-v1" && ["cold-start","personalized","limited-data"].includes(String(value.mode))
    && isRecord(value.target) && DIFFICULTIES.includes(value.target.difficulty as never) && ["default","preference","verified-exposure"].includes(String(value.target.basis))
    && isRecord(value.evidence) && ["ready","not-connected","no-learner","expired","unavailable"].includes(String(value.evidence.verified)) && ["ready","partial","unavailable","disabled"].includes(String(value.evidence.local))
    && typeof value.availableCount === "number" && typeof value.eligibleCount === "number" && (value.next === null || recommendation(value.next))
    && Array.isArray(value.path) && value.path.length <= 5 && value.path.every(recommendation)
    && Array.isArray(value.practice) && value.practice.length <= 3 && value.practice.every(recommendation)
    && Array.isArray(value.recalls) && value.recalls.length <= 100 && value.recalls.every((r) => isRecord(r) && r.kind === "recall" && challenge(r.challenge) && isDay(r.dueOn) && typeof r.overdueDays === "number" && r.overdueDays >= 0 && reasons(r.reasons))
    && Array.isArray(value.notices) && value.notices.every((n) => ["completion-history-unavailable","partial-verified-history","local-data-unavailable","partial-local-data"].includes(n));
}
/** No cookies, browser identifiers or private journal writing are sent by the initial integration. */
export async function loadRecommendations(input: RecommendationRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RecommendationPlan> {
  const response = await fetcher(RECOMMENDATION_PATH, { method: "POST", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal });
  if (!response.ok) throw new Error("Recommendations unavailable");
  const body: unknown = await response.json();
  if (!isRecommendationPlan(body)) throw new Error("Invalid recommendations response");
  return body;
}