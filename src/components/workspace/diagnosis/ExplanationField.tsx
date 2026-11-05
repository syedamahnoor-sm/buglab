import {
  EXPLANATION_MAX_LENGTH,
  EXPLANATION_MIN_LENGTH,
  normalizeExplanation,
} from "@/lib/diagnosis/validate";

export const EXPLANATION_FIELD_ID = "diagnosis-explanation";

interface ExplanationFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

export function ExplanationField({ value, onChange, error, disabled }: ExplanationFieldProps) {
  const length = normalizeExplanation(value).length;
  const hintId = `${EXPLANATION_FIELD_ID}-hint`;
  const errorId = `${EXPLANATION_FIELD_ID}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={EXPLANATION_FIELD_ID} className="text-xs font-medium text-muted">
        Explanation <span className="text-danger">*</span>
      </label>
      <textarea
        id={EXPLANATION_FIELD_ID}
        rows={4}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        maxLength={EXPLANATION_MAX_LENGTH + 200}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        placeholder="Explain what is happening and how your evidence supports it…"
        className={`min-h-24 resize-y rounded-md border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${
          error ? "border-danger/60" : "border-border focus:border-accent/60"
        }`}
      />
      <p id={hintId} className="flex justify-between gap-2 text-xs text-subtle">
        <span>At least {EXPLANATION_MIN_LENGTH} characters.</span>
        <span className={length > EXPLANATION_MAX_LENGTH ? "text-danger" : undefined}>
          {length}/{EXPLANATION_MAX_LENGTH}
        </span>
      </p>
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
