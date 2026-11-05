import { useId, useState, type FormEvent } from "react";

interface AddEntryFormProps {
  label: string;
  placeholder: string;
  submitLabel: string;
  multiline?: boolean;
  onAdd: (text: string) => void;
  /** Stable id for the field, so other controls can move focus to it. */
  inputId?: string;
}

export function AddEntryForm({
  label,
  placeholder,
  submitLabel,
  multiline = false,
  onAdd,
  inputId: providedId,
}: AddEntryFormProps) {
  const generatedId = useId();
  const inputId = providedId ?? generatedId;
  const [text, setText] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    onAdd(text);
    setText("");
  }

  const fieldClass =
    "w-full rounded-md border border-border bg-surface-sunken px-2 py-1.5 text-xs text-foreground placeholder:text-subtle focus:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <form onSubmit={handleSubmit} className="flex items-start gap-2">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={inputId}
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={placeholder}
          className={`${fieldClass} resize-y`}
        />
      ) : (
        <input
          id={inputId}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={placeholder}
          className={`${fieldClass} h-8`}
        />
      )}
      <button
        type="submit"
        disabled={!text.trim()}
        className="h-8 shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2.5 text-xs font-medium text-accent hover:bg-accent/20 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitLabel}
      </button>
    </form>
  );
}
