/* Answer key for Challenge 009: October Is Short. Server-only; registered in src/server/content. */
import "server-only";
import { challenge009 } from "@/data/challenge-009";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge009, {
  revision: "1",
  correctRootCauseId: "end-date-exclusive",
  resolutionSummary:
    "The export dialog labels its end date \"To (inclusive)\", but DateRange.of turns that date into its first instant " +
    "(to.atStartOfDay(UTC)) and SalesRepository uses it as an exclusive bound (created_at < end). Exporting 1 to 31 October " +
    "therefore queries up to 2026-10-31T00:00:00Z and leaves out all of 31 October: the preview's lastDay is 2026-10-30, a " +
    "single-day export has start equal to end and returns nothing, and exporting to 1 November matches the dashboard exactly. " +
    "The missing 47 orders and 3,912.40 are 31 October's sales, which is why the gap changes from month to month. All the " +
    "boundaries are midnight UTC (no time zone shift), 1,284 rows is no cap, and the later export found every October order. " +
    "Using to.plusDays(1).atStartOfDay(UTC) as the end keeps the half-open range and includes the chosen day.",
  observations: [
    { id: "range-ends-at-midnight", why: "The query ends at the first instant of the chosen last day", logs: [3, 9] },
    { id: "last-day-missing", why: "The export's last day is the 30th, not the 31st", requests: [1] },
    { id: "single-day-empty", why: "A one-day export returns no rows", logs: [10], requests: [3] },
    { id: "next-day-end-matches", why: "Ending on 1 November matches the dashboard exactly", logs: [14], requests: [4] },
    { id: "dashboard-total", why: "The dashboard's October figure is the reference", logs: [6], requests: [2] },
  ],
  investigationHints: [
    "Compare the dates the user chose with the exact instants the query used, for every export in the logs.",
    "Try the arithmetic: how many orders and how much revenue separate the two October figures, and where could they come from?",
  ],
});
