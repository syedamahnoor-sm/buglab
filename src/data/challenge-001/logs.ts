/*
 * Server output captured during the incident. Shown in the Investigation
 * Console and rendered into logs/app.log, so the two always agree.
 *
 * Keep these neutral: symptoms only, nothing that names the root cause.
 */
import type { LogEntry } from "@/types/workspace";

export const INCIDENT_DATE = "2026-10-30";

export const incidentLogs: LogEntry[] = [
  { id: "log-01", timestamp: "08:55:41.203", level: "INFO", source: "http", message: "Server listening on :3000" },

  { id: "log-02", timestamp: "09:14:02.117", level: "INFO", source: "auth", message: "Login succeeded user=u_1042" },
  { id: "log-03", timestamp: "09:14:02.118", level: "INFO", source: "http", message: "POST /api/auth/login 200 142ms" },
  { id: "log-04", timestamp: "09:14:02.301", level: "INFO", source: "http", message: "GET /dashboard.html 200 4ms" },
  { id: "log-05", timestamp: "09:14:02.344", level: "INFO", source: "http", message: "GET /dashboard.js 200 2ms" },
  { id: "log-06", timestamp: "09:14:02.486", level: "WARN", source: "auth", message: "Unauthorized request path=/api/profile" },
  { id: "log-07", timestamp: "09:14:02.487", level: "INFO", source: "http", message: "GET /api/profile 401 3ms" },
  { id: "log-08", timestamp: "09:14:02.488", level: "WARN", source: "auth", message: "Unauthorized request path=/api/orders" },
  { id: "log-09", timestamp: "09:14:02.489", level: "INFO", source: "http", message: "GET /api/orders 401 2ms" },
  { id: "log-10", timestamp: "09:14:02.512", level: "ERROR", source: "web", message: "Dashboard failed to load: 2 requests returned 401" },
  { id: "log-11", timestamp: "09:14:02.513", level: "INFO", source: "http", message: "POST /api/client-errors 204 1ms" },
  { id: "log-12", timestamp: "09:14:02.530", level: "INFO", source: "http", message: "GET /login.html 200 2ms" },

  { id: "log-13", timestamp: "09:14:09.871", level: "INFO", source: "auth", message: "Login succeeded user=u_1042" },
  { id: "log-14", timestamp: "09:14:09.872", level: "INFO", source: "http", message: "POST /api/auth/login 200 138ms" },
  { id: "log-15", timestamp: "09:14:09.990", level: "INFO", source: "http", message: "GET /dashboard.html 304 1ms" },
  { id: "log-16", timestamp: "09:14:10.021", level: "INFO", source: "http", message: "GET /dashboard.js 304 1ms" },
  { id: "log-17", timestamp: "09:14:10.104", level: "WARN", source: "auth", message: "Unauthorized request path=/api/profile" },
  { id: "log-18", timestamp: "09:14:10.105", level: "INFO", source: "http", message: "GET /api/profile 401 2ms" },
  { id: "log-19", timestamp: "09:14:10.106", level: "WARN", source: "auth", message: "Unauthorized request path=/api/orders" },
  { id: "log-20", timestamp: "09:14:10.107", level: "INFO", source: "http", message: "GET /api/orders 401 2ms" },
  { id: "log-21", timestamp: "09:14:10.121", level: "ERROR", source: "web", message: "Dashboard failed to load: 2 requests returned 401" },
  { id: "log-22", timestamp: "09:14:10.122", level: "INFO", source: "http", message: "POST /api/client-errors 204 1ms" },
  { id: "log-23", timestamp: "09:14:10.140", level: "INFO", source: "http", message: "GET /login.html 304 1ms" },
];

/** Formats entries exactly as src/lib/logger.ts in the scenario writes them. */
export function formatLogFile(entries: LogEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${INCIDENT_DATE}T${entry.timestamp}Z ${entry.level.padEnd(5)} [${entry.source}] ${entry.message}`,
    )
    .join("\n")
    .concat("\n");
}
