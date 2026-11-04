import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Picks the chapter to show from the blocks crossing the middle of the
 * viewport. A block that just entered wins; when the active block leaves, the
 * one still there takes over. Otherwise (above or below the chapters) the
 * last choice stays.
 */
export function nextActiveChapter(current: number, inBand: ReadonlySet<number>, entered: readonly number[]) {
  if (entered.length > 0) return entered[entered.length - 1];
  if (!inBand.has(current) && inBand.size > 0) return Math.min(...inBand);
  return current;
}

const noSubscription = () => () => {};

/** False while rendering on the server and hydrating, true after. */
export function useHydrated() {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function useReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(reducedMotionQuery);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

export interface ActiveChapter {
  chapter: number;
  /** Changes whenever a chapter (re)starts, to restart the stage. */
  run: number;
  /** False until the visitor first reaches a chapter: the stage stays still. */
  played: boolean;
}

/*
 * The pinned desktop replay's clock is the visitor's own scrolling: no timer
 * and no autoplay. Native scrolling and in-page links do all the moving; this
 * only watches which chapter block sits at the middle of the screen.
 */
export function useActiveChapter() {
  const [state, setState] = useState<ActiveChapter>({ chapter: 0, run: 0, played: false });
  const live = useHydrated();
  const blocks = useRef<(HTMLElement | null)[]>([]);

  const select = useCallback((chapter: number, restart: boolean) => {
    setState((current) =>
      current.chapter === chapter && current.played && !restart
        ? current
        : { chapter, run: current.run + 1, played: true },
    );
  }, []);

  useEffect(() => {
    const inBand = new Set<number>();
    let active = 0;

    const io = new IntersectionObserver(
      (entries) => {
        const entered: number[] = [];
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.chapter);
          if (entry.isIntersecting) {
            inBand.add(index);
            entered.push(index);
          } else {
            inBand.delete(index);
          }
        }
        const next = nextActiveChapter(active, inBand, entered);
        if (inBand.size > 0 || next !== active) {
          active = next;
          select(next, false);
        }
      },
      // A thin band across the middle of the viewport.
      { rootMargin: "-48% 0px -48% 0px" },
    );
    for (const block of blocks.current) if (block) io.observe(block);
    return () => io.disconnect();
  }, [select]);

  const register = useCallback(
    (index: number) => (element: HTMLElement | null) => {
      blocks.current[index] = element;
    },
    [],
  );

  return { ...state, live, register, select };
}
