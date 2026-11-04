import type { RootCauseOption } from "@/types/diagnosis";

export const ROOT_CAUSE_FIELD_ID = "diagnosis-root-cause";

interface RootCauseOptionsProps {
  options: RootCauseOption[];
  value: string | null;
  onChange: (id: string) => void;
  error?: string;
}

export function RootCauseOptions({ options, value, onChange, error }: RootCauseOptionsProps) {
  const errorId = `${ROOT_CAUSE_FIELD_ID}-error`;

  return (
    <fieldset
      id={ROOT_CAUSE_FIELD_ID}
      aria-describedby={error ? errorId : undefined}
      className="flex flex-col gap-1.5"
    >
      <legend className="mb-1.5 text-xs font-medium text-muted">
        Root cause <span className="text-danger">*</span>
      </legend>
      {options.map((option) => {
        const inputId = `${ROOT_CAUSE_FIELD_ID}-${option.id}`;
        const checked = option.id === value;
        return (
          <label
            key={option.id}
            htmlFor={inputId}
            className={`flex cursor-pointer gap-2.5 rounded-md border px-2.5 py-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${
              checked
                ? "border-accent/50 bg-accent/10"
                : "border-border bg-surface-sunken hover:border-border-strong"
            }`}
          >
            <input
              id={inputId}
              type="radio"
              name="root-cause"
              value={option.id}
              checked={checked}
              onChange={() => onChange(option.id)}
              className="mt-0.5 size-3.5 shrink-0 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-xs font-medium leading-5 text-foreground">
                {option.label}
              </span>
              <span className="block text-[11px] leading-4 text-subtle">{option.description}</span>
            </span>
          </label>
        );
      })}
      {error && (
        <p id={errorId} className="text-[11px] text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
