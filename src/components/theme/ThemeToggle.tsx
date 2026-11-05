"use client";

import { MoonIcon, SunIcon } from "@/components/ui/icons";
import { chooseTheme, oppositeOfShownTheme, useTheme } from "./theme-store";

/**
 * Switches between the light and dark themes. It shows the theme in use (a
 * sun in light, a moon in dark) and is labelled with what pressing it does.
 *
 * Which icon shows is decided by CSS from the `data-theme` attribute, so the
 * first paint is already right and the server markup never depends on the
 * theme (no hydration mismatch). The label becomes specific once hydrated.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const label = theme === null ? "Switch colour theme" : `Switch to ${theme === "dark" ? "light" : "dark"} theme`;
  return (
    <button
      type="button"
      onClick={() => chooseTheme(oppositeOfShownTheme())}
      aria-label={label}
      title={label}
      className={`theme-toggle relative grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface/60 text-muted transition-colors duration-200 hover:border-border-strong hover:bg-surface-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      <SunIcon width={16} height={16} className="theme-toggle-sun col-start-1 row-start-1" />
      <MoonIcon width={16} height={16} className="theme-toggle-moon col-start-1 row-start-1" />
    </button>
  );
}
