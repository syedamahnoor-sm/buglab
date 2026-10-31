import { Panel } from "@/components/ui/Panel";
import { ClipboardIcon } from "@/components/ui/icons";
import type { EvidenceSummary } from "@/lib/evidence";

interface DiagnosisPanelProps {
  evidence: EvidenceSummary[];
  className?: string;
}

// Submission stays disabled until the Challenge Engine provides it. Evidence
// is a live, read-only view of what was collected in the console.
export function DiagnosisPanel({ evidence, className }: DiagnosisPanelProps) {
  return (
    <Panel
      title="Diagnosis"
      icon={<ClipboardIcon />}
      className={className}
      bodyClassName="p-3"
    >
      <form aria-describedby="diagnosis-status" className="flex h-full flex-col gap-3">
        <fieldset disabled className="flex flex-col gap-1.5">
          <label
            htmlFor="diagnosis-root-cause"
            className="text-xs font-medium text-muted"
          >
            Root cause
          </label>
          <textarea
            id="diagnosis-root-cause"
            rows={3}
            placeholder="Describe what is causing the incident…"
            className="min-h-20 resize-none rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60"
          />
        </fieldset>

        <section aria-labelledby="diagnosis-evidence-heading" className="flex flex-col gap-1.5">
          <h3 id="diagnosis-evidence-heading" className="text-xs font-medium text-muted">
            Supporting evidence{" "}
            <span className="font-normal text-subtle">({evidence.length})</span>
          </h3>
          {evidence.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-subtle">
              Nothing collected yet. Use “Add to evidence” in the Logs or Network tab.
            </p>
          ) : (
            <ul aria-live="polite" className="flex max-h-32 flex-col gap-1 overflow-auto">
              {evidence.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded border border-border bg-surface-sunken px-2 py-1 font-mono text-[11px]"
                >
                  <span className={item.kindLabel === "Log" ? "text-info" : "text-accent"}>
                    {item.kindLabel === "Log" ? "LOG" : "NET"}
                  </span>
                  <span className="truncate text-foreground/85" title={item.title}>
                    {item.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-subtle">Resets on refresh.</p>
        </section>

        <div className="mt-auto flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
