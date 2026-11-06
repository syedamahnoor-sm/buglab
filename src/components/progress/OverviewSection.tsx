"use client";

import { formatDay, plural } from "@/components/journal/format";
import { dayAsDate } from "@/lib/learning/days";
import type { LocalDay } from "@/lib/learning/model";
import type { DayActivity, Streaks } from "@/lib/progress/calendar";
import type { ProgressOverview } from "@/lib/progress/overview";
import { ActivityHeatmap, useCalendarWeeks } from "./ActivityHeatmap";
import type { VerifiedState } from "@/lib/verified/model";
import { SectionHeading } from "./shared";
import { VerificationStatus } from "./VerificationStatus";

interface Metric {
  label: string;
  value: number;
  /** What the value is out of, when that is meaningful. */
  of?: string;
  status?: { text: string; tone: "neutral" | "due" };
  explain: string;
}

function metrics(overview: ProgressOverview, today: LocalDay): Metric[] {
  const due = overview.reviewsDue;
  return [
    {
      label: "Challenges solved",
      value: overview.solved,
      of: `of ${overview.total}`,
      status: overview.verificationAvailable
        ? { text: `${overview.verified} verified · ${overview.browserOnly} in this browser only`, tone: "neutral" }
        : overview.unlisted
          ? { text: `${plural(overview.unlisted, "solve")} for retired challenges not counted`, tone: "neutral" }
          : undefined,
      explain: overview.verificationAvailable
        ? "Solved in this browser or verified by BugLab's server. Only the server's confirmations count as verified."
        : "Completed in this browser: the diagnosis was confirmed correct while you worked here.",
    },
    {
      label: "Reflections written",
      value: overview.reflections,
      of: overview.solved ? `for ${plural(overview.solved, "solved challenge")}` : undefined,
      status: overview.awaitingReflection ? { text: `${overview.awaitingReflection} solved without a takeaway yet`, tone: "neutral" } : undefined,
      explain: "Takeaways you wrote after solving. Each one comes back for recall.",
    },
    {
      label: "Recall reviews",
      value: overview.reviewsDone,
      of: "completed",
      status:
        due > 0
          ? { text: `${plural(due, "review")} due now`, tone: "due" }
          : overview.nextReviewOn
            ? { text: `Next review ${overview.nextReviewOn === today ? "today" : formatDay(overview.nextReviewOn)}`, tone: "neutral" }
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

const withYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "Fri 6 Nov" this year; "12 Sept 2025" for an earlier year, so the date is never ambiguous. */
export function sinceLabel(day: LocalDay, today: LocalDay): string {
  return day.slice(0, 4) === today.slice(0, 4) ? formatDay(day) : withYear.format(dayAsDate(day));
}

export function streakNote(streaks: Streaks): string {
  if (streaks.current > 0 && streaks.openToday) return "Active yesterday. Any solve, reflection or review today continues it.";
  if (streaks.current > 0) return "Including today.";
  return streaks.activeDays ? "Your next solve, reflection or review starts a new one." : "Starts with your first solve, reflection or review.";
}

/**
 * Learning Overview: daily learning activity (streaks and a calendar heatmap)
 * above the four headline counts.
 */
export function OverviewSection({
  id,
  overview,
  days,
  streaks,
  today,
  verified,
}: {
  id: string;
  overview: ProgressOverview;
  days: ReadonlyMap<LocalDay, DayActivity>;
  streaks: Streaks;
  today: LocalDay;
  verified: VerifiedState;
}) {
  const weeks = useCalendarWeeks();
  const unit = (value: number) => (value === 1 ? "day" : "days");
  const stats = [
    { label: "Current streak", value: streaks.current, note: streakNote(streaks) },
    { label: "Longest streak", value: streaks.longest, note: "Consecutive days with learning activity." },
    {
      label: "Active days",
      value: streaks.activeDays,
      note: streaks.firstActive ? `Since ${sinceLabel(streaks.firstActive, today)}.` : "Days with a solve, reflection or review.",
    },
  ];

  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <SectionHeading id={id} eyebrow="01" title="Learning overview" detail="Counted from your Learning Journal in this browser, as it is right now." />

      <div className="featured-glow relative flex flex-col gap-6 overflow-hidden rounded-2xl border border-card-border bg-card p-5 shadow-card sm:p-7">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold tracking-tight text-foreground">Daily learning activity</h3>
          <p className="text-xs leading-relaxed text-muted">
            First solves, reflections written and recall reviews, by local day. Opening a page or a practice case doesn&apos;t count.
          </p>
        </div>

        {/* Three across at every width; on phones the tiles are compact and only the current streak's note shows, below them. */}
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {stats.map((stat) => (
              <div key={stat.label} className="flex min-w-0 flex-col rounded-xl border border-panel-border bg-panel px-3 py-2.5 sm:px-4 sm:py-3">
                <dt className="text-[0.625rem] font-medium uppercase leading-tight tracking-[0.1em] text-subtle sm:text-xs sm:tracking-[0.12em]">{stat.label}</dt>
                <dd className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums sm:text-3xl">{stat.value}</span>
                  <span className="text-xs text-muted sm:text-sm">{unit(stat.value)}</span>
                </dd>
                <dd className="sr-only text-xs leading-relaxed text-muted sm:not-sr-only sm:mt-1">{stat.note}</dd>
              </div>
            ))}
          </dl>
          <p aria-hidden="true" className="text-xs leading-relaxed text-muted sm:hidden">
            {stats[0].note}
          </p>
        </div>

        <ActivityHeatmap key={`${today}-${weeks}`} days={days} today={today} firstActive={streaks.firstActive} weeks={weeks} />
      </div>

      <VerificationStatus verified={verified} overview={overview} />
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics(overview, today).map((metric) => (
          <div key={metric.label} className="flex flex-col rounded-2xl border border-card-border bg-card p-4 shadow-card">
            <dt className="text-xs font-medium uppercase tracking-[0.12em] text-subtle">{metric.label}</dt>
            <dd className="mt-2 flex flex-wrap items-baseline gap-x-2">
              <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">{metric.value}</span>
              {metric.of ? <span className="text-sm text-muted">{metric.of}</span> : null}
            </dd>
            {metric.status ? (
              <dd
                className={`mt-2 w-fit rounded-md border px-2 py-0.5 text-xs font-medium ${
                  metric.status.tone === "due" ? "border-warning/30 bg-warning/10 text-warning" : "border-card-border bg-field text-muted"
                }`}
              >
                {metric.status.text}
              </dd>
            ) : null}
            <dd className="mt-auto pt-3 text-xs leading-relaxed text-muted">{metric.explain}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
