import type { ReactNode } from "react";

/** Wraps case-insensitive matches of `query` in <mark>. Text only, no HTML. */
export function highlightMatches(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;

  const parts: ReactNode[] = [];
  const haystack = text.toLowerCase();
  let cursor = 0;
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <mark key={index} className="rounded-sm bg-warning/25 text-foreground">
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return parts;
}
