/*
 * Calendar days in the learner's local time zone. Recall is scheduled in days,
 * not in 24-hour periods: something reflected on at 23:50 is due the next
 * morning, not the next night. Day arithmetic works on the calendar date, so
 * month ends, leap years and daylight-saving changes cannot shift a due day.
 */
import type { LocalDay } from "./model";

const pad = (value: number) => String(value).padStart(2, "0");

/** The local calendar day of an instant. */
export function localDay(date: Date): LocalDay {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parts(day: LocalDay): [number, number, number] {
  const [year, month, date] = day.split("-").map(Number);
  return [year, month, date];
}

/** The day `count` calendar days after `day` (negative for before). */
export function addDays(day: LocalDay, count: number): LocalDay {
  const [year, month, date] = parts(day);
  // UTC arithmetic on the calendar date: no time zone or DST can move it.
  const result = new Date(Date.UTC(year, month - 1, date + count));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: LocalDay, to: LocalDay): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** A local day as a Date at local noon, for display formatting only. */
export function dayAsDate(day: LocalDay): Date {
  const [year, month, date] = parts(day);
  return new Date(year, month - 1, date, 12);
}
