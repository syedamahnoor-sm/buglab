/*
 * Challenge 009: October Is Short. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-11-02";
const COOKIE = { cookie: "JSESSIONID=5E0A2C9B71D84F36A1B7C40E9D2F6A18" };
const preview = (rows: number, total: string, first: string | null, last: string | null) =>
  JSON.stringify({ rows, total, firstDay: first, lastDay: last });

export const challenge009 = defineChallenge({
  number: "009",
  title: "October Is Short",
  incident: "The October sales export is 3,912.40 short of the dashboard's October revenue.",
  difficulty: "intermediate",
  tags: ["Dates", "Ranges", "Reporting"],
  estimatedMinutes: 20,
  description:
    "Finance's month-end sales export never agrees with the revenue dashboard. The gap is different every month, and exporting a single day returns nothing at all.",
  category: "api",
  technologies: ["Java", "Spring Boot", "PostgreSQL", "React"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://reports.harbourline.example",
  files: {
    "INCIDENT.md": `# INC-009 · October Is Short

**Opened:** ${DATE} 09:30 UTC
**Severity:** SEV-3
**Service:** harbourline-reports v2.7.1

## Summary
Finance exported October sales (1 to 31 October) for month-end close.
The export says 1,284 orders and 104,118.25; the revenue dashboard says
1,331 orders and 108,030.65 for October. Previous months had gaps too,
of different sizes.

## What finance tried
- Exporting only 31 October returned no rows
- Exporting 1 October to 1 November matched the dashboard exactly

## Notes
- All timestamps are stored in UTC, and finance works in UTC
- Orders are loaded continuously; nothing for October was still loading

## Your task
Explain the difference between the export and the dashboard.
`,
    "pom.xml": `<project>
  <groupId>example.harbourline</groupId>
  <artifactId>reports</artifactId>
  <version>2.7.1</version>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.5</version>
  </parent>
</project>
`,
    "src/main/java/example/reports/SalesExportController.java": `package example.reports;

import java.security.Principal;
import java.time.LocalDate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SalesExportController {
    private static final Logger log = LoggerFactory.getLogger("export");
    private final SalesRepository sales;

    public SalesExportController(SalesRepository sales) {
        this.sales = sales;
    }

    /** Summary shown in the export dialog before the CSV is downloaded. Both dates are chosen by the user. */
    @GetMapping("/api/reports/sales/preview")
    public SalesPreview preview(@RequestParam LocalDate from, @RequestParam LocalDate to, Principal user) {
        log.info("Sales export requested by={} from={} to={}", user.getName(), from, to);
        DateRange range = DateRange.of(from, to);
        log.debug("Query range start={} end={}", range.start(), range.end());
        SalesPreview preview = sales.preview(range);
        log.info("Sales export complete rows={} total={}", preview.rows(), preview.total());
        return preview;
    }
}
`,
    "src/main/java/example/reports/DateRange.java": `package example.reports;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

/**
 * A half-open range of instants, [start, end), so that adjacent ranges never
 * overlap and no order is counted twice.
 */
public record DateRange(Instant start, Instant end) {
    public static DateRange of(LocalDate from, LocalDate to) {
        if (to.isBefore(from)) throw new IllegalArgumentException("to is before from");
        return new DateRange(from.atStartOfDay(ZoneOffset.UTC).toInstant(), to.atStartOfDay(ZoneOffset.UTC).toInstant());
    }
}
`,
    "src/main/java/example/reports/SalesRepository.java": `package example.reports;

import java.sql.Timestamp;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SalesRepository {
    private final JdbcTemplate jdbc;

    public SalesRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public SalesPreview preview(DateRange range) {
        return jdbc.queryForObject(
            """
            SELECT count(*) AS rows,
                   coalesce(sum(total), 0)::text AS total,
                   min(created_at)::date::text AS first_day,
                   max(created_at)::date::text AS last_day
            FROM orders
            WHERE created_at >= ? AND created_at < ?
            """,
            (rs, i) -> new SalesPreview(rs.getLong("rows"), rs.getString("total"), rs.getString("first_day"), rs.getString("last_day")),
            Timestamp.from(range.start()),
            Timestamp.from(range.end()));
    }
}
`,
    "src/main/java/example/reports/DashboardRepository.java": `package example.reports;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class DashboardRepository {
    private final JdbcTemplate jdbc;

    public DashboardRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** month is the first day of the month, for example 2026-10-01. */
    public MonthlySummary month(java.time.LocalDate month) {
        return jdbc.queryForObject(
            "SELECT count(*) AS orders, coalesce(sum(total), 0)::text AS revenue FROM orders WHERE date_trunc('month', created_at) = ?::timestamptz",
            (rs, i) -> new MonthlySummary(rs.getLong("orders"), rs.getString("revenue")),
            month.toString());
    }
}
`,
    "web/src/ExportDialog.tsx": `import { useState } from "react";

export function ExportDialog() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preview, setPreview] = useState<{ rows: number; total: string } | null>(null);

  async function check() {
    const response = await fetch(\`/api/reports/sales/preview?from=\${from}&to=\${to}\`);
    setPreview(await response.json());
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); check(); }}>
      <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>To (inclusive) <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <button>Preview export</button>
      {preview && <p>{preview.rows} orders · {preview.total}</p>}
    </form>
  );
}
`,
  },
  logs: [
    ["08:00:01.100", "INFO", "spring", "Started ReportsApplication in 6.2 seconds"],
    ["09:12:44.031", "INFO", "export", "Sales export requested by=finance.ops from=2026-10-01 to=2026-10-31"],
    ["09:12:44.034", "DEBUG", "export", "Query range start=2026-10-01T00:00:00Z end=2026-10-31T00:00:00Z"],
    ["09:12:44.512", "INFO", "export", "Sales export complete rows=1284 total=104118.25"],
    ["09:12:44.513", "INFO", "http", "GET /api/reports/sales/preview?from=2026-10-01&to=2026-10-31 200 482ms"],
    ["09:13:30.200", "INFO", "dashboard", "Monthly summary month=2026-10 orders=1331 revenue=108030.65"],
    ["09:13:30.201", "INFO", "http", "GET /api/dashboard/summary?month=2026-10 200 64ms"],
    ["09:20:05.718", "INFO", "export", "Sales export requested by=finance.ops from=2026-10-31 to=2026-10-31"],
    ["09:20:05.719", "DEBUG", "export", "Query range start=2026-10-31T00:00:00Z end=2026-10-31T00:00:00Z"],
    ["09:20:05.758", "INFO", "export", "Sales export complete rows=0 total=0.00"],
    ["09:20:05.759", "INFO", "http", "GET /api/reports/sales/preview?from=2026-10-31&to=2026-10-31 200 41ms"],
    ["09:24:51.330", "INFO", "export", "Sales export requested by=finance.ops from=2026-10-01 to=2026-11-01"],
    ["09:24:51.332", "DEBUG", "export", "Query range start=2026-10-01T00:00:00Z end=2026-11-01T00:00:00Z"],
    ["09:24:51.827", "INFO", "export", "Sales export complete rows=1331 total=108030.65"],
    ["09:24:51.828", "INFO", "http", "GET /api/reports/sales/preview?from=2026-10-01&to=2026-11-01 200 497ms"],
  ],
  network: [
    { log: 5, initiator: "web/src/ExportDialog.tsx", requestHeaders: COOKIE, response: preview(1284, "104118.25", "2026-10-01", "2026-10-30") },
    { log: 7, requestHeaders: COOKIE, response: '{"month":"2026-10","orders":1331,"revenue":"108030.65"}' },
    { log: 11, initiator: "web/src/ExportDialog.tsx", requestHeaders: COOKIE, response: preview(0, "0.00", null, null) },
    { log: 15, initiator: "web/src/ExportDialog.tsx", requestHeaders: COOKIE, response: preview(1331, "108030.65", "2026-10-01", "2026-10-31") },
  ],
  options: [
    [
      "timezone-shift",
      "The export converts dates in a different time zone, so late-evening orders drop out",
      "A local-time conversion moves the range by a few hours and loses the orders at one end.",
    ],
    [
      "row-limit",
      "The export stops at a maximum number of rows",
      "Large exports are cut off at a row cap, so the last orders of the month are left out.",
    ],
    [
      "end-date-exclusive",
      "The chosen end date is turned into an exclusive upper bound at its first instant",
      "The last day the user picks becomes the boundary where the range stops, so none of that day is included.",
    ],
    [
      "dashboard-double-counts",
      "The dashboard counts some orders twice",
      "The dashboard's monthly query includes refunds or duplicates, so its figure is too high.",
    ],
    [
      "late-loading-orders",
      "The most recent orders were still being loaded when the export ran",
      "Orders arrive in the reporting database with a delay, so the newest day is incomplete.",
    ],
  ],
});
