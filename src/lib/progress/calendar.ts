/*
 * The learning calendar: which local days had meaningful learning activity,
 * how much, and the streaks they form. Derived from the learning record when
 * read; nothing is stored.
 *
 * Meaningful activity, counted once each:
 *   solve       the first confirmed solve of a challenge (its local day)
 *   reflection  a reflection written (the day it was first saved; later edits
 *               change the same reflection and are not counted again)
 *   review      a recall review: one per reflection per day reviewed, the
 *               same rule the Journal's schedule uses
 * Not counted: opening a practice case, visiting a page, repeat solves. The
 * record keeps only the first and latest time of a repeat solve, so repeats
 * cannot be dated honestly; the first solve is the learning event.
 *
 * Days are local calendar days (lib/learning/days), exactly as recall is
 * scheduled, so a review at 23:50 and one at 00:10 fall on different days.
 *
 * Streaks:
 *   active day      a local day with at least one meaningful activity
 *   current streak  the run of consecutive active days ending today. If
 *                   nothing has happened today yet but yesterday was active,
 *                   the run ending yesterday still counts: today is not over.
 *                   Otherwise it is 0.
 *   longest streak  the longest run of consecutive active days on record
 * Days after today (a device clock that was ahead) are left out of all of it.
 */
import { addDays, daysBetween, localDay } from "@/lib/learning/days";
import type { LocalDay } from "@/lib/learning/model";
import type { ProgressSource } from "./source";

export interface DayActivity {
  day: LocalDay;
  solves: number;
  reflections: number;
  reviews: number;
  total: number;
}

export interface Streaks {
  current: number;
  /** True when the current streak ended yesterday: it continues if there is activity today. */
  openToday: boolean;
  longest: number;
  activeDays: number;
  /** The first active day on record, or null. */
  firstActive: LocalDay | null;
}

/** The local day of a stored instant. */
const dayOfInstant = (iso: string): LocalDay => localDay(new Date(iso));

/** Meaningful activity per local day, up to and including `today`. */
export function activityByDay(source: ProgressSource, today: LocalDay): Map<LocalDay, DayActivity> {
  const { record } = source;
  const days = new Map<LocalDay, DayActivity>();
  const add = (day: LocalDay, kind: "solves" | "reflections" | "reviews") => {
    if (day > today) return;
    const entry = days.get(day) ?? { day, solves: 0, reflections: 0, reviews: 0, total: 0 };
    entry[kind] += 1;
    entry.total += 1;
    days.set(day, entry);
  };

  for (const solve of Object.values(record.solves)) add(dayOfInstant(solve.firstSolvedAt), "solves");
  for (const entry of Object.values(record.reflections)) {
    add(dayOfInstant(entry.reflectedAt), "reflections");
    for (const day of new Set(entry.recall.attempts.map((attempt) => attempt.day))) add(day, "reviews");
  }
  return days;
}

export function streaks(days: ReadonlyMap<LocalDay, DayActivity>, today: LocalDay): Streaks {
  const active = [...days.keys()].filter((day) => day <= today).sort();
  let longest = 0;
  let run = 0;
  for (let i = 0; i < active.length; i++) {
    run = i > 0 && daysBetween(active[i - 1], active[i]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const has = new Set(active);
  const yesterday = addDays(today, -1);
  const end = has.has(today) ? today : has.has(yesterday) ? yesterday : null;
  let current = 0;
  for (let day = end; day && has.has(day); day = addDays(day, -1)) current += 1;

  return { current, openToday: end === yesterday, longest, activeDays: active.length, firstActive: active[0] ?? null };
}

/** Intensity 0–4 for a day's activity count: 0 none, 1 one, 2 two, 3 three or four, 4 five or more. */
export function intensity(total: number): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0) return 0;
  if (total === 1) return 1;
  if (total === 2) return 2;
  if (total <= 4) return 3;
  return 4;
}

/** The intensity legend, in order. */
export const INTENSITY_LEVELS = [
  { level: 0, label: "No activity" },
  { level: 1, label: "1 activity" },
  { level: 2, label: "2 activities" },
  { level: 3, label: "3 to 4 activities" },
  { level: 4, label: "5 or more activities" },
] as const;

/** Day of the week, Monday = 0 … Sunday = 6, from the calendar date alone (no time zone). */
export function weekday(day: LocalDay): number {
  const [year, month, date] = day.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
}

export interface CalendarCell {
  day: LocalDay;
  activity: DayActivity | null;
  level: 0 | 1 | 2 | 3 | 4;
  /** After `today`: shown as an empty slot, not a day that can be inspected. */
  future: boolean;
}

export interface CalendarRange {
  /** Columns of seven days, Monday first, oldest week first. */
  weeks: CalendarCell[][];
  start: LocalDay;
  /** The last day shown that is not in the future. */
  end: LocalDay;
  /** Columns where a new month starts, for labels. */
  months: { column: number; month: LocalDay }[];
}

/**
 * `count` whole weeks ending with the week that contains `end`. Cells after
 * `today` are marked future. Weeks run Monday to Sunday.
 */
export function calendarRange(days: ReadonlyMap<LocalDay, DayActivity>, end: LocalDay, count: number, today: LocalDay): CalendarRange {
  const lastMonday = addDays(end, -weekday(end));
  const start = addDays(lastMonday, -7 * (count - 1));
  const weeks: CalendarCell[][] = [];
  const months: { column: number; month: LocalDay }[] = [];
  for (let column = 0; column < count; column++) {
    const week: CalendarCell[] = [];
    for (let row = 0; row < 7; row++) {
      const day = addDays(start, column * 7 + row);
      const activity = days.get(day) ?? null;
      week.push({ day, activity, level: intensity(activity?.total ?? 0), future: day > today });
      if (day.endsWith("-01") || (column === 0 && row === 0)) {
        const month = `${day.slice(0, 7)}-01`;
        if (!months.some((m) => m.month === month)) months.push({ column, month });
      }
    }
    weeks.push(week);
  }
  // A month label needs a little room: drop one that would sit right after another.
  const spaced = months.filter((m, i) => i === months.length - 1 || months[i + 1].column - m.column >= 2);
  return { weeks, start, end: end > today ? today : end, months: spaced };
}
