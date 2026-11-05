/*
 * BugLab's colour themes: light and dark, chosen by the learner or, until they
 * choose, by the operating system.
 *
 * The theme is one attribute, `data-theme` on <html>. Every colour is a CSS
 * variable in globals.css that the attribute switches, so components never branch
 * on the theme. The attribute is set by THEME_INIT_SCRIPT, inlined in <head>,
 * before the first paint, so the page never flashes the wrong theme.
 */

export type Theme = "light" | "dark";

/** Where an explicit choice is kept, in this browser only. Absent means "follow the system". */
export const THEME_STORAGE_KEY = "buglab.theme";
export const THEME_ATTRIBUTE = "data-theme";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/** A stored choice, or null for anything else (nothing stored, or an unknown value). */
export function parseStoredTheme(value: unknown): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** The theme to show: an explicit choice wins; otherwise the system's preference. */
export function resolveTheme(stored: Theme | null, systemPrefersDark: boolean): Theme {
  return stored ?? (systemPrefersDark ? "dark" : "light");
}

/**
 * Runs in <head> before anything paints. It applies the resolved theme, then
 * keeps it current: when the system preference changes and no choice has
 * been made, and when another tab makes or clears a choice. Self-contained
 * and defensive: storage can be unavailable, and then the system decides.
 */
export const THEME_INIT_SCRIPT = `(function () {
  var key = ${JSON.stringify(THEME_STORAGE_KEY)};
  var root = document.documentElement;
  var system = window.matchMedia(${JSON.stringify(SYSTEM_DARK_QUERY)});
  function stored() {
    try {
      var value = window.localStorage.getItem(key);
      return value === "light" || value === "dark" ? value : null;
    } catch (error) {
      return null;
    }
  }
  function apply() {
    var theme = stored() || (system.matches ? "dark" : "light");
    root.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)}, theme);
    root.style.colorScheme = theme;
  }
  apply();
  system.addEventListener("change", function () {
    if (!stored()) apply();
  });
  window.addEventListener("storage", function (event) {
    if (event.key === key || event.key === null) apply();
  });
})();`;
