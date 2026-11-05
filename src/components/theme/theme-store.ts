"use client";

import { useSyncExternalStore } from "react";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

/*
 * The theme as React sees it. The DOM attribute set by the <head> script is
 * the single source of truth; this store only reads it and writes a new
 * choice. The server cannot know the theme, so its snapshot is null and
 * components render theme-neutral markup until the browser reports it.
 */

function readTheme(): Theme {
  return document.documentElement.getAttribute(THEME_ATTRIBUTE) === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [THEME_ATTRIBUTE] });
  return () => observer.disconnect();
}

/** The theme currently shown, or null during server rendering and hydration. */
export function useTheme(): Theme | null {
  return useSyncExternalStore<Theme | null>(subscribe, readTheme, () => null);
}

/**
 * Makes an explicit choice: shown at once and remembered in this browser.
 * If storage is unavailable the choice still applies until the page closes.
 */
export function chooseTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode, site data disabled): keep the choice for this page only.
  }
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  document.documentElement.style.colorScheme = theme;
}

/** The theme a toggle switches to, read from the page itself so it is right even before hydration. */
export function oppositeOfShownTheme(): Theme {
  return readTheme() === "dark" ? "light" : "dark";
}
