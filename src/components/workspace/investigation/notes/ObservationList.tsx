import type { Observation } from "@/types/investigation";
import { AddEntryForm } from "./AddEntryForm";
import { NotesSection, formatClockTime, removeButtonClass } from "./NotesSection";

interface ObservationListProps {
  observations: Observation[];
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
}

export function ObservationList({ observations, onAdd, onRemove }: ObservationListProps) {
  return (
    <NotesSection title="Observations" count={observations.length}>
      <AddEntryForm
        label="New observation"
        placeholder="What did you notice? (Ctrl+Enter to add)"
        submitLabel="Add"
        multiline
        onAdd={onAdd}
      />
      {observations.length > 0 && (
        <ul className="space-y-1.5">
          {observations.map((observation) => (
            <li
              key={observation.id}
              className="flex items-start gap-2 rounded-md border border-border bg-surface px-2 py-1.5"
            >
              <time className="shrink-0 pt-0.5 font-mono text-[11px] text-subtle">
                {formatClockTime(observation.createdAt)}
              </time>
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/90">
                {observation.text}
              </p>
              <button
                type="button"
                onClick={() => onRemove(observation.id)}
                aria-label="Remove observation"
                className={`h-6 ${removeButtonClass}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </NotesSection>
  );
}
