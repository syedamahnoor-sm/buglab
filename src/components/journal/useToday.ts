"use client";

import { useSyncExternalStore } from "react";
import { localDay } from "@/lib/learning/days";
import type { LocalDay } from "@/lib/learning/model";

/*
 * The learner's local calendar day, kept current: it is read again when the
 * window regains focus, when the tab becomes visible and once a minute, so a
 * journal left open past midnight moves to the new day by itself. The server
 * does not know the learner's day, so its snapshot is null and day-dependent
 * content renders only in the browser.
 */
function subscribe(onChange: () => void) {
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  const timer = window.setInterval(onChange, 60_000);
  return () => {
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
    window.clearInterval(timer);
  };
}

export function useToday(): LocalDay | null {
  return useSyncExternalStore<LocalDay | null>(subscribe, () => localDay(new Date()), () => null);
}
