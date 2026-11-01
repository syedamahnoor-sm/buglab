import type { Observation } from "@/types/investigation";
import { AddEntryForm } from "./AddEntryForm";
import { NotesSection, formatClockTime, removeButtonClass } from "./NotesSection";
import { useRemovalFocus } from "./useRemovalFocus";

const NEW_OBSERVATION_ID = "notes-new-observation";

interface ObservationListProps {
  observations: Observation[];
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
}

export function ObservationList({ observations, onAdd, onRemove }: ObservationListProps) {
  const { listRef, removeWithFocus } = useRemovalFocus(
    observations.map((observation) => observation.id),
    NEW_OBSERVATION_ID,
  );

  return (
    <NotesSection title="Observations" count={observations.length}>
      <AddEntryForm
        label="New observation"
        placeholder="What did you notice? (Ctrl+Enter to add)"
        submitLabel="Add"
        multiline
        inputId={NEW_OBSERVATION_ID}
        onAdd={onAdd}
      />
      {observations.length > 0 && (
        <ul ref={listRef} className="space-y-1.5">
          {observations.map((observation) => (
            <li
              key={observation.id}
              className="flex items-start gap-2 rounded-md border border-border bg-surface px-2 py-1.5"
            >
              <time className="shrink-0 pt-0.5 font-mono text-[11px] text-subtle">
                {formatClockTime(observation.createdAt)}
              </time>
              <p className="min-w-0 flex-1 whitespace-pre-wrap text-xs wrap-anywhere leading-5 text-foreground/90">
                {observation.text}
              </p>
              <button
                type="button"
                data-remove-id={observation.id}
                onClick={(event) => removeWithFocus(event, observation.id, onRemove)}
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
