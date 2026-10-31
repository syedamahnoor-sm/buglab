import type { KeyboardEvent } from "react";
import { highlightMatches } from "@/lib/text-highlight";
import type { LogEntry, LogLevel } from "@/types/workspace";

export const levelTextClasses: Record<LogLevel, string> = {
  DEBUG: "text-subtle",
  INFO: "text-info",
  WARN: "text-warning",
  ERROR: "text-danger",
};

interface LogRowProps {
  entry: LogEntry;
  query: string;
  isSelected: boolean;
  isTabStop: boolean;
  isCollected: boolean;
  onSelect: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

export function LogRow({
  entry,
  query,
  isSelected,
  isTabStop,
  isCollected,
  onSelect,
  onKeyDown,
}: LogRowProps) {
  return (
    <li
      role="option"
      data-option-id={entry.id}
      aria-selected={isSelected}
      tabIndex={isTabStop ? 0 : -1}
      onClick={() => onSelect(entry.id)}
      onKeyDown={(event) => onKeyDown(event, entry.id)}
      className={`relative grid cursor-pointer grid-cols-[auto_auto_1fr] gap-x-3 border-l-2 px-3 py-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/70 sm:grid-cols-[auto_3rem_3.5rem_1fr] ${
        isSelected
          ? "border-accent bg-accent/10"
          : `border-transparent hover:bg-surface-raised ${entry.level === "ERROR" ? "bg-danger/5" : ""}`
      }`}
    >
      <time className="text-subtle">{entry.timestamp}</time>
      <span className={`font-semibold ${levelTextClasses[entry.level]}`}>{entry.level}</span>
      <span className="hidden text-muted sm:inline">[{highlightMatches(entry.source, query)}]</span>
      <span className="col-span-3 break-words pr-4 text-foreground/85 sm:col-span-1">
        <span className="text-muted sm:hidden">[{highlightMatches(entry.source, query)}] </span>
        {highlightMatches(entry.message, query)}
      </span>
      {isCollected && (
        <span
          title="Collected as evidence"
          className="absolute right-2 top-2 size-1.5 rounded-full bg-success"
        >
          <span className="sr-only">Collected as evidence</span>
        </span>
      )}
    </li>
  );
}
