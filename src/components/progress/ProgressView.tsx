"use client";

import Link from "next/link";
import { useId, useMemo } from "react";
import { buttonPrimary, card, focusRing } from "@/components/journal/ui";
import { useLearning, type LearningActions, type LearningState } from "@/components/journal/useLearning";
import { useToday } from "@/components/journal/useToday";
import { ArrowRightIcon } from "@/components/ui/icons";
import { ROUTES } from "@/lib/challenge-routes";
import type { LocalDay } from "@/lib/learning/model";
import { learningActivity } from "@/lib/progress/activity";
import { activityByDay, streaks } from "@/lib/progress/calendar";
import { continueLearning } from "@/lib/progress/next-steps";
import { progressOverview } from "@/lib/progress/overview";
import { skillBreakdown } from "@/lib/progress/skills";
import { browserProgress } from "@/lib/progress/source";
import type { PublicChallenge } from "@/types/catalog";
import { ActivityTimeline } from "./ActivityTimeline";
import { ContinueLearning } from "./ContinueLearning";
import { OverviewSection } from "./OverviewSection";
import { SkillBreakdown } from "./SkillBreakdown";

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <p className="sr-only">Loading your progress…</p>
      <div aria-hidden="true" className={`${card} h-72 animate-pulse motion-reduce:animate-none`} />
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">
        <div className={`${card} h-40 animate-pulse motion-reduce:animate-none`} />
        <div className={`${card} h-40 animate-pulse motion-reduce:animate-none`} />
      </div>
    </div>
  );
}

/**
 * Learning Progress for a given learning state. Pure: everything shown is
 * derived from `state.record` and the published catalog when it renders, so a
 * new solve, reflection or review shows up as soon as the record changes.
 */
export function ProgressView({
  state,
  published,
  actions,
  today,
}: {
  state: LearningState;
  published: readonly PublicChallenge[];
  actions: LearningActions;
  today: LocalDay | null;
}) {
  const id = useId();
  const record = state.record;
  const derived = useMemo(() => {
    if (today === null) return null;
    const source = browserProgress(record);
    const days = activityByDay(source, today);
    return {
      days,
      streaks: streaks(days, today),
      overview: progressOverview(source, published, today),
      categories: skillBreakdown(source, published),
      steps: continueLearning(source, published, today),
      events: learningActivity(source),
    };
  }, [record, published, today]);

  if (state.status === "loading" || derived === null || today === null) return <Loading />;

  if (state.status === "unavailable") {
    return (
      <div role="status" className={`${card} px-6 py-8`}>
        <h2 className="text-base font-semibold text-foreground">Progress is unavailable in this browser</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          This browser is not letting BugLab read or save learning data (for example in some private windows, or when site data is blocked).
          Challenges still work; progress needs that storage to be allowed.
        </p>
      </div>
    );
  }

  const { overview, categories, steps, events, days } = derived;
  const unreadable = state.problems.length > 0 || state.recoveryKeys.length > 0;

  return (
    <div className="flex flex-col gap-12">
      {unreadable ? (
        <div role="status" className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-relaxed text-foreground">
          Some saved learning data could not be read, so it is not counted here. It has been kept safe; the{" "}
          <Link href={ROUTES.journal} className={`rounded font-medium text-accent underline underline-offset-4 ${focusRing}`}>
            Journal
          </Link>{" "}
          explains what happened and lets you download it.
        </div>
      ) : null}

      {overview.solved === 0 && events.length === 0 ? (
        <section aria-labelledby={`${id}-start`} className={`${card} featured-glow relative overflow-hidden px-6 py-10 sm:px-10`}>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">Getting started</p>
          <h2 id={`${id}-start`} className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Your progress starts with your first solved challenge
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Open a challenge, follow the evidence and submit a diagnosis. When it is confirmed correct, it is counted here, and your Journal
            offers a short reflection to recall later. Below is the whole catalog, ready to explore.
          </p>
          <Link href={ROUTES.library} className={`${buttonPrimary} mt-6`}>
            Browse challenges
            <ArrowRightIcon />
          </Link>
        </section>
      ) : null}

      <OverviewSection id={`${id}-overview`} overview={overview} days={days} streaks={derived.streaks} today={today} />
      <ContinueLearning id={`${id}-next`} steps={steps} today={today} actions={actions} />
      <SkillBreakdown id={`${id}-skills`} categories={categories} />
      <ActivityTimeline id={`${id}-activity`} events={events} published={published} today={today} />
    </div>
  );
}

/** Learning Progress for this browser, kept current as the record and the day change. */
export function ProgressScreen({ published }: { published: readonly PublicChallenge[] }) {
  const { state, actions } = useLearning();
  const today = useToday();
  return <ProgressView state={state} published={published} actions={actions} today={today} />;
}
