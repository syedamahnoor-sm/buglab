"use client";

import { useId, useState } from "react";
import { sampleLogLines, showcase } from "@/data/landing";
import { ShowcaseTile } from "./ShowcaseTile";

const suggestions = ["401", "auth", "ERROR"];

function highlight(line: string, query: string) {
  if (!query) return line;
  const parts = line.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded-sm bg-accent/25 text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

// A working log filter over a few of the incident's lines.
export function LogSearchTile() {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const trimmed = query.trim();
  const matches = sampleLogLines.filter((line) => line.toLowerCase().includes(trimmed.toLowerCase()));

  return (
    <ShowcaseTile content={showcase.logs}>
      <label htmlFor={inputId} className="sr-only">
        Search sample logs
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search logs…"
        autoComplete="off"
        spellCheck={false}
        className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-3 font-mono text-xs text-foreground placeholder:text-subtle focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-subtle">Try</span>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            aria-pressed={trimmed.toLowerCase() === suggestion.toLowerCase()}
            onClick={() => setQuery(suggestion)}
            className="rounded border border-border px-1.5 py-0.5 font-mono text-muted transition-colors hover:border-accent/50 hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent aria-pressed:border-accent/60 aria-pressed:bg-accent/10 aria-pressed:text-foreground"
          >
            {suggestion}
          </button>
        ))}
      </div>
      <p aria-live="polite" className="mt-3 font-mono text-[11px] text-subtle">
        {matches.length} of {sampleLogLines.length} lines
      </p>
      <ul
        aria-label="Sample log lines"
        className="mt-1.5 flex-1 space-y-1 rounded-lg border border-border bg-surface-sunken py-1.5 font-mono text-[11px] leading-5"
      >
        {matches.map((line) => (
          <li key={line} className="px-3 text-foreground/85 wrap-anywhere">
            {highlight(line, trimmed)}
          </li>
        ))}
        {matches.length === 0 && <li className="px-3 text-subtle">No matching lines.</li>}
      </ul>
    </ShowcaseTile>
  );
}
