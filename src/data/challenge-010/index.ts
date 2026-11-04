/*
 * Challenge 010: Page 1 of 548. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-30";
const COOKIE = { cookie: "sid=e41b07c2d9a6f358" };
const subjects = ["Login loop on Safari", "Invoice PDF blank", "CSV import stalls", "Webhook retries", "Slow search", "SSO setup help"];
const tickets = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `TCK-${4100 - from - index}`,
    subject: subjects[(from + index) % subjects.length],
    status: "open",
  }));

export const challenge010 = defineChallenge({
  number: "010",
  title: "Page 1 of 548",
  incident: "The ticket list claims hundreds of pages for 137 open tickets, and most pages are empty.",
  difficulty: "intermediate",
  tags: ["JSON", "Types", "Pagination"],
  estimatedMinutes: 20,
  description:
    "After ticket search moved to a single SQL query, the support queue says \"Page 1 of 548\" for 137 open tickets. Clicking far ahead shows empty pages. The projects list, built the same way, is fine.",
  category: "api",
  technologies: ["TypeScript", "Node.js", "PostgreSQL", "React"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://support.lumen.example",
  files: {
    "INCIDENT.md": `# INC-010 · Page 1 of 548

**Opened:** ${DATE} 14:10 UTC
**Severity:** SEV-4
**Service:** lumen-support-api v3.0.0 and lumen-support-web v3.0.0

## Summary
The open-ticket queue shows "137 open tickets · Page 1 of 548". Pages 1
to 6 show tickets; page 7 onwards is empty. The projects list uses the
same pagination component and shows the right number of pages.

## Notes
- v3.0.0 replaced the ORM call for ticket search with one SQL query (see
  CHANGELOG.md). Projects still use the ORM.
- The database contains exactly 137 open tickets for this team
- The page size is 25

## Your task
Explain where 548 comes from.
`,
    "CHANGELOG.md": `# Changelog

## 3.0.0
- Ticket search runs as a single SQL query with its count, instead of two ORM calls
- New "Waiting on customer" status

## 2.9.4
- Fixed sorting by last reply
`,
    "package.json": `{
  "name": "lumen-support-api",
  "version": "3.0.0",
  "private": true,
  "dependencies": { "express": "^4.21.1", "pg": "^8.13.1", "@prisma/client": "^5.22.0" }
}
`,
    "src/routes/tickets.ts": `import { Router } from "express";
import { pool } from "../db";
import { log } from "../log";

export const tickets = Router();

const PAGE_SIZE = 25;

tickets.get("/api/tickets", async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const status = String(req.query.status ?? "open");
  const offset = (page - 1) * PAGE_SIZE;

  const { rows } = await pool.query<{ id: string; subject: string; status: string; total: string }>(
    \`SELECT id, subject, status, count(*) OVER () AS total
       FROM tickets
      WHERE tenant_id = $1 AND status = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4\`,
    [req.tenantId, status, PAGE_SIZE, offset],
  );
  const total = rows[0]?.total ?? (await countTickets(req.tenantId, status));
  log.debug("db", \`tickets search status=\${status} tenant=\${req.tenantId} limit=\${PAGE_SIZE} offset=\${offset} rows=\${rows.length} total=\${total}\`);

  res.json({ items: rows.map(({ total: _total, ...ticket }) => ticket), total, page, pageSize: PAGE_SIZE });
});

async function countTickets(tenantId: string, status: string) {
  const { rows } = await pool.query("SELECT count(*) AS total FROM tickets WHERE tenant_id = $1 AND status = $2", [tenantId, status]);
  return rows[0].total;
}
`,
    "src/routes/projects.ts": `import { Router } from "express";
import { prisma } from "../prisma";

export const projects = Router();

const PAGE_SIZE = 25;

projects.get("/api/projects", async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const where = { tenantId: req.tenantId };
  const [items, total] = await Promise.all([
    prisma.project.findMany({ where, orderBy: { name: "asc" }, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE, select: { id: true, name: true } }),
    prisma.project.count({ where }),
  ]);
  res.json({ items, total, page, pageSize: PAGE_SIZE });
});
`,
    "src/db.ts": `import { Pool } from "pg";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
`,
    "web/src/components/Pagination.tsx": `interface Props {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, total, pageSize, onChange }: Props) {
  // Round up without floating point: the last page may be partly full.
  const lastPage = Math.max(1, Math.floor((total + pageSize - 1) / pageSize));
  return (
    <nav aria-label="Pages">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span>Page {page} of {lastPage}</span>
      <button disabled={page >= lastPage} onClick={() => onChange(page + 1)}>Next</button>
    </nav>
  );
}
`,
    "web/src/TicketQueue.tsx": `import { useEffect, useState } from "react";
import { Pagination } from "./components/Pagination";
import { reportClientIssue } from "./report";

interface TicketPage {
  items: { id: string; subject: string; status: string }[];
  total: number;
  page: number;
  pageSize: number;
}

export function TicketQueue() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TicketPage | null>(null);

  useEffect(() => {
    fetch(\`/api/tickets?status=open&page=\${page}\`)
      .then((response) => response.json() as Promise<TicketPage>)
      .then((result) => {
        setData(result);
        const lastPage = Math.floor((result.total + result.pageSize - 1) / result.pageSize);
        if (result.items.length === 0 && page > 1) reportClientIssue("Empty ticket page shown", { page, of: lastPage });
      });
  }, [page]);

  if (!data) return null;
  return (
    <section>
      <h1>{data.total} open tickets</h1>
      <ul>{data.items.map((ticket) => <li key={ticket.id}>{ticket.id} · {ticket.subject}</li>)}</ul>
      <Pagination page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} />
    </section>
  );
}
`,
  },
  logs: [
    ["13:55:00.412", "INFO", "http", "Server listening on :4000"],
    ["14:02:10.528", "DEBUG", "db", "tickets search status=open tenant=t_44 limit=25 offset=0 rows=25 total=137"],
    ["14:02:10.551", "INFO", "http", "GET /api/tickets?status=open&page=1 200 44ms"],
    ["14:02:31.877", "DEBUG", "db", "tickets search status=open tenant=t_44 limit=25 offset=7775 rows=0 total=137"],
    ["14:02:31.890", "INFO", "http", "GET /api/tickets?status=open&page=312 200 21ms"],
    ["14:02:31.951", "WARN", "web", "Empty ticket page shown page=312 of=548"],
    ["14:02:31.952", "INFO", "http", "POST /api/client-log 204 1ms"],
    ["14:03:02.114", "DEBUG", "db", "tickets search status=open tenant=t_44 limit=25 offset=125 rows=12 total=137"],
    ["14:03:02.130", "INFO", "http", "GET /api/tickets?status=open&page=6 200 30ms"],
    ["14:05:40.700", "INFO", "http", "GET /api/projects?page=1 200 18ms"],
  ],
  network: [
    {
      log: 3,
      initiator: "web/src/TicketQueue.tsx",
      requestHeaders: COOKIE,
      response: JSON.stringify({ items: tickets(0, 25), total: "137", page: 1, pageSize: 25 }),
    },
    {
      log: 5,
      initiator: "web/src/TicketQueue.tsx",
      requestHeaders: COOKIE,
      response: JSON.stringify({ items: [], total: "137", page: 312, pageSize: 25 }),
    },
    { log: 7, initiator: "web/src/TicketQueue.tsx", requestHeaders: COOKIE, body: '{"message":"Empty ticket page shown","page":312,"of":548}' },
    {
      log: 9,
      initiator: "web/src/TicketQueue.tsx",
      requestHeaders: COOKIE,
      response: JSON.stringify({ items: tickets(125, 12), total: "137", page: 6, pageSize: 25 }),
    },
    {
      log: 10,
      requestHeaders: COOKIE,
      response: JSON.stringify({
        items: [
          { id: "prj_12", name: "Billing" },
          { id: "prj_07", name: "Mobile app" },
        ],
        total: 42,
        page: 1,
        pageSize: 25,
      }),
    },
  ],
  options: [
    [
      "count-includes-other-tenants",
      "The count includes tickets from other teams",
      "The count is not filtered the same way as the page query, so the total is far larger than this team's tickets.",
    ],
    [
      "count-serialized-as-string",
      "The ticket total reaches the browser as a string, not a number",
      "The SQL count arrives from the database driver as text and is sent on unchanged, so arithmetic on it in the browser goes wrong.",
    ],
    [
      "window-count-duplicates",
      "The window count multiplies rows, inflating the total",
      "count(*) OVER () counts each row once per page row, so the total is the square of what it should be.",
    ],
    [
      "pagination-rounding",
      "The pagination component rounds the page count incorrectly",
      "The formula for the last page is wrong for every list, so page counts are always too high.",
    ],
  ],
});
