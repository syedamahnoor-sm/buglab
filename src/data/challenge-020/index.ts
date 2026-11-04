/*
 * Challenge 020: The Rollback That Didn't. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-15";
const COOKIE = { cookie: "ledger_sid=91fa0c" };
const LONG_DESCRIPTION = "Annual maintenance and support for the on-premises analytics cluster, covering 24x7 incident response";

export const challenge020 = defineChallenge({
  number: "020",
  title: "The Rollback That Didn't",
  incident: "Failed invoice creations leave behind invoices with no lines, even though the code rolls back.",
  difficulty: "advanced",
  tags: ["Transactions", "Connection pools", "PostgreSQL"],
  estimatedMinutes: 40,
  description:
    "When creating an invoice fails, the API reports an error and says it rolled back. But during busy periods half-created invoices, with a number and no lines, keep appearing in the ledger.",
  category: "database",
  technologies: ["TypeScript", "Node.js", "PostgreSQL"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://ledger.quillpay.example",
  files: {
    "INCIDENT.md": `# INC-020 · The Rollback That Didn't

**Opened:** ${DATE} 16:40 UTC
**Severity:** SEV-2
**Service:** quillpay-ledger v2.3.0

## Summary
The nightly integrity check found 14 invoices with no lines. Each matches a
POST /api/invoices that returned 500 "Invoice could not be created". The
code wraps invoice creation in a transaction and rolls back on any error.

## What we know
- The line errors themselves are expected: descriptions over 80 characters
  are rejected by the database, and the UI will be fixed to stop them
- In a test this morning, with nothing else running, a failed creation
  left nothing behind
- The PostgreSQL log includes each statement's backend process id (pid)

## Your task
Explain why the rollback does not remove the invoice.
`,
    "package.json": `{
  "name": "quillpay-ledger",
  "version": "2.3.0",
  "private": true,
  "dependencies": { "express": "^4.21.1", "pg": "^8.13.1" }
}
`,
    "src/db.ts": `import { Pool } from "pg";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20, idleTimeoutMillis: 30_000 });
`,
    "src/invoices/create-invoice.ts": `import { pool } from "../db";
import { log } from "../log";

export interface NewInvoice {
  customerId: string;
  lines: { description: string; amount: string }[];
}

export async function createInvoice(input: NewInvoice): Promise<string> {
  await pool.query("BEGIN");
  try {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO invoices (customer_id, status) VALUES ($1, 'draft') RETURNING id",
      [input.customerId],
    );
    const invoiceId = rows[0].id;
    for (const line of input.lines) {
      await pool.query("INSERT INTO invoice_lines (invoice_id, description, amount) VALUES ($1, $2, $3)", [
        invoiceId,
        line.description,
        line.amount,
      ]);
    }
    await pool.query("COMMIT");
    return invoiceId;
  } catch (error) {
    await pool.query("ROLLBACK");
    log.warn("invoices", \`Invoice creation failed and was rolled back customer=\${input.customerId} reason=\${(error as Error).message}\`);
    throw error;
  }
}
`,
    "src/routes/invoices.ts": `import { Router } from "express";
import { pool } from "../db";
import { createInvoice } from "../invoices/create-invoice";

export const invoices = Router();

invoices.post("/api/invoices", async (req, res) => {
  try {
    const id = await createInvoice(req.body);
    res.status(201).json({ id });
  } catch {
    res.status(500).json({ error: "Invoice could not be created" });
  }
});

invoices.get("/api/invoices/:id", async (req, res) => {
  const invoice = await pool.query("SELECT id, customer_id, status FROM invoices WHERE id = $1", [req.params.id]);
  const lines = await pool.query("SELECT description, amount FROM invoice_lines WHERE invoice_id = $1", [req.params.id]);
  if (invoice.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ...invoice.rows[0], lines: lines.rows });
});
`,
    "db/schema.sql": `CREATE TABLE invoices (
  id           text PRIMARY KEY DEFAULT 'inv_' || substr(md5(random()::text), 1, 8),
  customer_id  text NOT NULL,
  status       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoice_lines (
  id           bigserial PRIMARY KEY,
  invoice_id   text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description  varchar(80) NOT NULL,
  amount       numeric(12, 2) NOT NULL
);
`,
  },
  logs: [
    ["09:15:02.104", "INFO", "pg", "pid=3108 statement: BEGIN"],
    ["09:15:02.109", "INFO", "pg", "pid=3108 statement: INSERT INTO invoices (customer_id, status) VALUES ($1, 'draft') RETURNING id"],
    ["09:15:02.113", "ERROR", "pg", "pid=3108 value too long for type character varying(80)"],
    ["09:15:02.115", "INFO", "pg", "pid=3108 statement: ROLLBACK"],
    ["09:15:02.116", "WARN", "invoices", "Invoice creation failed and was rolled back customer=c_test reason=value too long for type character varying(80)"],
    ["16:12:44.301", "INFO", "pg", "pid=4121 statement: BEGIN"],
    ["16:12:44.306", "INFO", "pg", "pid=4133 statement: INSERT INTO invoices (customer_id, status) VALUES ($1, 'draft') RETURNING id"],
    ["16:12:44.311", "ERROR", "pg", "pid=4127 value too long for type character varying(80)"],
    ["16:12:44.314", "INFO", "pg", "pid=4140 statement: ROLLBACK"],
    ["16:12:44.314", "WARN", "pg", "pid=4140 there is no transaction in progress"],
    ["16:12:44.315", "WARN", "invoices", "Invoice creation failed and was rolled back customer=c_5521 reason=value too long for type character varying(80)"],
    ["16:12:44.316", "INFO", "http", "POST /api/invoices 500 17ms"],
    ["16:13:02.880", "INFO", "http", "GET /api/invoices/inv_7e2b91c4 200 4ms"],
    ["16:17:44.302", "WARN", "pg", "pid=4121 terminating connection due to idle-in-transaction timeout"],
  ],
  network: [
    {
      log: 12,
      body: JSON.stringify({ customerId: "c_5521", lines: [{ description: LONG_DESCRIPTION, amount: "4800.00" }] }),
      requestHeaders: COOKIE,
      response: '{"error":"Invoice could not be created"}',
    },
    {
      log: 13,
      requestHeaders: COOKIE,
      response: '{"id":"inv_7e2b91c4","customer_id":"c_5521","status":"draft","lines":[]}',
    },
  ],
  options: [
    [
      "rollback-not-sent",
      "The ROLLBACK is never sent after the error",
      "An exception skips the rollback, so the transaction stays open and its insert is kept.",
    ],
    [
      "statements-on-different-connections",
      "The transaction's statements run on different pooled connections",
      "Each pool.query can take a different connection, so BEGIN, the inserts and ROLLBACK do not belong to one transaction.",
    ],
    [
      "missing-cascade",
      "Invoice lines are not deleted with their invoice",
      "The foreign key does not cascade, so a rollback cannot remove the invoice while lines point at it.",
    ],
    [
      "isolation-too-weak",
      "The isolation level lets the insert become visible before COMMIT",
      "Under READ COMMITTED, another request reads the invoice before the transaction is rolled back.",
    ],
    [
      "line-validation-bug",
      "The 80-character limit on descriptions is the defect",
      "Rejecting long descriptions is what leaves invoices without lines.",
    ],
  ],
});
