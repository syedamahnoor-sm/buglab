import { Panel } from "@/components/ui/Panel";
import { ClipboardIcon } from "@/components/ui/icons";

interface DiagnosisPanelProps {
  className?: string;
}

// Visual placeholder only: fields and the submit button are disabled until
// the Challenge Engine provides submission and evaluation.
export function DiagnosisPanel({ className }: DiagnosisPanelProps) {
  return (
    <Panel
      title="Diagnosis"
      icon={<ClipboardIcon />}
      className={className}
      bodyClassName="p-3"
    >
      <form aria-describedby="diagnosis-status" className="flex h-full flex-col gap-3">
        <fieldset disabled className="flex flex-1 flex-col gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <label
              htmlFor="diagnosis-root-cause"
              className="text-xs font-medium text-muted"
            >
              Root cause
            </label>
            <textarea
              id="diagnosis-root-cause"
              rows={4}
              placeholder="Describe what is causing the incident…"
              className="min-h-24 flex-1 resize-none rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="diagnosis-evidence"
              className="text-xs font-medium text-muted"
            >
              Supporting evidence
            </label>
            <input
              id="diagnosis-evidence"
              type="text"
              placeholder="Relevant files, log lines, or requests"
              className="h-9 rounded-md border border-border bg-surface-sunken px-3 text-sm text-foreground placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        </fieldset>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p id="diagnosis-status" className="text-xs text-subtle">
            Submission isn&apos;t available in this preview.
          </p>
          <button
            type="submit"
            disabled
            className="h-8 shrink-0 rounded-md bg-accent px-3 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
          >
            Submit diagnosis
          </button>
        </div>
      </form>
    </Panel>
  );
}
