import type { ReactNode } from "react";

interface NotesSectionProps {
  title: string;
  count: number;
  children: ReactNode;
}

export function notesHeadingId(title: string) {
  return `notes-${title.toLowerCase().replace(/\s+/g, "-")}`;
}

export function NotesSection({ title, count, children }: NotesSectionProps) {
  const headingId = notesHeadingId(title);
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3
        id={headingId}
        tabIndex={-1}
        className="rounded-sm text-[11px] font-semibold uppercase tracking-wider text-muted outline-none focus-visible:ring-1 focus-visible:ring-accent/70"
      >
        {title} <span className="font-normal text-subtle">({count})</span>
      </h3>
      {children}
    </section>
  );
}

export const removeButtonClass =
  "shrink-0 rounded px-1.5 text-[11px] text-subtle hover:bg-surface-raised hover:text-danger focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent";

export function formatClockTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
