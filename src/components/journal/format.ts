/*
 * How the Learning Loop words dates. Days are local calendar days (see
 * lib/learning/days.ts); every label is relative to the learner's today.
 */
import { dayAsDate, daysBetween, localDay } from "@/lib/learning/days";
import type { LocalDay } from "@/lib/learning/model";

const dateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const plainDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "Fri 8 Nov" */
export const formatDay = (day: LocalDay) => dateFormat.format(dayAsDate(day));

/** "5 Nov 2026", for a stored instant. */
export const formatInstant = (iso: string) => plainDate.format(new Date(iso));

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** When a review is due, relative to today: "Due today", "Overdue by 2 days", "Due tomorrow", "Due Fri 8 Nov (in 3 days)". */
export function dueLabel(dueOn: LocalDay, today: LocalDay): string {
  const days = daysBetween(today, dueOn);
  if (days === 0) return "Due today";
  if (days < 0) return `Overdue by ${plural(-days, "day")}`;
  if (days === 1) return "Due tomorrow";
  return `Due ${formatDay(dueOn)} (in ${plural(days, "day")})`;
}

/** After a review: "Next review tomorrow" or "Next review Fri 8 Nov, in 3 days". */
export function nextReviewLabel(dueOn: LocalDay, today: LocalDay): string {
  const days = daysBetween(today, dueOn);
  return days === 1 ? "Next review tomorrow" : `Next review ${formatDay(dueOn)}, in ${plural(days, "day")}`;
}

/** The local day of a stored instant. */
export const dayOf = (iso: string) => localDay(new Date(iso));
