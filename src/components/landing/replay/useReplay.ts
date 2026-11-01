import { useEffect, useMemo, useReducer, useRef } from "react";
import { createReplayReducer, initialReplayState, stageMode } from "./replay-reducer";

/**
 * Drives the replay: autoplays once when at least half of it is on screen,
 * holds while it is off screen or the tab is hidden, and never autoplays for
 * reduced motion. The chapter timer keeps its remaining time across pauses.
 */
export function useReplay(durations: readonly number[]) {
  const reducer = useMemo(() => createReplayReducer(durations.length), [durations.length]);
  const [state, dispatch] = useReducer(reducer, initialReplayState);
  const ref = useRef<HTMLDivElement>(null);
  const mode = stageMode(state);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let inView = false;

    const sync = () => {
      const visible = inView && document.visibilityState === "visible";
      if (visible && !reducedMotion) dispatch({ type: "AUTOPLAY" });
      dispatch({ type: visible ? "RESUME" : "SUSPEND" });
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.intersectionRatio >= 0.5;
        sync();
      },
      { threshold: [0, 0.5] },
    );
    io.observe(element);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  // Milliseconds left in the current chapter, or null for its full length.
  const remaining = useRef<number | null>(null);

  // Declared before the timer so it runs after the old timer's cleanup and
  // before the new timer reads it: a new chapter or run starts in full.
  useEffect(() => {
    remaining.current = null;
  }, [state.chapter, state.run]);

  useEffect(() => {
    if (mode !== "running") return;
    const duration = remaining.current ?? durations[state.chapter];
    const startedAt = performance.now();
    const timer = window.setTimeout(() => dispatch({ type: "ADVANCE" }), duration);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, duration - (performance.now() - startedAt));
    };
  }, [mode, state.chapter, state.run, durations]);

  return { state, mode, dispatch, ref };
}
