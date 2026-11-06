import { CATEGORIES } from "@/data/catalog/categories";
import { byCatalogOrder } from "@/lib/catalog/catalog";
import { formatDay, plural } from "@/components/journal/format";
import type { LocalDay } from "@/lib/learning/model";
import type { ProgressOverview } from "@/lib/progress/overview";
import type { PublicChallenge } from "@/types/catalog";
import { categoryAccent } from "../challenge/library/category-style";
import { SectionHeading } from "./shared";

interface Metric {
  label: string;
  value: number;
  /** What the value is out of, when that is meaningful. */
  of?: string;
  status?: string;
  explain: string;
}

function metrics(overview: ProgressOverview, today: LocalDay): Metric[] {
  const due = overview.reviewsDue;
  return [
    {
      label: "Challenges solved",
      value: overview.solved,
      of: `of ${overview.total}`,
      explain: "Completed in this browser: the diagnosis was confirmed correct while you worked here.",
    },
    {
      label: "Reflections written",
      value: overview.reflections,
      of: overview.solved ? `for ${plural(overview.solved, "solved challenge")}` : undefined,
      status: overview.awaitingReflection ? `${overview.awaitingReflection} solved without a takeaway yet` : undefined,
      explain: "Takeaways you wrote after solving. Each one comes back for recall.",
    },
    {
      label: "Recall reviews",
      value: overview.reviewsDone,
      of: "completed",
      status:
        due > 0
          ? `${plural(due, "review")} due now`
          : overview.nextReviewOn
            ? `Next review ${overview.nextReviewOn === today ? "today" : formatDay(overview.nextReviewOn)}`
            : undefined,
      explain: "Times you recalled a takeaway from memory. Several reviews of one takeaway on the same day count once.",
    },
    {
      label: "Categories explored",
      value: overview.categoriesExplored,
      of: `of ${overview.categoriesTotal}`,
      explain: "Areas with at least one solved challenge. This shows coverage, not skill level.",
    },
  ];
}

/**
 * Learning Overview: a map of every published challenge (filled when solved
 * here, in its category's colour) beside the four headline counts.
 */
export function OverviewSection({
  id,
  overview,
  published,
  solvedIds,
  today,
}: {
  id: string;
  overview: ProgressOverview;
  published: readonly PublicChallenge[];
  solvedIds: ReadonlySet<string>;
  today: LocalDay;
}) {
  const order = new Map(CATEGORIES.map((category, index) => [category.id, index]));
  const cells = [...published].sort((a, b) => order.get(a.category)! - order.get(b.category)! || byCatalogOrder(a, b));
  const reviewsDue = overview.reviewsDue > 0;

  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <SectionHeading id={id} eyebrow="01" title="Learning overview" detail="Counted from your Learning Journal in this browser, as it is right now." />
      <div className="featured-glow relative grid gap-8 overflow-hidden rounded-2xl border border-card-border bg-card p-5 shadow-card sm:p-7 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-10">
        <div className="flex flex-col gap-5">
          <p className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold tracking-tight text-foreground tabular-nums sm:text-6xl">{overview.solved}</span>
            <span className="text-base text-muted">of {overview.total} challenges solved</span>
          </p>
          <div
            role="img"
            aria-label={`${overview.solved} of ${overview.total} published challenges solved in this browser, grouped by category`}
            className="grid grid-cols-10 gap-1.5"
          >
            {cells.map((challenge) => (
              <span
                key={challenge.id}
                style={categoryAccent(challenge.category)}
                className={`category-accent aspect-square rounded-[5px] border ${
                  solvedIds.has(challenge.id)
                    ? "border-transparent bg-[var(--cat)] shadow-[0_0_0_3px_var(--cat-tint)]"
                    : "border-card-border bg-field"
                }`}
              />
            ))}
          </div>
          <p className="text-xs leading-relaxed text-subtle">
            Each square is a published challenge, grouped by category. Filled squares are solved in this browser.
            {overview.unlisted > 0 ? ` ${plural(overview.unlisted, "solve")} for challenges no longer in the catalog ${overview.unlisted === 1 ? "is" : "are"} kept but not counted.` : ""}
          </p>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          {metrics(overview, today).map((metric) => (
            <div key={metric.label} className="flex flex-col rounded-xl border border-panel-border bg-panel p-4">
              <dt className="text-xs font-medium uppercase tracking-[0.12em] text-subtle">{metric.label}</dt>
              <dd className="mt-2 flex flex-wrap items-baseline gap-x-2">
                <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">{metric.value}</span>
                {metric.of ? <span className="text-sm text-muted">{metric.of}</span> : null}
              </dd>
              {metric.status ? (
                <dd
                  className={`mt-2 w-fit rounded-md border px-2 py-0.5 text-xs font-medium ${
                    metric.label === "Recall reviews" && reviewsDue ? "border-warning/30 bg-warning/10 text-warning" : "border-card-border bg-field text-muted"
                  }`}
                >
                  {metric.status}
                </dd>
              ) : null}
              <dd className="mt-auto pt-3 text-xs leading-relaxed text-muted">{metric.explain}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
