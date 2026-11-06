import { CATEGORY_IDS } from "@/data/catalog/categories";
import { DEFAULT_PREFERENCES, DIFFICULTIES, NO_LOCAL_SIGNALS, type Preferences, type RecommendationRequest } from "./types";

export const MAX_REQUEST_BYTES = 32_768;
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const isId = (value: unknown): value is string => typeof value === "string" && value.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}
const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const difficulty = (value: unknown) => typeof value === "string" && (DIFFICULTIES as readonly string[]).includes(value);
export type ParseResult = { ok: true; value: RecommendationRequest } | { ok: false };
const invalid: ParseResult = { ok: false };

/** Strict, bounded allow-list: unknown fields are rejected, not silently accepted as authority. */
export function parseRecommendationRequest(raw: unknown): ParseResult {
  if (!isRecord(raw) || !only(raw, ["version", "today", "preferences", "local"]) || raw.version !== 1 || !(raw.today === null || isDay(raw.today))) return invalid;
  const p = raw.preferences;
  if (!isRecord(p) || !only(p, ["category", "difficulty", "minutes", "allowStretch", "useLocalSignals"])) return invalid;
  if (!(p.category === null || (typeof p.category === "string" && CATEGORY_IDS.has(p.category as Preferences["category"] & string)))) return invalid;
  if (!(p.difficulty === null || difficulty(p.difficulty))) return invalid;
  if (!(p.minutes === null || (typeof p.minutes === "number" && Number.isInteger(p.minutes) && p.minutes >= 5 && p.minutes <= 180))) return invalid;
  if (typeof p.allowStretch !== "boolean" || typeof p.useLocalSignals !== "boolean") return invalid;
  const local = raw.local;
  if (!isRecord(local) || !only(local, ["status", "solves", "recalls", "practiceRequests"]) || !["ready", "partial", "unavailable"].includes(String(local.status))) return invalid;
  if (!Array.isArray(local.solves) || local.solves.length > 300 || !Array.isArray(local.recalls) || local.recalls.length > 100 || !Array.isArray(local.practiceRequests) || local.practiceRequests.length > 100) return invalid;
  if (local.solves.some((entry) => !isRecord(entry) || !only(entry, ["challengeId", "lastSolvedAt"]) || !isId(entry.challengeId) || !isInstant(entry.lastSolvedAt))) return invalid;
  if (local.recalls.some((entry) => !isRecord(entry) || !only(entry, ["challengeId", "dueOn"]) || !isId(entry.challengeId) || !isDay(entry.dueOn))) return invalid;
  if (local.practiceRequests.some((entry) => !isId(entry))) return invalid;
  if (local.status === "unavailable" && (local.solves.length || local.recalls.length || local.practiceRequests.length)) return invalid;
  // Reconstruct: do not spread untrusted objects into the engine input.
  return { ok: true, value: {
    version: 1, today: raw.today as string | null,
    preferences: { category: p.category, difficulty: p.difficulty, minutes: p.minutes, allowStretch: p.allowStretch, useLocalSignals: p.useLocalSignals } as Preferences,
    local: {
      status: local.status as RecommendationRequest["local"]["status"],
      solves: local.solves.map((entry) => ({ challengeId: entry.challengeId as string, lastSolvedAt: entry.lastSolvedAt as string })),
      recalls: local.recalls.map((entry) => ({ challengeId: entry.challengeId as string, dueOn: entry.dueOn as string })),
      practiceRequests: [...local.practiceRequests] as string[],
    },
  } };
}

export function parseRecommendationQuery(params: URLSearchParams): ParseResult {
  const keys = ["today", "category", "difficulty", "minutes", "stretch"];
  if ([...params.keys()].some((key) => !keys.includes(key) || params.getAll(key).length !== 1)) return invalid;
  const stretch = params.get("stretch");
  if (stretch !== null && stretch !== "0" && stretch !== "1") return invalid;
  const minutes = params.get("minutes");
  if (minutes !== null && !/^\d{1,3}$/.test(minutes)) return invalid;
  return parseRecommendationRequest({ version: 1, today: params.get("today"), preferences: {
    ...DEFAULT_PREFERENCES, category: params.get("category"), difficulty: params.get("difficulty"),
    minutes: minutes === null ? null : Number(minutes), allowStretch: stretch === "1", useLocalSignals: false,
  }, local: NO_LOCAL_SIGNALS });
}