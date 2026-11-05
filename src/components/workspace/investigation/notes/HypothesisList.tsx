import type { Hypothesis, HypothesisStatus } from "@/types/investigation";
import { AddEntryForm } from "./AddEntryForm";
import { NotesSection, removeButtonClass } from "./NotesSection";
import { useRemovalFocus } from "./useRemovalFocus";

const NEW_HYPOTHESIS_ID = "notes-new-hypothesis";

const statusOptions: { value: HypothesisStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "supported", label: "Supported" },
  { value: "ruled-out", label: "Ruled out" },
];

const statusClasses: Record<HypothesisStatus, string> = {
  open: "border-border-strong text-muted",
  supported: "border-success/40 text-success",
  "ruled-out": "border-border text-subtle",
};

interface HypothesisListProps {
  hypotheses: Hypothesis[];
  onAdd: (text: string) => void;
  onSetStatus: (id: string, status: HypothesisStatus) => void;
  onRemove: (id: string) => void;
}

export function HypothesisList({ hypotheses, onAdd, onSetStatus, onRemove }: HypothesisListProps) {
  const { listRef, removeWithFocus } = useRemovalFocus(
    hypotheses.map((hypothesis) => hypothesis.id),
    NEW_HYPOTHESIS_ID,
  );

  return (
    <NotesSection title="Hypotheses" count={hypotheses.length}>
      <AddEntryForm
        label="New hypothesis"
        placeholder="What might be causing the incident?"
        submitLabel="Add"
        inputId={NEW_HYPOTHESIS_ID}
        onAdd={onAdd}
      />
      {hypotheses.length > 0 && (
        <ul ref={listRef} className="space-y-1.5">
          {hypotheses.map((hypothesis) => (
            <li
              key={hypothesis.id}
              className="flex items-start gap-2 rounded-md border border-border bg-surface px-2 py-1.5"
            >
              <p
                className={`min-w-0 flex-1 text-xs wrap-anywhere leading-5 ${
                  hypothesis.status === "ruled-out" ? "text-subtle line-through" : "text-foreground/90"
                }`}
              >
                {hypothesis.text}
              </p>
              <label className="shrink-0">
                <span className="sr-only">Status for hypothesis: {hypothesis.text}</span>
                <select
                  value={hypothesis.status}
                  onChange={(event) =>
                    onSetStatus(hypothesis.id, event.target.value as HypothesisStatus)
                  }
                  className={`h-6 rounded border bg-surface-sunken px-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${statusClasses[hypothesis.status]}`}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                data-remove-id={hypothesis.id}
                onClick={(event) => removeWithFocus(event, hypothesis.id, onRemove)}
                aria-label={`Remove hypothesis: ${hypothesis.text}`}
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
