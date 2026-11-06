"use client";

import { useState } from "react";
import { buttonSecondary } from "@/components/journal/ui";
import { dayOf, formatDay, plural } from "@/components/journal/format";
import { addDays } from "@/lib/learning/days";
import type { LocalDay } from "@/lib/learning/model";
import type { ActivityEvent } from "@/lib/progress/activity";
import type { PublicChallenge } from "@/types/catalog";
import { SectionHeading, titleOf } from "./shared";

/** Events shown at first, and added by each "Show earlier activity". */
const PAGE = 12;

const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

const TONE: Record<ActivityEvent["kind"], string> = {
  solved: "bg-success",
  "solved-again": "bg-success/60",
  reflected: "bg-accent",
  "reflection-edited": "bg-accent/60",
  recalled: "bg-warning",
  "practice-opened": "bg-[var(--cat-api)]",
};

function describe(event: ActivityEvent, byId: ReadonlyMap<string, PublicChallenge>): { action: string; title: string; detail?: string } {
  const title = titleOf(byId, event.challengeId);
  switch (event.kind) {
    case "solved":
      return { action: "Solved", title, detail: "Diagnosis confirmed correct in this browser" };
    case "solved-again":
      return { action: "Solved again", title, detail: `Solved ${plural(event.timesSolved, "time")} in all; this is the latest` };
    case "reflected":
      return { action: "Wrote a takeaway for", title };
    case "reflection-edited":
      return { action: "Edited the reflection on", title };
    case "recalled":
      return {
        action: "Recalled",
        title,
        detail: `${event.response === "got-it" ? "Got it" : "Need practice"}${event.reviewsThatDay > 1 ? ` · reviewed ${event.reviewsThatDay} times that day, the last answer counts` : ""}`,
      };
    case "practice-opened":
      return { action: "Opened to practise", title, detail: `Related to ${titleOf(byId, event.fromChallengeId)}` };
  }
}

function dayHeading(day: LocalDay, today: LocalDay): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return formatDay(day);
}

/**
 * Learning Activity: what the learning record holds, newest first and grouped
 * by local day. It shows only recorded events; the record keeps the first and
 * latest solve of a challenge, so repeats in between are summarised, not listed.
 */
export function ActivityTimeline({
  id,
  events,
  published,
  today,
}: {
  id: string;
  events: ActivityEvent[];
  published: readonly PublicChallenge[];
  today: LocalDay;
}) {
  const [shown, setShown] = useState(PAGE);
  const byId = new Map(published.map((challenge) => [challenge.id, challenge]));
  const visible = events.slice(0, shown);
  const days: { day: LocalDay; events: ActivityEvent[] }[] = [];
  for (const event of visible) {
    const day = dayOf(event.at);
    const last = days.at(-1);
    if (last?.day === day) last.events.push(event);
    else days.push({ day, events: [event] });
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <SectionHeading id={id} eyebrow="04" title="Learning activity" detail="Solves, reflections, recall reviews and practice, as recorded in this browser." />
      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-card-border-hover bg-panel px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No activity yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">
            Your timeline fills in as you solve challenges, write takeaways and recall them. Nothing is added that you didn&apos;t do.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-card-border bg-card p-5 shadow-card sm:p-6">
          <ol className="flex flex-col gap-6">
            {days.map((group) => (
              <li key={group.day}>
                <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">{dayHeading(group.day, today)}</h3>
                <ol className="relative mt-3 flex flex-col gap-4 border-l border-card-border pl-5">
                  {group.events.map((event) => {
                    const text = describe(event, byId);
                    return (
                      <li key={`${event.kind}-${event.challengeId}-${event.at}`} className="relative">
                        <span aria-hidden="true" className={`absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-card ${TONE[event.kind]}`} />
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                          <p className="min-w-0 text-sm leading-snug text-muted">
                            {text.action} <span className="font-medium text-foreground">{text.title}</span>
                          </p>
                          <time dateTime={event.at} className="shrink-0 font-mono text-xs text-subtle tabular-nums">
                            {time.format(new Date(event.at))}
                          </time>
                        </div>
                        {text.detail ? <p className="mt-0.5 text-xs text-subtle">{text.detail}</p> : null}
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
          {events.length > shown ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-card-border pt-4">
              <p className="text-xs text-subtle">
                Showing {shown} of {events.length} events
              </p>
              <button type="button" onClick={() => setShown((count) => count + PAGE)} className={buttonSecondary}>
                Show earlier activity
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
