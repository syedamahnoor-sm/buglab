/*
 * Hero-only content, rendered on the server. Kept apart from landing.ts,
 * which client components import, so none of this ships in client JavaScript.
 *
 * Everything here restates the incident's public symptom (login works, the
 * next requests return 401) and never its cause. tests/ui/landing.test.ts
 * checks it with the rest of the landing copy.
 */
import { incidentLogs } from "@/data/challenge-001/logs";

/** Background texture: Challenge 001's own public log lines. */
export const heroLogLines = incidentLogs.map(
  (entry) => `${entry.timestamp} ${entry.level.padEnd(5)} [${entry.source}] ${entry.message}`,
);

/** The layered debugging scene on the right of the hero. */
export const heroScene = {
  trace: {
    title: "Requests · 09:14:02",
    // start and width are percentages of the waterfall track.
    rows: [
      { method: "POST", path: "/api/auth/login", status: 200, start: 0, width: 40 },
      { method: "GET", path: "/dashboard.html", status: 200, start: 44, width: 6 },
      { method: "GET", path: "/dashboard.js", status: 200, start: 56, width: 5 },
      { method: "GET", path: "/api/profile", status: 401, start: 74, width: 4, signal: true },
      { method: "GET", path: "/api/orders", status: 401, start: 75, width: 4 },
    ],
  },
  terminal: {
    title: "tail -f logs/app.log",
    lines: [
      { time: "09:14:02.117", level: "INFO", text: "[auth] Login succeeded user=u_1042" },
      { time: "09:14:02.118", level: "INFO", text: "[http] POST /api/auth/login 200 142ms" },
      { time: "09:14:02.301", level: "INFO", text: "[http] GET /dashboard.html 200 4ms" },
      { time: "09:14:02.344", level: "INFO", text: "[http] GET /dashboard.js 200 2ms" },
      { time: "09:14:02.487", level: "INFO", text: "[http] GET /api/profile 401 3ms", signal: true },
      { time: "09:14:02.489", level: "INFO", text: "[http] GET /api/orders 401 2ms" },
      { time: "09:14:02.512", level: "ERROR", text: "[web] Dashboard failed to load" },
    ],
  },
  inspector: {
    method: "GET",
    path: "/api/profile",
    status: "401 Unauthorized",
    rows: [
      ["Type", "fetch"],
      ["Duration", "3 ms"],
      ["After login", "+369 ms"],
    ],
    pinned: "Pinned as evidence",
  },
};
