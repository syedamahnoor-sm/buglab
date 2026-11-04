/*
 * Challenge 016: Revenue Too Good to Be True. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-20";
const COOKIE = { cookie: "metrics_sid=58d2b0e4a1" };

export const challenge016 = defineChallenge({
  number: "016",
  title: "Revenue Too Good to Be True",
  incident: "The daily revenue report shows more than twice the money that actually arrived.",
  difficulty: "beginner",
  tags: ["SQL", "Joins", "Aggregation"],
  estimatedMinutes: 15,
  description:
    "Yesterday's revenue report doubled overnight. The number of orders is right and so are the payments, but the revenue figure no longer matches either.",
  category: "database",
  technologies: ["SQL", "PostgreSQL", "TypeScript"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://metrics.brightcart.example",
  files: {
    "INCIDENT.md": `# INC-016 · Revenue Too Good to Be True

**Opened:** ${DATE} 08:15 UTC
**Severity:** SEV-3
**Service:** brightcart-reporting v1.12.0 (released ${DATE} 06:00 UTC)

## Summary
The daily report for 19 October says 212 orders and 48,331.10 in revenue.
Payments settled 212 payments totalling 19,804.55 for the same day. The
QA test store, which placed exactly one order yesterday (30.00, three
items), reports 90.00.

## Notes
- v1.12.0 added a "units sold" column to the daily report (CHANGELOG.md)
- No refunds were issued on 19 October in either store
- All amounts are in EUR

## Your task
Explain why the report's revenue is wrong.
`,
    "CHANGELOG.md": `# Changelog

## 1.12.0
- Daily report: new "units sold" column
- Report emails now go out at 06:30 instead of 07:00

## 1.11.3
- Fixed the store filter on the weekly report
`,
    "reports/daily_revenue.sql": `-- Daily figures for one store and one UTC day.
-- $1 = store id, $2 = day (date)
SELECT
  $2::date                  AS day,
  count(DISTINCT o.id)      AS orders,
  sum(o.total)              AS revenue,
  sum(i.quantity)           AS units
FROM orders o
JOIN order_items i ON i.order_id = o.id
WHERE o.store_id = $1
  AND o.status = 'paid'
  AND o.created_at >= $2::date
  AND o.created_at <  $2::date + interval '1 day';
`,
    "db/schema.sql": `CREATE TABLE orders (
  id          text PRIMARY KEY,
  store_id    text NOT NULL,
  status      text NOT NULL,          -- 'pending' | 'paid' | 'refunded'
  total       numeric(12, 2) NOT NULL, -- order total including tax and shipping
  currency    char(3) NOT NULL DEFAULT 'EUR',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id          bigserial PRIMARY KEY,
  order_id    text NOT NULL REFERENCES orders(id),
  sku         text NOT NULL,
  quantity    int NOT NULL CHECK (quantity > 0),
  unit_price  numeric(12, 2) NOT NULL
);
`,
    "src/jobs/daily-report.ts": `import { readFileSync } from "node:fs";
import { db } from "../db";
import { log } from "../log";

const DAILY = readFileSync(new URL("../../reports/daily_revenue.sql", import.meta.url), "utf8");

export async function dailyReport(storeId: string, day: string) {
  const row = await db.one<{ orders: string; revenue: string; units: string }>(DAILY, [storeId, day]);
  log.info("report", \`Daily report store=\${storeId} day=\${day} orders=\${row.orders} revenue=\${row.revenue} units=\${row.units}\`);
  return { day, orders: Number(row.orders), revenue: row.revenue, units: Number(row.units) };
}
`,
    "src/routes/reports.ts": `import { Router } from "express";
import { dailyReport } from "../jobs/daily-report";

export const reports = Router();

reports.get("/api/reports/daily", async (req, res) => {
  res.json(await dailyReport(String(req.query.store), String(req.query.day)));
});
`,
  },
  logs: [
    ["06:30:00.020", "INFO", "report", "Daily report run started day=2026-10-19 stores=2"],
    ["06:30:01.412", "INFO", "report", "Daily report store=main day=2026-10-19 orders=212 revenue=48331.10 units=611"],
    ["06:30:01.530", "INFO", "report", "Daily report store=qa-test day=2026-10-19 orders=1 revenue=90.00 units=3"],
    ["06:30:01.533", "INFO", "report", "Daily report run finished in 1513ms"],
    ["06:45:12.009", "INFO", "payments", "Settlement day=2026-10-19 store=main payments=212 amount=19804.55"],
    ["06:45:12.011", "INFO", "payments", "Settlement day=2026-10-19 store=qa-test payments=1 amount=30.00"],
    ["08:02:44.310", "INFO", "report", "Daily report store=main day=2026-10-19 orders=212 revenue=48331.10 units=611"],
    ["08:02:44.318", "INFO", "http", "GET /api/reports/daily?store=main&day=2026-10-19 200 96ms"],
    ["08:03:10.774", "INFO", "report", "Daily report store=qa-test day=2026-10-19 orders=1 revenue=90.00 units=3"],
    ["08:03:10.779", "INFO", "http", "GET /api/reports/daily?store=qa-test&day=2026-10-19 200 12ms"],
    ["08:03:31.402", "INFO", "http", "GET /api/orders/ord_qa_0091 200 6ms"],
  ],
  network: [
    { log: 8, requestHeaders: COOKIE, response: '{"day":"2026-10-19","orders":212,"revenue":"48331.10","units":611}' },
    { log: 10, requestHeaders: COOKIE, response: '{"day":"2026-10-19","orders":1,"revenue":"90.00","units":3}' },
    {
      log: 11,
      requestHeaders: COOKIE,
      response: JSON.stringify({
        id: "ord_qa_0091",
        store: "qa-test",
        status: "paid",
        total: "30.00",
        items: [
          { sku: "QA-MUG", quantity: 1, unit_price: "8.00" },
          { sku: "QA-SOCKS", quantity: 1, unit_price: "9.00" },
          { sku: "QA-CAP", quantity: 1, unit_price: "8.00" },
        ],
        shipping: "5.00",
      }),
    },
  ],
  options: [
    [
      "refunds-not-subtracted",
      "Refunds are no longer subtracted from revenue",
      "The new report adds refunded orders back in, inflating the total.",
    ],
    [
      "duplicate-orders",
      "Orders are being stored twice",
      "Each order exists twice in the orders table, so summing it doubles the revenue.",
    ],
    [
      "join-repeats-order-totals",
      "Joining order items repeats each order's total once per item",
      "The join produces one row per item, and summing the order total over those rows counts it several times.",
    ],
    [
      "timezone-window",
      "The day window covers more than one day",
      "The date range spans two days in some time zones, so the report includes orders from the day before.",
    ],
  ],
});
