import type { CategoryDefinition, CategoryId } from "@/types/catalog";

/**
 * The category taxonomy. A category appears in the Challenge Library only when
 * at least one published challenge belongs to it.
 */
export const CATEGORIES: readonly CategoryDefinition[] = [
  { id: "authentication", label: "Authentication", description: "Logins, sessions, tokens and cookies." },
  { id: "api", label: "APIs", description: "HTTP endpoints, contracts and integrations." },
  { id: "frontend", label: "Frontend", description: "Rendering, state and browser behaviour." },
  { id: "database", label: "Databases", description: "Queries, schemas and data consistency." },
  { id: "performance", label: "Performance", description: "Latency, memory and throughput." },
  { id: "infrastructure", label: "Infrastructure", description: "Deployment, configuration and networking." },
];

export const CATEGORY_IDS: ReadonlySet<CategoryId> = new Set(CATEGORIES.map((category) => category.id));

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}
