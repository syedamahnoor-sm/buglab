import type { CSSProperties } from "react";
import type { CategoryId } from "@/types/catalog";

/**
 * Presentation for categories in the library: a short label for the compact
 * category bar (the full label stays the accessible name) and the category's
 * accent colour, exposed to children as `--cat` so styles can tint with it.
 * Colours are theme tokens (`--cat-*` in globals.css), never literals.
 */
export const CATEGORY_SHORT_LABEL: Record<CategoryId, string> = {
  authentication: "Auth",
  api: "APIs",
  frontend: "Frontend",
  database: "Databases",
  security: "Security",
  performance: "Performance",
};

export function categoryAccent(category: CategoryId): CSSProperties {
  return { "--cat": `var(--cat-${category})` } as CSSProperties;
}
