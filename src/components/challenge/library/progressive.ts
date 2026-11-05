/**
 * Progressive discovery: the grid shows the matching challenges a page at a
 * time. Search, filters and sorting always run on the whole catalog first;
 * only the result is cut to the visible limit.
 *
 * The static fallback's CSS (`.library-static-grid` in globals.css) assumes a
 * page of 9; change both together.
 */
export const PAGE_SIZE = 9;

/** The limit after one more page, never past the number of results. */
export function nextLimit(limit: number, total: number): number {
  return Math.min(limit + PAGE_SIZE, Math.max(total, PAGE_SIZE));
}

export interface Progress {
  /** How many results are on screen. */
  shown: number;
  /** How many results match. */
  total: number;
  /** How many the next Load more reveals; 0 when everything is shown. */
  next: number;
}

/** What to show for `total` results with the current limit. */
export function progress(limit: number, total: number): Progress {
  const shown = Math.min(limit, total);
  return { shown, total, next: Math.min(PAGE_SIZE, total - shown) };
}
