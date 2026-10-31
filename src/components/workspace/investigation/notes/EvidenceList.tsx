import { Badge } from "@/components/ui/Badge";
import type { EvidenceSummary } from "@/lib/evidence";
import type { EvidenceItem, EvidenceRef } from "@/types/investigation";
import { NotesSection, removeButtonClass } from "./NotesSection";

interface EvidenceListProps {
  items: { item: EvidenceItem; summary: EvidenceSummary }[];
  onSetNote: (id: string, note: string) => void;
  onRemove: (id: string) => void;
  onShowSource: (ref: EvidenceRef) => void;
}

export function EvidenceList({ items, onSetNote, onRemove, onShowSource }: EvidenceListProps) {
  return (
    <NotesSection title="Evidence" count={items.length}>
      {items.length === 0 ? (
        <p className="text-xs text-subtle">
          Select a log entry or network request and choose “Add to evidence”.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map(({ item, summary }) => (
            <li
              key={item.id}
              className="space-y-1.5 rounded-md border border-border bg-surface px-2 py-1.5"
            >
              <div className="flex items-start gap-2">
                <Badge tone={summary.kindLabel === "Log" ? "info" : "accent"} className="shrink-0">
                  {summary.kindLabel}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-mono text-xs text-foreground/90">{summary.title}</p>
                  <p className="font-mono text-[11px] text-subtle">{summary.detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onShowSource(item.ref)}
                  aria-label={`Show source of ${summary.title}`}
                  className="h-6 shrink-0 rounded px-1.5 text-[11px] text-accent hover:bg-surface-raised focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                >
                  Show
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Remove evidence: ${summary.title}`}
                  className={`h-6 ${removeButtonClass}`}
                >
                  Remove
                </button>
              </div>
              <label className="block">
                <span className="sr-only">Note for {summary.title}</span>
                <input
                  type="text"
                  value={item.note}
                  onChange={(event) => onSetNote(item.id, event.target.value)}
                  placeholder="Why does this matter? (optional)"
                  className="h-7 w-full rounded border border-border bg-surface-sunken px-2 text-xs text-foreground placeholder:text-subtle focus:border-accent/60 focus:outline-none"
                />
              </label>
            </li>
          ))}
        </ul>
      )}
    </NotesSection>
  );
}
