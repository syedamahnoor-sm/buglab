import type { CategoryDefinition, CategoryId } from "@/types/catalog";

/**
 * The category taxonomy. A category appears in the Challenge Library only when
 * at least one published challenge belongs to it.
 */
export const CATEGORIES: readonly CategoryDefinition[] = [
  { id: "authentication", label: "Authentication & Authorization", description: "Logins, sessions, tokens and access control." },
  { id: "api", label: "APIs & Backend", description: "HTTP endpoints, contracts and server-side logic." },
  { id: "frontend", label: "Frontend & React", description: "Rendering, state and browser behaviour." },
  { id: "database", label: "Databases & Data Integrity", description: "Queries, transactions and data consistency." },
  { id: "security", label: "Security & Vulnerabilities", description: "Injection, access control and unsafe input handling." },
  { id: "performance", label: "Performance & Production", description: "Latency, memory, caching and production failures." },
];

export const CATEGORY_IDS: ReadonlySet<CategoryId> = new Set(CATEGORIES.map((category) => category.id));

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}
