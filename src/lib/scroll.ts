/**
 * The scroll offset that brings an item spanning [start, start + size) into a
 * viewport, moving as little as possible. An item wider than the viewport is
 * aligned to its start.
 */
export function revealOffset(scroll: number, viewport: number, start: number, size: number) {
  if (start < scroll) return start;
  if (start + size > scroll + viewport) return Math.min(start, start + size - viewport);
  return scroll;
}
