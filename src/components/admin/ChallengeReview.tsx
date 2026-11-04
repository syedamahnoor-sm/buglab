import { Badge } from "@/components/ui/Badge";
import { CATEGORIES } from "@/data/catalog/categories";
import type { AdminChallengeDetail } from "@/types/admin";
import { ChallengeCard } from "../challenge/ChallengeCard";
import { STATUS_DISPLAY } from "./ChallengeInventory";

const inputClass =
  "mt-1 block w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-80";
const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-muted";

/**
 * One challenge's public metadata (read-only form), its publication readiness
 * checklist and a preview of how its card appears. Editing is shown disabled
 * on purpose: challenges are registered in code, so there is no store a save
 * could write to and no publishing pipeline yet.
 */
export function ChallengeReview({ detail }: { detail: AdminChallengeDetail }) {
  const { summary, listing, checks, row } = detail;
  const status = STATUS_DISPLAY[row.status];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form aria-labelledby="metadata-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="metadata-heading" className="text-base font-semibold text-foreground">Public metadata</h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p role="note" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Read-only. Challenges are registered in code (src/data/catalog); editing here will be enabled once accounts,
          durable storage and a publishing pipeline exist.
        </p>
        <fieldset disabled className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={labelClass}>Title</span>
            <input className={inputClass} defaultValue={summary.title} />
          </label>
          <label className="sm:col-span-2">
            <span className={labelClass}>Short description</span>
            <textarea className={inputClass} rows={3} defaultValue={listing.description} />
          </label>
          <label>
            <span className={labelClass}>Category</span>
            <select className={inputClass} defaultValue={listing.category}>
              {CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>{category.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>Difficulty</span>
            <input className={inputClass} defaultValue={summary.difficulty} />
          </label>
          <label>
            <span className={labelClass}>Technologies</span>
            <input className={inputClass} defaultValue={listing.technologies.join(", ")} />
          </label>
          <label>
            <span className={labelClass}>Estimated minutes</span>
            <input className={inputClass} type="number" defaultValue={summary.estimatedMinutes} />
          </label>
          <label>
            <span className={labelClass}>Published on</span>
            <input className={inputClass} defaultValue={listing.publishedAt ?? ""} placeholder="Not published" />
          </label>
          <label className="flex items-center gap-2 self-end text-sm text-muted">
            <input type="checkbox" defaultChecked={listing.featured === true} />
            Featured
          </label>
        </fieldset>
      </form>

      <div className="flex flex-col gap-6">
        <section aria-labelledby="readiness-heading" className="rounded-lg border border-border bg-surface p-5">
          <h2 id="readiness-heading" className="text-base font-semibold text-foreground">Publication readiness</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {checks.map((check) => (
              <li key={check.id} className="flex gap-2">
                <span aria-hidden="true" className={check.passed ? "text-success" : "text-danger"}>{check.passed ? "✓" : "✕"}</span>
                <span>
                  <span className="text-foreground">{check.label}</span>
                  <span className="sr-only">{check.passed ? ": passes" : ": fails"}</span>
                  {check.detail && <span className="block text-xs text-danger">{check.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="preview-heading" className="flex flex-col gap-3">
          <h2 id="preview-heading" className="text-base font-semibold text-foreground">Card preview</h2>
          <ChallengeCard challenge={summary} titleAs="h3" />
        </section>
      </div>
    </div>
  );
}
