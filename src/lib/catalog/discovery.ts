/*
 * Challenge Library discovery: the shareable query (URL parameters), search,
 * filters, sorting, facets, recommendations and related challenges. Pure and
 * deterministic: the same catalog and query always give the same result.
 *
 * Filters combine with AND across kinds (search, category, difficulty,
 * technology) and OR within a kind (two difficulties match either).
 */
import { CATEGORIES } from "@/data/catalog/categories";
import type { CategoryId, PublicChallenge } from "@/types/catalog";
import type { Difficulty } from "@/types/workspace";
import { byCatalogOrder } from "./catalog";

export type SortKey = "recommended" | "newest" | "difficulty";

export const SORT_OPTIONS: readonly { id: SortKey; label: string }[] = [
  { id: "recommended", label: "Recommended" },
  { id: "newest", label: "Newest" },
  { id: "difficulty", label: "Difficulty" },
];

export const DIFFICULTY_ORDER: readonly Difficulty[] = ["beginner", "intermediate", "advanced"];

export interface DiscoveryQuery {
  q: string;
  category: CategoryId | null;
  difficulties: Difficulty[];
  technologies: string[];
  sort: SortKey;
}

export const EMPTY_QUERY: DiscoveryQuery = Object.freeze({
  q: "",
  category: null,
  difficulties: [],
  technologies: [],
  sort: "recommended",
}) as DiscoveryQuery;

const MAX_QUERY_LENGTH = 100;

type Params = { get(name: string): string | null };

const listParam = (params: Params, name: string) =>
  (params.get(name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

/**
 * Reads a query from URL parameters. Unknown categories, difficulties,
 * technologies and sorts are dropped, so a stale or edited link still works.
 */
export function parseDiscoveryQuery(params: Params, challenges: readonly PublicChallenge[]): DiscoveryQuery {
  const categories = new Set(challenges.map((challenge) => challenge.category));
  const technologies = new Map(technologyOptions(challenges).map((option) => [option.label.toLowerCase(), option.label]));
  const category = params.get("category");
  const sort = params.get("sort");
  const difficulties = listParam(params, "difficulty").filter((value): value is Difficulty =>
    (DIFFICULTY_ORDER as readonly string[]).includes(value),
  );
  return {
    q: (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH),
    category: category && categories.has(category as CategoryId) ? (category as CategoryId) : null,
    difficulties: DIFFICULTY_ORDER.filter((value) => difficulties.includes(value)),
    technologies: [...new Set(listParam(params, "tech").map((value) => technologies.get(value.toLowerCase())).filter((value): value is string => !!value))].sort(),
    sort: SORT_OPTIONS.some((option) => option.id === sort) ? (sort as SortKey) : "recommended",
  };
}

/** The query as URL parameters, defaults left out, in a stable order. */
export function serializeDiscoveryQuery(query: DiscoveryQuery): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.category) params.set("category", query.category);
  if (query.difficulties.length) params.set("difficulty", DIFFICULTY_ORDER.filter((d) => query.difficulties.includes(d)).join(","));
  if (query.technologies.length) params.set("tech", [...query.technologies].sort().join(","));
  if (query.sort !== "recommended") params.set("sort", query.sort);
  return params.toString();
}

/** True when anything narrows the list (sorting alone does not). */
export function isFiltered(query: DiscoveryQuery): boolean {
  return query.q.trim() !== "" || query.category !== null || query.difficulties.length > 0 || query.technologies.length > 0;
}

const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en");

function haystack(challenge: PublicChallenge): string {
  const category = CATEGORIES.find((item) => item.id === challenge.category)?.label ?? "";
  return normalize([challenge.title, challenge.description, category, ...challenge.technologies, ...challenge.tags].join("\n"));
}

/** Every whitespace-separated term must appear in the title, description, category, technologies or tags. */
export function matchesSearch(challenge: PublicChallenge, q: string): boolean {
  const terms = normalize(q).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(challenge);
  return terms.every((term) => text.includes(term));
}

export function filterChallenges(challenges: readonly PublicChallenge[], query: DiscoveryQuery): PublicChallenge[] {
  const technologies = new Set(query.technologies.map((value) => value.toLowerCase()));
  return challenges.filter(
    (challenge) =>
      matchesSearch(challenge, query.q) &&
      (query.category === null || challenge.category === query.category) &&
      (query.difficulties.length === 0 || query.difficulties.includes(challenge.difficulty)) &&
      (technologies.size === 0 || challenge.technologies.some((technology) => technologies.has(technology.toLowerCase()))),
  );
}

const difficultyRank = (challenge: PublicChallenge) => DIFFICULTY_ORDER.indexOf(challenge.difficulty);

/**
 * The recommended order, stated so the UI can explain it: featured first, then
 * easier before harder, then newer before older, then catalog order.
 */
export function compareRecommended(a: PublicChallenge, b: PublicChallenge): number {
  return (
    Number(b.featured) - Number(a.featured) ||
    difficultyRank(a) - difficultyRank(b) ||
    b.publishedAt.localeCompare(a.publishedAt) ||
    byCatalogOrder(a, b)
  );
}

export function sortChallenges(challenges: readonly PublicChallenge[], sort: SortKey): PublicChallenge[] {
  const list = [...challenges];
  if (sort === "newest") return list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || byCatalogOrder(b, a));
  if (sort === "difficulty") return list.sort((a, b) => difficultyRank(a) - difficultyRank(b) || byCatalogOrder(a, b));
  return list.sort(compareRecommended);
}

/** Search, filter and sort together. */
export function discover(challenges: readonly PublicChallenge[], query: DiscoveryQuery): PublicChallenge[] {
  return sortChallenges(filterChallenges(challenges, query), query.sort);
}

export interface CategoryCount {
  id: CategoryId;
  label: string;
  count: number;
}

/** Categories with at least one published challenge, in taxonomy order, with their counts. */
export function categoryCounts(challenges: readonly PublicChallenge[]): CategoryCount[] {
  return CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    count: challenges.filter((challenge) => challenge.category === category.id).length,
  })).filter((category) => category.count > 0);
}

export interface TechnologyOption {
  label: string;
  count: number;
}

/** Technologies used by published challenges, case-insensitively unique, alphabetical. */
export function technologyOptions(challenges: readonly PublicChallenge[]): TechnologyOption[] {
  const byKey = new Map<string, TechnologyOption>();
  for (const challenge of challenges) {
    for (const technology of new Set(challenge.technologies)) {
      const key = technology.toLowerCase();
      const option = byKey.get(key) ?? { label: technology, count: 0 };
      option.count += 1;
      byKey.set(key, option);
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, "en"));
}

export function difficultyCounts(challenges: readonly PublicChallenge[]): { id: Difficulty; count: number }[] {
  return DIFFICULTY_ORDER.map((id) => ({ id, count: challenges.filter((challenge) => challenge.difficulty === id).length }));
}

/** The featured challenges, in recommended order. */
export function featuredChallenges(challenges: readonly PublicChallenge[]): PublicChallenge[] {
  return challenges.filter((challenge) => challenge.featured).sort(compareRecommended);
}

/**
 * Catalog-based recommendations, not personal ones: the recommended order,
 * leaving out anything already shown (such as the featured investigation).
 */
export function recommendedChallenges(
  challenges: readonly PublicChallenge[],
  options: { exclude?: ReadonlySet<string>; limit?: number } = {},
): PublicChallenge[] {
  const exclude = options.exclude ?? new Set<string>();
  return [...challenges].sort(compareRecommended).filter((challenge) => !exclude.has(challenge.id)).slice(0, options.limit ?? 3);
}

export function beginnerChallenges(challenges: readonly PublicChallenge[]): PublicChallenge[] {
  return challenges.filter((challenge) => challenge.difficulty === "beginner").sort(byCatalogOrder);
}

/**
 * Other challenges that share the category, technologies or tags, most related
 * first (same category counts double), then catalog order. Unrelated ones are left out.
 */
export function relatedChallenges(target: PublicChallenge, challenges: readonly PublicChallenge[], limit = 3): PublicChallenge[] {
  const lower = (values: string[]) => new Set(values.map((value) => value.toLowerCase()));
  const technologies = lower(target.technologies);
  const tags = lower(target.tags);
  return challenges
    .filter((challenge) => challenge.id !== target.id)
    .map((challenge) => ({
      challenge,
      score:
        (challenge.category === target.category ? 2 : 0) +
        challenge.technologies.filter((value) => technologies.has(value.toLowerCase())).length +
        challenge.tags.filter((value) => tags.has(value.toLowerCase())).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || byCatalogOrder(a.challenge, b.challenge))
    .slice(0, limit)
    .map(({ challenge }) => challenge);
}
