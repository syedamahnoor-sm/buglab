import type { EvidenceSummary } from "@/lib/evidence";

export const EVIDENCE_FIELD_ID = "diagnosis-evidence";

interface EvidenceReviewProps {
  evidence: EvidenceSummary[];
  error?: string;
  onManage: () => void;
}

export function EvidenceReview({ evidence, error, onManage }: EvidenceReviewProps) {
  const errorId = `${EVIDENCE_FIELD_ID}-error`;

  return (
    <section
      aria-labelledby={`${EVIDENCE_FIELD_ID}-heading`}
      aria-describedby={error ? errorId : undefined}
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${EVIDENCE_FIELD_ID}-heading`} className="text-xs font-medium text-muted">
          Supporting evidence <span className="text-danger">*</span>{" "}
          <span className="font-normal text-subtle">({evidence.length})</span>
        </h3>
        <button
          id={EVIDENCE_FIELD_ID}
          type="button"
          onClick={onManage}
          className="rounded px-1.5 text-[11px] text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Manage in Notes
        </button>
      </div>
      {evidence.length === 0 ? (
        <p
          className={`rounded-md border border-dashed px-3 py-2 text-xs text-subtle ${
            error ? "border-danger/60" : "border-border"
          }`}
        >
          Nothing collected yet. Use “Add to evidence” in the Logs or Network tab.
        </p>
      ) : (
        <ul aria-live="polite" className="flex max-h-32 flex-col gap-1 overflow-auto">
          {evidence.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2 rounded border border-border bg-surface-sunken px-2 py-1 font-mono text-[11px] leading-4"
            >
              <span className={`shrink-0 ${item.kindLabel === "Log" ? "text-info" : "text-accent"}`}>
                {item.kindLabel === "Log" ? "LOG" : "NET"}
              </span>
              {/* Two-line preview; the full text is in the tooltip, the accessible
                  name and the Notes evidence list. */}
              <span className="line-clamp-2 min-w-0 text-foreground/85 wrap-anywhere" title={item.title}>
                {item.title}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={errorId} className="text-[11px] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
