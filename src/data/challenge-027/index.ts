/*
 * Challenge 027: The Dashboard That Slowed Down. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 * All figures are synthetic.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-03";
const COOKIE = { cookie: "lumo_sid=[removed]" };
const TOP_PAGES = JSON.stringify({
  range: "90d",
  pages: [
    { path: "/pricing", views: 48211 },
    { path: "/docs/getting-started", views: 39004 },
    { path: "/blog/release-notes", views: 21877 },
  ],
});

export const challenge027 = defineChallenge({
  number: "027",
  title: "The Dashboard That Slowed Down",
  incident: "The analytics dashboard has gone from loading in under a second to taking five, a little slower every week.",
  difficulty: "advanced",
  tags: ["Query design", "Aggregation", "Latency"],
  estimatedMinutes: 40,
  description:
    "When the analytics dashboard launched it was instant. Each week since, it has been a little slower, and the largest workspace now waits about five seconds for its 90-day summary. Nothing has been deployed in a month.",
  category: "performance",
  technologies: ["TypeScript", "Node.js", "PostgreSQL", "React"],
  publishedAt: "2026-11-05",
  incidentDate: DATE,
  origin: "https://analytics.lumofield.example",
  files: {
    "INCIDENT.md": `# INC-027 · The Dashboard That Slowed Down

**Opened:** ${DATE} 09:45 UTC
**Severity:** SEV-3
**Service:** lumofield-analytics v2.4.0 (unchanged since 2 September)

## Summary
The 90-day summary for workspace w_12, our largest, takes about five
seconds. It took 0.8 s in early September. The slowdown is gradual and
tracks the workspace's growth (about 48,000 new events a day).

## Notes
- The dashboard shows a 90-day chart (one point per day) and the 20 most
  recent events
- events has an index on (workspace_id, occurred_at)
- The top-pages widget on the same dashboard is still fast
- The database primary is lightly loaded

## Your task
Explain why the summary gets slower as the workspace grows.
`,
    "db/schema.sql": `CREATE TABLE events (
  id            bigserial PRIMARY KEY,
  workspace_id  text NOT NULL,
  occurred_at   timestamptz NOT NULL,
  kind          text NOT NULL,      -- 'page_view' | 'signup' | 'purchase'
  path          text,
  value         numeric(12, 2)
);

CREATE INDEX events_workspace_time ON events (workspace_id, occurred_at);
`,
    "server/analytics/events-repo.ts": `import { pool } from "../db";
import { log } from "../log";

export interface EventRow {
  id: string;
  occurred_at: Date;
  kind: string;
  path: string | null;
  value: string | null;
}

export async function eventsForWorkspace(workspaceId: string): Promise<EventRow[]> {
  const started = Date.now();
  const { rows } = await pool.query<EventRow>(
    "SELECT id, occurred_at, kind, path, value FROM events WHERE workspace_id = $1 ORDER BY occurred_at DESC",
    [workspaceId],
  );
  log.info("db", \`query=events_for_workspace rows=\${rows.length} duration=\${Date.now() - started}ms\`);
  return rows;
}
`,
    "server/analytics/summary.ts": `import { Router } from "express";
import { log } from "../log";
import { eventsForWorkspace } from "./events-repo";

export const summary = Router();

const DAY_MS = 86_400_000;

summary.get("/api/analytics/summary", async (req, res) => {
  const days = Number(String(req.query.range ?? "90d").replace("d", ""));
  log.info("analytics", \`summary request workspace=\${req.workspaceId} range=\${days}d\`);
  const events = await eventsForWorkspace(req.workspaceId);

  const started = Date.now();
  const today = startOfDay(Date.now());
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = today - i * DAY_MS;
    const onDay = events.filter((event) => event.occurred_at.getTime() >= from && event.occurred_at.getTime() < from + DAY_MS);
    daily.push({
      day: new Date(from).toISOString().slice(0, 10),
      views: onDay.filter((event) => event.kind === "page_view").length,
      signups: onDay.filter((event) => event.kind === "signup").length,
      revenue: onDay.filter((event) => event.kind === "purchase").reduce((sum, event) => sum + Number(event.value), 0),
    });
  }
  log.info("analytics", \`aggregated days=\${days} rows_scanned=\${days * events.length} duration=\${Date.now() - started}ms\`);

  const body = JSON.stringify({ range: \`\${days}d\`, daily, recent: events });
  log.info("analytics", \`response serialized bytes=\${Buffer.byteLength(body)} recent_rows=\${events.length}\`);
  res.type("application/json").send(body);
});

const startOfDay = (ms: number) => ms - (ms % DAY_MS);
`,
    "server/analytics/top-pages.ts": `import { Router } from "express";
import { pool } from "../db";
import { log } from "../log";

export const topPages = Router();

topPages.get("/api/analytics/top-pages", async (req, res) => {
  const started = Date.now();
  const { rows } = await pool.query(
    \`SELECT path, count(*)::int AS views
       FROM events
      WHERE workspace_id = $1 AND kind = 'page_view' AND occurred_at >= now() - interval '90 days'
      GROUP BY path
      ORDER BY views DESC
      LIMIT 20\`,
    [req.workspaceId],
  );
  log.info("db", \`query=top_pages rows=\${rows.length} duration=\${Date.now() - started}ms\`);
  res.json({ range: "90d", pages: rows });
});
`,
    "web/src/Dashboard.tsx": `import { useEffect, useState } from "react";
import { DailyChart } from "./DailyChart";
import { RecentEvents } from "./RecentEvents";
import { TopPages } from "./TopPages";

interface Summary {
  range: string;
  daily: { day: string; views: number; signups: number; revenue: number }[];
  recent: { id: string; occurred_at: string; kind: string; path: string | null }[];
}

export function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetch("/api/analytics/summary?range=90d").then((response) => response.json()).then(setSummary);
  }, []);

  if (!summary) return <p>Loading…</p>;
  return (
    <main>
      <DailyChart points={summary.daily} />
      <RecentEvents events={summary.recent.slice(0, 20)} />
      <TopPages />
    </main>
  );
}
`,
  },
  logs: [
    ["09:00:00.010", "INFO", "metrics", "weekly p95 GET /api/analytics/summary w_12: wk36=0.81s rows_loaded=210k"],
    ["09:00:00.011", "INFO", "metrics", "weekly p95 GET /api/analytics/summary w_12: wk38=1.92s rows_loaded=524k"],
    ["09:00:00.012", "INFO", "metrics", "weekly p95 GET /api/analytics/summary w_12: wk40=4.79s rows_loaded=1.33M"],
    ["09:31:02.110", "INFO", "analytics", "summary request workspace=w_12 range=90d"],
    ["09:31:03.520", "INFO", "db", "query=events_for_workspace rows=1342118 duration=1410ms"],
    ["09:31:03.521", "DEBUG", "db", "plan: Index Scan Backward using events_workspace_time on events (actual rows=1342118) Index Cond: (workspace_id = 'w_12')"],
    ["09:31:06.500", "INFO", "analytics", "aggregated days=90 rows_scanned=120790620 duration=2980ms"],
    ["09:31:06.910", "INFO", "analytics", "response serialized bytes=40483120 recent_rows=1342118"],
    ["09:31:06.916", "INFO", "http", "GET /api/analytics/summary?range=90d 200 4806ms"],
    ["09:31:07.050", "INFO", "rum", "dashboard ready total=5180ms summary_request=5020ms render=120ms"],
    ["09:31:07.212", "INFO", "db", "query=top_pages rows=20 duration=31ms"],
    ["09:31:07.214", "INFO", "http", "GET /api/analytics/top-pages 200 38ms"],
    ["09:35:00.000", "INFO", "metrics", "db primary cpu=22% other queries p95=8ms; events rows for w_12: 1342118 (+48k/day); events older than 90 days: 913,540"],
  ],
  network: [
    {
      log: 9,
      initiator: "web/src/Dashboard.tsx",
      ms: 5020,
      requestHeaders: COOKIE,
      responseHeaders: { "content-type": "application/json; charset=utf-8", "content-length": "40483120" },
    },
    { log: 12, requestHeaders: COOKIE, response: TOP_PAGES },
  ],
  options: [
    [
      "missing-index",
      "The events query cannot use an index",
      "Without a suitable index the database must read the whole events table for every summary.",
    ],
    [
      "database-overloaded",
      "The database is overloaded by other traffic",
      "Contention on the primary slows every query, including the summary's.",
    ],
    [
      "browser-rendering",
      "The dashboard spends its time rendering the chart",
      "Drawing the chart and the event list in the browser is what takes the seconds.",
    ],
    [
      "unbounded-fetch-app-aggregation",
      "The summary loads the workspace's entire event history and aggregates it in application code",
      "Every request reads and returns all events, ignoring the 90-day range, and filters the full list once per day, so the cost grows with the workspace's whole history.",
    ],
  ],
});
