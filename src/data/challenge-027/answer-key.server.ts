/* Answer key for Challenge 027: The Dashboard That Slowed Down. Server-only; registered in src/server/content. */
import "server-only";
import { challenge027 } from "@/data/challenge-027";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge027, {
  revision: "1",
  correctRootCauseId: "unbounded-fetch-app-aggregation",
  resolutionSummary:
    "The summary endpoint parses range=90d but never passes it to the database: eventsForWorkspace selects every event the " +
    "workspace has ever had (1,342,118 rows, of which 913,540 are older than 90 days). summary.ts then filters that whole list " +
    "once for each of the 90 days (90 x 1,342,118 = 120,790,620 rows scanned, 2,980 ms), and finally returns all of the rows as " +
    "\"recent\", a 40 MB response, although the dashboard shows only 20. Query (1,410 ms) + aggregation (2,980 ms) + " +
    "serialisation (410 ms) + 6 ms handing the response to Express is the 4,806 ms the request log reports, and the cost " +
    "grows with every event ever recorded, which " +
    "is why p95 rose in step with rows loaded (0.81 s at 210k, 1.92 s at 524k, 4.79 s at 1.33M). The index is used (Index Scan " +
    "on events_workspace_time), the database is at 22% CPU, top-pages aggregates in SQL in 31 ms, and rendering takes 120 ms. " +
    "Aggregating in SQL (date_trunc('day', occurred_at) with GROUP BY over the 90-day window) and fetching only the 20 recent " +
    "events with LIMIT fixes it.",
  observations: [
    { id: "all-rows-loaded", why: "The query returns every event for the workspace, not 90 days", logs: [5, 13] },
    { id: "repeated-app-aggregation", why: "Aggregation scans the full list once per day", logs: [7] },
    { id: "huge-response", why: "The response carries all 1.3M rows (40 MB) for a 20-row table", logs: [8], requests: [1] },
    { id: "time-adds-up", why: "The stage timings add up to the request time", logs: [4, 9] },
    { id: "latency-tracks-rows", why: "Latency grows in proportion to rows loaded", logs: [1, 2, 3] },
    { id: "sql-aggregation-fast", why: "The widget that aggregates in SQL is fast on the same data", logs: [11], requests: [2] },
    { id: "index-used", why: "The query uses the index; the database is not the bottleneck", logs: [6] },
  ],
  investigationHints: [
    "Break the request's time into its stages using the logs, and see which stages grow as the workspace grows.",
    "Compare what the summary asks the database for with what the dashboard actually displays.",
  ],
});
