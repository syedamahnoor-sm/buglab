/*
 * Challenge 026: The Query That Never Ends. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-11";
const SHIPMENT = '{"tracking":"TW4482910GB","status":"in_transit","last_scan":"2026-10-11T07:58:02Z","location":"Leeds hub"}';

export const challenge026 = defineChallenge({
  number: "026",
  title: "The Query That Never Ends",
  incident: "Parcel tracking lookups went from milliseconds to eight seconds after this morning's release.",
  difficulty: "intermediate",
  tags: ["PostgreSQL", "Indexes", "Query plans"],
  estimatedMinutes: 25,
  description:
    "After a release that made tracking codes case-insensitive, every tracking page takes about eight seconds and the database's CPU is pinned. The index the lookup relies on is still there.",
  category: "performance",
  technologies: ["SQL", "PostgreSQL", "TypeScript", "Node.js"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://track.tidewing.example",
  files: {
    "INCIDENT.md": `# INC-026 · The Query That Never Ends

**Opened:** ${DATE} 08:20 UTC
**Severity:** SEV-2
**Service:** tidewing-tracking v4.6.0 (released ${DATE} 07:30 UTC)

## Summary
Tracking pages take 8 to 9 seconds to load, and the database primary is at
95% CPU. Before the release the same lookup took about 3 ms.

## Notes
- v4.6.0 accepts tracking codes in any letter case (see CHANGELOG.md)
- shipments has about 48 million rows
- shipments_tracking_code_idx still exists; nobody dropped or rebuilt it
- auto_explain is enabled for statements slower than 1 second
- The connection pool reports no waiting

## Your task
Explain why the lookup became slow.
`,
    "CHANGELOG.md": `# Changelog

## 4.6.0
- Tracking codes are matched case-insensitively ("tw4482910gb" now works)

## 4.5.2
- Added the Leeds hub to the location list
`,
    "db/schema.sql": `CREATE TABLE shipments (
  id             bigserial PRIMARY KEY,
  tracking_code  text NOT NULL,
  status         text NOT NULL,
  last_scan_at   timestamptz,
  location       text
);

CREATE UNIQUE INDEX shipments_tracking_code_idx ON shipments (tracking_code);
`,
    "src/shipments/repository.ts": `import { pool } from "../db";

export interface Shipment {
  tracking: string;
  status: string;
  last_scan: string | null;
  location: string | null;
}

// Tracking codes are printed in upper case, but people type them however they like.
export async function findByTrackingCode(code: string): Promise<Shipment | null> {
  const { rows } = await pool.query<Shipment>(
    \`SELECT tracking_code AS tracking, status, last_scan_at AS last_scan, location
       FROM shipments
      WHERE lower(tracking_code) = lower($1)\`,
    [code.trim()],
  );
  return rows[0] ?? null;
}
`,
    "src/routes/track.ts": `import { Router } from "express";
import { pool } from "../db";
import { log } from "../log";
import { findByTrackingCode } from "../shipments/repository";

export const track = Router();

track.get("/api/track/:code", async (req, res) => {
  const started = Date.now();
  const shipment = await findByTrackingCode(req.params.code);
  log.info("track", \`Lookup code=\${req.params.code} found=\${Boolean(shipment)} took=\${Date.now() - started}ms pool_waiting=\${pool.waitingCount}\`);
  if (!shipment) return res.status(404).json({ error: "We could not find that tracking code." });
  res.json(shipment);
});
`,
    "src/db.ts": `import { Pool } from "pg";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 30, statement_timeout: 15_000 });
`,
  },
  logs: [
    ["07:12:40.204", "INFO", "pg", "duration: 2.9 ms  plan: Index Scan using shipments_tracking_code_idx on shipments  (actual rows=1)  Index Cond: (tracking_code = 'TW4471022GB')"],
    ["07:12:40.206", "INFO", "track", "Lookup code=TW4471022GB found=true took=3ms pool_waiting=0"],
    ["07:12:40.207", "INFO", "http", "GET /api/track/TW4471022GB 200 5ms"],
    ["07:30:11.502", "INFO", "deploy", "tidewing-tracking v4.6.0 rolled out to 6/6 pods"],
    ["08:04:19.881", "WARN", "pg", "duration: 8412.6 ms  plan: Seq Scan on shipments  (actual rows=1)  Filter: (lower(tracking_code) = lower('TW4482910GB'))  Rows Removed by Filter: 48120331"],
    ["08:04:19.884", "INFO", "track", "Lookup code=TW4482910GB found=true took=8416ms pool_waiting=0"],
    ["08:04:19.885", "INFO", "http", "GET /api/track/TW4482910GB 200 8419ms"],
    ["08:05:02.660", "WARN", "pg", "duration: 8390.1 ms  plan: Seq Scan on shipments  (actual rows=1)  Filter: (lower(tracking_code) = lower('tw4479331gb'))  Rows Removed by Filter: 48120331"],
    ["08:05:02.662", "INFO", "track", "Lookup code=tw4479331gb found=true took=8393ms pool_waiting=0"],
    ["08:05:02.663", "INFO", "http", "GET /api/track/tw4479331gb 200 8396ms"],
    ["08:06:00.000", "WARN", "pg", "CPU 95% on primary; 41 active queries, all on shipments"],
  ],
  network: [
    { log: 3, response: SHIPMENT.replace("TW4482910GB", "TW4471022GB") },
    { log: 7, response: SHIPMENT },
    { log: 10, response: SHIPMENT.replace("TW4482910GB", "TW4479331GB") },
  ],
  options: [
    [
      "index-missing",
      "The tracking code index was dropped during the release",
      "Without its index the lookup has to read the whole table.",
    ],
    [
      "function-defeats-index",
      "Wrapping the column in lower() stops PostgreSQL from using the index",
      "The index is on tracking_code itself, so a condition on lower(tracking_code) can only be checked by scanning every row.",
    ],
    [
      "pool-exhausted",
      "The connection pool is exhausted, so lookups wait for a connection",
      "Requests queue for a database connection before their query can even start.",
    ],
    [
      "table-bloat",
      "The shipments table is bloated and needs vacuuming",
      "Dead rows make every read of the table slower.",
    ],
  ],
});
