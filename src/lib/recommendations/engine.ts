import { CATEGORY_IDS } from "@/data/catalog/categories";
import { daysBetween } from "@/lib/learning/days";
import { isDay, isId, isInstant } from "./validation";
import { DIFFICULTIES, NO_LOCAL_SIGNALS, WEIGHTS, type Candidate, type ChallengeRecommendation, type RecommendationChallenge, type RecommendationInput, type RecommendationPlan, type Reason, type ScoreFactors } from "./types";

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const order = (a: RecommendationChallenge, b: RecommendationChallenge) => Number(a.number) - Number(b.number) || compareText(a.id, b.id);
const rank = (a: ChallengeRecommendation, b: ChallengeRecommendation) => b.score - a.score || order(a.challenge, b.challenge);

/** Explicit projection is also used for all responses: no input extras can escape. */
export function publicMetadata(c: RecommendationChallenge): RecommendationChallenge {
  return { id: c.id, number: c.number, title: c.title, description: c.description, category: c.category, difficulty: c.difficulty,
    tags: [...c.tags], technologies: [...c.technologies], estimatedMinutes: c.estimatedMinutes };
}
export function eligibleCatalog(catalog: readonly Candidate[]): Candidate[] {
  const valid = catalog.filter((c) => c.publication === "published" && c.available === true && c.completion === "diagnosis" && isId(c.id)
    && /^\d{3,}$/.test(c.number) && c.number.length <= 9 && typeof c.title === "string" && c.title.length > 0
    && typeof c.description === "string" && CATEGORY_IDS.has(c.category) && DIFFICULTIES.includes(c.difficulty)
    && Number.isFinite(c.estimatedMinutes) && c.estimatedMinutes > 0
    && Array.isArray(c.tags) && c.tags.every((tag) => typeof tag === "string")
    && Array.isArray(c.technologies) && c.technologies.every((tech) => typeof tech === "string"));
  // Ambiguous duplicate IDs are excluded rather than depending on input order.
  const counts = new Map<string, number>();
  for (const c of valid) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  return valid.filter((c) => counts.get(c.id) === 1).sort(order);
}

function targetDifficulty(input: RecommendationInput, completed: ReadonlyMap<string, { contentVersion: string }>): RecommendationPlan["target"] {
  if (input.preferences.difficulty) return { difficulty: input.preferences.difficulty, basis: "preference" };
  if (input.preferences.allowStretch && input.verified.status === "ready") {
    const evidence = new Map<string, typeof DIFFICULTIES[number]>();
    const ambiguous = new Set<string>();
    for (const e of input.verified.difficultyEvidence ?? []) {
      if (completed.get(e.challengeId)?.contentVersion !== e.contentVersion || !DIFFICULTIES.includes(e.difficulty)) continue;
      const previous = evidence.get(e.challengeId);
      if (previous && previous !== e.difficulty) ambiguous.add(e.challengeId);
      evidence.set(e.challengeId,e.difficulty);
    }
    for (const id of ambiguous) evidence.delete(id);
    // Exposure heuristic, never proficiency. No version-specific evidence means no automatic promotion.
    if ([...evidence.values()].filter((d) => d === "intermediate").length >= 3) return { difficulty: "advanced", basis: "verified-exposure" };
    if ([...evidence.values()].filter((d) => d === "beginner").length >= 3) return { difficulty: "intermediate", basis: "verified-exposure" };
  }
  return { difficulty: "beginner", basis: "default" };
}

export function recommend(input: RecommendationInput): RecommendationPlan {
  if (!isInstant(input.now) || (input.today !== null && !isDay(input.today))) throw new Error("Invalid recommendation clock");
  const catalog = eligibleCatalog(input.catalog);
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const verified = new Map<string, { challengeId: string; completedAt: string; contentVersion: string }>();
  if (input.verified.status === "ready") for (const c of input.verified.completions) {
    if (!byId.has(c.challengeId) || !isInstant(c.completedAt) || typeof c.contentVersion !== "string" || !c.contentVersion) continue;
    const old = verified.get(c.challengeId);
    const delta = old ? Date.parse(c.completedAt)-Date.parse(old.completedAt) : -1;
    if (!old || delta < 0 || (delta === 0 && (compareText(c.contentVersion,old.contentVersion) || compareText(c.completedAt,old.completedAt)) < 0)) verified.set(c.challengeId, { challengeId: c.challengeId, completedAt: c.completedAt, contentVersion: c.contentVersion });
  }
  const local = input.preferences.useLocalSignals && input.local.status !== "unavailable" ? input.local : NO_LOCAL_SIGNALS;
  const browser = new Map<string, { challengeId: string; lastSolvedAt: string }>();
  for (const solve of local.solves) {
    if (!byId.has(solve.challengeId) || !isInstant(solve.lastSolvedAt)) continue;
    const old = browser.get(solve.challengeId);
    const delta = old ? Date.parse(solve.lastSolvedAt)-Date.parse(old.lastSolvedAt) : 1;
    if (!old || delta > 0 || (delta === 0 && compareText(solve.lastSolvedAt,old.lastSolvedAt) < 0)) browser.set(solve.challengeId, { challengeId: solve.challengeId, lastSolvedAt: solve.lastSolvedAt });
  }
  const target = targetDifficulty(input, verified);
  const targetIndex = DIFFICULTIES.indexOf(target.difficulty);
  // An evidence-based step-up is already the optional stretch; do not jump two tiers at once.
  const maxTier = targetIndex + (input.preferences.allowStretch && target.basis !== "verified-exposure" ? 1 : 0);
  const verifiedCoverage = input.verified.status === "ready" && input.verified.coverage === "complete";
  const coverageBasis = verifiedCoverage ? "server-verified" as const : local.status === "ready" ? "browser-local" as const : null;
  const coveredIds = verifiedCoverage ? new Set(verified.keys()) : new Set(browser.keys());
  const practiceCategories = new Set(local.practiceRequests.flatMap((id) => byId.has(id) ? [byId.get(id)!.category] : []));
  const recentServer = [...verified.values()].filter((e) => Date.parse(e.completedAt) <= Date.parse(input.now)).sort((a,b) => Date.parse(b.completedAt)-Date.parse(a.completedAt) || compareText(a.challengeId,b.challengeId))[0];
  const recentBrowser = [...browser.values()].filter((e) => Date.parse(e.lastSolvedAt) <= Date.parse(input.now)).sort((a,b) => Date.parse(b.lastSolvedAt)-Date.parse(a.lastSolvedAt) || compareText(a.challengeId,b.challengeId))[0];
  const recent = recentServer ? { challenge: byId.get(recentServer.challengeId)!, basis: "server-verified" as const }
    : recentBrowser ? { challenge: byId.get(recentBrowser.challengeId)!, basis: "browser-local" as const } : null;
  const hasPreferences = !!(input.preferences.category || input.preferences.difficulty || input.preferences.minutes || input.preferences.allowStretch);
  const hasSignals = verified.size > 0 || browser.size > 0 || local.recalls.length > 0 || practiceCategories.size > 0;
  const ranked = catalog.filter((c) => !verified.has(c.id) && !browser.has(c.id)
      && DIFFICULTIES.indexOf(c.difficulty) <= maxTier)
    .map((c): ChallengeRecommendation => {
      const factors: ScoreFactors = { difficulty: 0, goal: 0, practice: 0, coverage: 0, continuity: 0, time: 0 };
      const reasons: Reason[] = [];
      const delta = DIFFICULTIES.indexOf(c.difficulty) - targetIndex;
      factors.difficulty = delta === 0 ? WEIGHTS.difficulty : delta < 0 ? 15 : 5;
      reasons.push({ code: "difficulty-fit", basis: input.preferences.difficulty ? "preference" : "catalog", difficulty: c.difficulty });
      if (!hasSignals && !hasPreferences) reasons.unshift({ code: "starting-point", basis: "catalog" });
      if (input.preferences.category === c.category) {
        factors.goal = WEIGHTS.goal; reasons.push({ code: "goal-match", basis: "preference", category: c.category });
      }
      if (practiceCategories.has(c.category)) {
        factors.practice = WEIGHTS.practice; reasons.push({ code: "practice-request", basis: "browser-local", category: c.category });
      }
      if (coverageBasis) {
        const availableCount = catalog.filter((other) => other.category === c.category).length;
        const completedCount = catalog.filter((other) => other.category === c.category && coveredIds.has(other.id)).length;
        factors.coverage = Math.floor(WEIGHTS.coverage * (availableCount - completedCount) / availableCount);
        if (factors.coverage && hasSignals) reasons.push({ code: "coverage-opportunity", basis: coverageBasis, category: c.category, completedCount, availableCount });
      }
      if (recent && (recent.challenge.category === c.category || c.tags.some((tag) => recent.challenge.tags.some((other) => tag.toLowerCase() === other.toLowerCase())))) {
        factors.continuity = WEIGHTS.continuity; reasons.push({ code: "related-practice", basis: recent.basis });
      }
      if (input.preferences.minutes !== null && c.estimatedMinutes <= input.preferences.minutes) {
        factors.time = WEIGHTS.time; reasons.push({ code: "fits-time", basis: "preference" });
      }
      return { kind: "challenge", challenge: publicMetadata(c), factors, score: Object.values(factors).reduce((a,b) => a+b,0), reasons };
    }).sort(rank);
  const path: ChallengeRecommendation[] = [];
  const pool = [...ranked];
  while (path.length < 5 && pool.length) {
    const selectedCount = (item: ChallengeRecommendation) => path.filter((step) => step.challenge.category === item.challenge.category).length;
    pool.sort((a,b) => {
      const adjustment = (item: ChallengeRecommendation) => item.score - (!input.preferences.category ? Math.min(20,selectedCount(item)*10) : 0);
      return adjustment(b) - adjustment(a) || rank(a,b);
    });
    const selected = pool.shift()!;
    const reasons: readonly Reason[] = !input.preferences.category && path.length > 0 && selectedCount(selected) === 0
      ? [...selected.reasons,{ code: "path-variety",basis: "catalog",category: selected.challenge.category }] : selected.reasons;
    path.push({ ...selected,reasons });
  }
  // Practice highlights reference steps already in the path: at most five distinct new-work IDs overall.
  const practice = path.slice(1).sort((a,b) => b.factors.practice - a.factors.practice || b.factors.coverage - a.factors.coverage || rank(a,b)).slice(0,3);
  const recallMap = new Map<string, string>();
  if (input.today) for (const recall of local.recalls) {
    if (!byId.has(recall.challengeId) || !isDay(recall.dueOn) || recall.dueOn > input.today) continue;
    const old = recallMap.get(recall.challengeId);
    if (!old || recall.dueOn < old) recallMap.set(recall.challengeId, recall.dueOn);
  }
  const recalls = [...recallMap].sort((a,b) => compareText(a[1],b[1]) || order(byId.get(a[0])!,byId.get(b[0])!)).map(([id,dueOn]) => ({
    kind: "recall" as const, challenge: publicMetadata(byId.get(id)!), dueOn,
    overdueDays: daysBetween(dueOn,input.today!), reasons: [{ code: "recall-due" as const, basis: "browser-local" as const, dueOn }],
  }));
  const notices: RecommendationPlan["notices"][number][] = [];
  if (input.verified.status !== "ready") notices.push("completion-history-unavailable");
  else if (input.verified.coverage === "partial") notices.push("partial-verified-history");
  if (input.preferences.useLocalSignals && local.status === "unavailable") notices.push("local-data-unavailable");
  if (local.status === "partial") notices.push("partial-local-data");
  return { version: 1, strategy: "deterministic-v1", mode: !hasSignals && !hasPreferences ? "cold-start" : verifiedCoverage ? "personalized" : "limited-data",
    target, evidence: { verified: input.verified.status, local: input.preferences.useLocalSignals ? local.status : "disabled" },
    availableCount: catalog.length, eligibleCount: ranked.length, next: path[0] ?? null, path, practice, recalls, notices };
}
export const deterministicEngine = Object.freeze({ strategy: "deterministic-v1", recommend });