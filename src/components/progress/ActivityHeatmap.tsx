"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { plural } from "@/components/journal/format";
import { buttonSmall } from "@/components/journal/ui";
import { findByData } from "@/lib/dom";
import { addDays, dayAsDate } from "@/lib/learning/days";
import type { LocalDay } from "@/lib/learning/model";
import { calendarRange, INTENSITY_LEVELS, type DayActivity } from "@/lib/progress/calendar";

/** Weeks shown: a rolling year on wide screens, half a year on tablets, about three months on phones. */
const RANGES = [
  { query: "(min-width: 64rem)", weeks: 53 },
  { query: "(min-width: 40rem)", weeks: 26 },
] as const;
const PHONE_WEEKS = 14;

function subscribe(onChange: () => void) {
  const lists = RANGES.map((range) => window.matchMedia(range.query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}
const weeksForWindow = () => RANGES.find((range) => window.matchMedia(range.query).matches)?.weeks ?? PHONE_WEEKS;

/** How many weeks fit this window. The server never renders the calendar (it needs the learner's day), so its value is only a default. */
export function useCalendarWeeks(): number {
  return useSyncExternalStore(subscribe, weeksForWindow, () => RANGES[0].weeks);
}

const longDate = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const monthName = new Intl.DateTimeFormat("en-GB", { month: "short" });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const LEVEL_CLASS = ["bg-field ring-1 ring-inset ring-card-border", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4"] as const;

/** "3 activities: 1 first solve, 1 reflection, 1 recall review" */
export function describeDay(activity: DayActivity | null): string {
  if (!activity || activity.total === 0) return "No learning activity";
  const parts = [
    activity.solves ? plural(activity.solves, "first solve") : null,
    activity.reflections ? plural(activity.reflections, "reflection") : null,
    activity.reviews ? plural(activity.reviews, "recall review") : null,
  ].filter(Boolean);
  return `${activity.total} ${activity.total === 1 ? "activity" : "activities"}: ${parts.join(", ")}`;
}

/**
 * A GitHub-style calendar of meaningful learning activity per local day.
 *
 * Keyboard: the calendar is one tab stop (a grid with a roving focus). Arrow
 * keys move a day (up and down) or a week (left and right); Home and End go to
 * the first and last day shown; Page Up and Page Down move a whole range, as
 * do the Earlier and Later buttons. Hovering or focusing a day shows its date
 * and what was done in the details line, which screen readers also get as the
 * day's label.
 */
export function ActivityHeatmap({
  days,
  today,
  firstActive,
  weeks,
}: {
  days: ReadonlyMap<LocalDay, DayActivity>;
  today: LocalDay;
  firstActive: LocalDay | null;
  weeks: number;
}) {
  const [end, setEnd] = useState<LocalDay>(today);
  const [focused, setFocused] = useState<LocalDay>(today);
  const [hovered, setHovered] = useState<LocalDay | null>(null);
  const moveFocus = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const helpId = useId();

  const range = calendarRange(days, end > today ? today : end, weeks, today);
  const showsToday = range.end === today;
  const canEarlier = firstActive !== null && firstActive < range.start;
  const inRange = (day: LocalDay) => day >= range.start && day <= range.end;
  const current = inRange(focused) ? focused : range.end;

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    findByData(grid.current, "data-day", current)?.focus();
  }, [current]);

  const page = (direction: -1 | 1) => {
    const next = direction < 0 ? addDays(range.start, -1) : addDays(range.end, 7 * weeks);
    const clamped = next > today ? today : next;
    setEnd(clamped);
    return clamped;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    let target: LocalDay | null = null;
    if (event.key in steps) target = addDays(current, steps[event.key]);
    else if (event.key === "Home") target = range.start;
    else if (event.key === "End") target = range.end;
    else if (event.key === "PageUp" && canEarlier) target = page(-1);
    else if (event.key === "PageDown" && !showsToday) target = page(1);
    if (target === null) return;
    event.preventDefault();
    if (target > today) target = today;
    if (target < range.start) {
      if (!canEarlier) return;
      setEnd(target);
    } else if (target > range.end) {
      setEnd(target);
    }
    moveFocus.current = true;
    setFocused(target);
  };

  const shown = hovered ?? current;
  const label = `${monthYear.format(dayAsDate(range.start))} to ${monthYear.format(dayAsDate(range.end))}`;
  const columns = { gridTemplateColumns: `1.75rem repeat(${weeks}, minmax(0, 1fr))` };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground" aria-live="polite">
          {label}
        </p>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => page(-1)} disabled={!canEarlier} className={buttonSmall}>
            <span aria-hidden="true">‹</span> Earlier
          </button>
          <button type="button" onClick={() => page(1)} disabled={showsToday} className={buttonSmall}>
            Later <span aria-hidden="true">›</span>
          </button>
          {!showsToday ? (
            <button type="button" onClick={() => {
                setEnd(today);
                setFocused(today);
              }} className={buttonSmall}>
              Today
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-w-0">
        <div aria-hidden="true" className="grid gap-[3px] pb-1 text-[0.6875rem] text-subtle" style={columns}>
          <span />
          {range.weeks.map((_, column) => {
            const month = range.months.find((m) => m.column === column);
            return (
              <span key={column} className="overflow-visible whitespace-nowrap">
                {month ? monthName.format(dayAsDate(month.month)) : ""}
              </span>
            );
          })}
        </div>
        <div
          ref={grid}
          role="grid"
          aria-label={`Learning activity by day, ${label}`}
          aria-describedby={helpId}
          onKeyDown={onKeyDown}
          onMouseLeave={() => setHovered(null)}
          className="flex flex-col gap-[3px]"
        >
          {WEEKDAYS.map((weekdayName, row) => (
            <div key={weekdayName} role="row" className="grid gap-[3px]" style={columns}>
              <span role="rowheader" className="flex items-center text-[0.6875rem] leading-none text-subtle">
                <span aria-hidden="true">{row % 2 === 0 && row < 6 ? weekdayName.slice(0, 3) : ""}</span>
                <span className="sr-only">{weekdayName}</span>
              </span>
              {range.weeks.map((week) => {
                const cell = week[row];
                if (cell.future) return <span key={cell.day} role="gridcell" aria-hidden="true" className="aspect-square" />;
                const isCurrent = cell.day === current;
                const description = `${longDate.format(dayAsDate(cell.day))}: ${describeDay(cell.activity)}${cell.day === today ? " (today)" : ""}`;
                return (
                  <span
                    key={cell.day}
                    role="gridcell"
                    data-day={cell.day}
                    data-level={cell.level}
                    tabIndex={isCurrent ? 0 : -1}
                    aria-label={description}
                    aria-selected={isCurrent}
                    onFocus={() => setFocused(cell.day)}
                    onClick={() => setFocused(cell.day)}
                    onMouseEnter={() => setHovered(cell.day)}
                    className={`aspect-square rounded-[3px] transition-shadow duration-150 ${LEVEL_CLASS[cell.level]} ${
                      cell.day === shown ? "shadow-[0_0_0_2px_var(--foreground)]" : ""
                    } ${cell.day === today ? "outline outline-1 outline-offset-1 outline-accent/60" : ""} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="min-h-5 text-xs text-muted">
          <span className="font-medium text-foreground">{longDate.format(dayAsDate(shown))}</span>
          <span aria-hidden="true"> · </span>
          {describeDay(days.get(shown) ?? null)}
        </p>
        <div className="flex items-center gap-2 text-xs text-subtle">
          <span aria-hidden="true">Less</span>
          <ul aria-label="Activity levels" className="flex items-center gap-[3px]">
            {INTENSITY_LEVELS.map(({ level, label: levelLabel }) => (
              <li key={level} title={levelLabel} className={`size-3 rounded-[3px] ${LEVEL_CLASS[level]}`}>
                <span className="sr-only">{levelLabel}</span>
              </li>
            ))}
          </ul>
          <span aria-hidden="true">More</span>
        </div>
      </div>
      <p id={helpId} className="sr-only">
        Use the arrow keys to move between days, Home and End for the first and last day shown, and Page Up or Page Down for earlier or later
        periods.
      </p>
    </div>
  );
}
