"use client";

import { useId, useState, type MouseEvent } from "react";
import { LIMITS, type Reflection } from "@/lib/learning/model";
import { buttonPrimary, buttonQuiet, field } from "./ui";

/** The four guided prompts, all optional. */
export const REFLECTION_PROMPTS: readonly { key: keyof Omit<Reflection, "takeaway">; label: string; hint: string }[] = [
  { key: "cause", label: "What caused the bug?", hint: "In your own words, not the resolution text." },
  { key: "evidence", label: "Which evidence helped you identify it?", hint: "A log line, a request, a file." },
  { key: "misunderstanding", label: "What did you initially misunderstand?", hint: "The wrong turn is often the lesson." },
  { key: "nextTime", label: "What would you do differently next time?", hint: "Where you would look first." },
];

export const EMPTY_REFLECTION: Reflection = { cause: "", evidence: "", misunderstanding: "", nextTime: "", takeaway: "" };

/**
 * The takeaway (required: it is what recall reveals) and four optional guided
 * prompts. The caller saves; this only edits and validates.
 *
 * Deliberately not a <form>: it is shown inside the diagnosis form, and forms
 * cannot be nested, so saving is an explicit button that does not bubble into
 * the diagnosis submission.
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
      setError("Write a takeaway before saving. The guided prompts are optional.");
      document.getElementById(`${id}-takeaway`)?.focus();
      return;
    }
    setError(onSubmit(draft));
  }

  return (
    <div role="group" aria-label="Reflection" className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={`${id}-takeaway`} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-medium text-foreground">
          <span>
            Your takeaway <span className="font-normal text-muted">(required)</span>
          </span>
          <span id={`${id}-takeaway-count`} className="font-mono text-xs font-normal tabular-nums text-subtle">
            {draft.takeaway.length}/{LIMITS.takeawayLength}
          </span>
        </label>
        <p id={`${id}-takeaway-hint`} className="text-xs text-muted">
          One or two sentences you would want to remember. Recall shows you this.
        </p>
        <textarea
          id={`${id}-takeaway`}
          rows={2}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-takeaway-hint ${id}-takeaway-count${error ? ` ${id}-error` : ""}`}
          maxLength={LIMITS.takeawayLength}
          value={draft.takeaway}
          onChange={(event) => setDraft({ ...draft, takeaway: event.target.value })}
          className={field}
        />
      </div>

      <fieldset className="rounded-xl border border-panel-border bg-panel p-3 sm:p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Guided prompts · optional</legend>
        <div className="mt-1 grid gap-3 md:grid-cols-2">
          {REFLECTION_PROMPTS.map((prompt) => (
            <div key={prompt.key} className="space-y-1">
              <label htmlFor={`${id}-${prompt.key}`} className="block text-sm font-medium text-foreground">
                {prompt.label}
              </label>
              <textarea
                id={`${id}-${prompt.key}`}
                rows={2}
                maxLength={LIMITS.answerLength}
                placeholder={prompt.hint}
                value={draft[prompt.key]}
                onChange={(event) => setDraft({ ...draft, [prompt.key]: event.target.value })}
                className={field}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={submit} className={buttonPrimary}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={buttonQuiet}>
          Cancel
        </button>
      </div>
    </div>
  );
}
