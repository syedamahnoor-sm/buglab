import type { LogLevel } from "@/types/workspace";

export const LOG_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];
export const LOG_SEARCH_INPUT_ID = "log-search";

const levelActiveClasses: Record<LogLevel, string> = {
  DEBUG: "border-subtle/50 bg-subtle/15 text-muted",
  INFO: "border-info/40 bg-info/10 text-info",
  WARN: "border-warning/40 bg-warning/10 text-warning",
  ERROR: "border-danger/40 bg-danger/10 text-danger",
};

interface LogFilterBarProps {
  enabledLevels: ReadonlySet<LogLevel>;
  levelCounts: Record<LogLevel, number>;
  onToggleLevel: (level: LogLevel) => void;
  query: string;
  onQueryChange: (query: string) => void;
  shownCount: number;
  totalCount: number;
  onReset: () => void;
}

export function LogFilterBar({
  enabledLevels,
  levelCounts,
  onToggleLevel,
  query,
  onQueryChange,
  shownCount,
  totalCount,
  onReset,
}: LogFilterBarProps) {
  const isFiltered = shownCount !== totalCount;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
      <div role="group" aria-label="Severity" className="flex flex-wrap gap-1">
        {LOG_LEVELS.map((level) => {
          const enabled = enabledLevels.has(level);
          return (
            <button
              key={level}
              type="button"
              aria-pressed={enabled}
              onClick={() => onToggleLevel(level)}
              className={`flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${
                enabled ? levelActiveClasses[level] : "border-border text-subtle line-through"
              }`}
            >
              {level}
              <span>{levelCounts[level]}</span>
            </button>
          );
        })}
      </div>

      <label className="min-w-32 flex-1">
        <span className="sr-only">Search logs</span>
        <input
          id={LOG_SEARCH_INPUT_ID}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search logs…"
          className="h-7 w-full rounded-md border border-border bg-surface-sunken px-2 font-mono text-xs text-foreground placeholder:text-subtle focus:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
      </label>

      <p aria-live="polite" className="flex items-center gap-2 text-xs text-subtle">
        {shownCount} of {totalCount}
        {isFiltered && (
          <button
            type="button"
            onClick={onReset}
            className="text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            Clear filters
          </button>
        )}
      </p>
    </div>
  );
}
