"use client";

import { useId, useState, type MouseEvent } from "react";
import { LIMITS, type Reflection } from "@/lib/journal/model";

export const REFLECTION_PROMPTS: readonly { key: keyof Omit<Reflection, "takeaway">; label: string }[] = [
  { key: "evidence", label: "What evidence helped you identify the root cause?" },
  { key: "cause", label: "Why did the bug happen?" },
  { key: "lookFor", label: "What would you look for if you met a similar problem?" },
];

export const EMPTY_REFLECTION: Reflection = { evidence: "", cause: "", lookFor: "", takeaway: "" };

const field =
  "w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The three prompts and the takeaway. The caller saves; this only edits and
 * validates. Deliberately not a <form>: it is shown inside the diagnosis form,
 * and forms cannot be nested, so saving is an explicit button that does not
 * bubble into the diagnosis submission.
 */
export function ReflectionForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Reflection;
  submitLabel: string;
  /** Returns an error message to show, or null when saved. */
  onSubmit: (reflection: Reflection) => string | null;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Reflection>(initial);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  function submit(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!draft.takeaway.trim()) {
      setError("Write a takeaway before saving.");
      return;
    }
    setError(onSubmit(draft));
  }

  return (
    <div role="group" aria-label="Reflection" className="space-y-3">
      {REFLECTION_PROMPTS.map((prompt) => (
        <div key={prompt.key} className="space-y-1">
          <label htmlFor={`${id}-${prompt.key}`} className="block text-xs font-medium text-foreground">
            {prompt.label} <span className="text-muted">(optional)</span>
          </label>
          <textarea
            id={`${id}-${prompt.key}`}
            rows={2}
            maxLength={LIMITS.answerLength}
            value={draft[prompt.key]}
            onChange={(event) => setDraft({ ...draft, [prompt.key]: event.target.value })}
            className={field}
          />
        </div>
      ))}
      <div className="space-y-1">
        <label htmlFor={`${id}-takeaway`} className="block text-xs font-medium text-foreground">
          Your takeaway <span className="text-muted">(required, one or two sentences)</span>
        </label>
        <textarea
          id={`${id}-takeaway`}
          rows={2}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-takeaway-count${error ? ` ${id}-error` : ""}`}
          maxLength={LIMITS.takeawayLength}
          value={draft.takeaway}
          onChange={(event) => setDraft({ ...draft, takeaway: event.target.value })}
          className={field}
        />
        <p id={`${id}-takeaway-count`} className="text-right font-mono text-xs text-subtle">
          {draft.takeaway.length}/{LIMITS.takeawayLength}
        </p>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={submit} className={`h-9 rounded-md bg-accent px-3.5 text-sm font-medium text-background hover:bg-accent/90 ${focusRing}`}>
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`h-9 rounded-md border border-border-strong px-3.5 text-sm text-foreground hover:bg-surface-raised ${focusRing}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
