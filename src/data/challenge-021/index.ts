/*
 * Challenge 021: Anyone's Invoice. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-14";
const AUTH = { authorization: "Bearer [researcher's test token, sub=u_5090]" };
const invoice = (id: string, customer: string, owner: string, total: string) =>
  JSON.stringify({ id, owner_id: owner, customer_name: customer, total, currency: "USD", status: "paid" });

export const challenge021 = defineChallenge({
  number: "021",
  title: "Anyone's Invoice",
  incident: "A security researcher could download other customers' invoices with their own test account.",
  difficulty: "beginner",
  tags: ["Access control", "IDOR", "API security"],
  estimatedMinutes: 15,
  description:
    "A bug bounty report shows a freshly created account opening invoices that belong to other companies, simply by changing a number in the URL.",
  category: "security",
  technologies: ["TypeScript", "Node.js", "Express"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://billing.ferrous.example",
  files: {
    "INCIDENT.md": `# INC-021 · Anyone's Invoice

**Opened:** ${DATE} 10:30 UTC
**Severity:** SEV-1 (customer data exposure)
**Service:** ferrous-billing-api v5.1.0
**Source:** bug bounty report BB-0442

## Summary
The researcher signed up for a free account (u_5090), created one invoice
of their own, and then requested neighbouring invoice numbers. They
received invoices for other customers, including names and amounts.

## Notes
- The researcher's account is an ordinary member account
- Their token was issued by our identity service and verifies normally
- The invoice list page only ever shows a user's own invoices

## Evidence attached
- API logs (Investigation Console, logs/app.log)
- The researcher's browser capture (Network tab)

## Your task
Explain why the API returns invoices that belong to someone else.
`,
    "package.json": `{
  "name": "ferrous-billing-api",
  "version": "5.1.0",
  "private": true,
  "dependencies": { "express": "^4.21.1", "jose": "^5.9.6", "pg-promise": "^11.10.1" }
}
`,
    "src/routes/invoices.ts": `import { Router } from "express";
import { db } from "../db";
import { log } from "../log";
import { requireAuth } from "../middleware/require-auth";

export const invoices = Router();

invoices.use(requireAuth);

invoices.get("/api/invoices", async (req, res) => {
  const rows = await db.any("SELECT * FROM invoices WHERE owner_id = $1 ORDER BY created_at DESC", [req.user.id]);
  res.json({ invoices: rows });
});

invoices.get("/api/invoices/:id", async (req, res) => {
  const invoice = await db.oneOrNone("SELECT * FROM invoices WHERE id = $1", [req.params.id]);
  if (!invoice) return res.status(404).json({ error: "Not found" });
  log.info("invoices", \`Invoice viewed invoice=\${invoice.id} owner=\${invoice.owner_id} by=\${req.user.id}\`);
  res.json(invoice);
});

invoices.post("/api/invoices", async (req, res) => {
  const invoice = await db.one(
    "INSERT INTO invoices (owner_id, customer_name, total, currency, status) VALUES ($1, $2, $3, $4, 'draft') RETURNING *",
    [req.user.id, req.body.customer_name, req.body.total, req.body.currency],
  );
  log.info("invoices", \`Invoice created invoice=\${invoice.id} owner=\${invoice.owner_id}\`);
  res.status(201).json(invoice);
});
`,
    "src/middleware/require-auth.ts": `import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../auth/tokens";
import { log } from "../log";

/** Every route below this needs a valid access token. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req.get("authorization") ?? "").replace(/^Bearer /, "");
  try {
    const claims = await verifyAccessToken(token);
    req.user = { id: claims.sub, role: claims.role };
    next();
  } catch {
    log.warn("auth", "Rejected request with an invalid token");
    res.status(401).json({ error: "Unauthorized" });
  }
}
`,
    "src/auth/tokens.ts": `import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://id.ferrous.example/.well-known/jwks.json"));

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, jwks, { issuer: "https://id.ferrous.example", audience: "billing-api" });
  return payload as { sub: string; role: "member" | "admin" };
}
`,
    "src/server.ts": `import cors from "cors";
import express from "express";
import { invoices } from "./routes/invoices";

const app = express();
app.use(cors({ origin: "https://billing.ferrous.example", credentials: false }));
app.use(express.json());
app.use(invoices);
app.listen(8080);
`,
  },
  logs: [
    ["10:02:14.551", "INFO", "invoices", "Invoice created invoice=inv_10034 owner=u_5090"],
    ["10:02:14.552", "INFO", "http", "POST /api/invoices 201 12ms"],
    ["10:02:20.118", "INFO", "invoices", "Invoice viewed invoice=inv_10034 owner=u_5090 by=u_5090"],
    ["10:02:20.119", "INFO", "http", "GET /api/invoices/inv_10034 200 5ms"],
    ["10:02:31.402", "INFO", "invoices", "Invoice viewed invoice=inv_10033 owner=u_1187 by=u_5090"],
    ["10:02:31.403", "INFO", "http", "GET /api/invoices/inv_10033 200 4ms"],
    ["10:02:37.990", "INFO", "invoices", "Invoice viewed invoice=inv_10032 owner=u_0412 by=u_5090"],
    ["10:02:37.991", "INFO", "http", "GET /api/invoices/inv_10032 200 5ms"],
    ["10:02:52.660", "INFO", "http", "GET /api/invoices 200 8ms"],
    ["10:03:05.212", "WARN", "auth", "Rejected request with an invalid token"],
    ["10:03:05.213", "INFO", "http", "GET /api/invoices/inv_10031 401 1ms"],
  ],
  network: [
    { log: 2, body: '{"customer_name":"Researcher Test Co","total":"1.00","currency":"USD"}', requestHeaders: AUTH, response: invoice("inv_10034", "Researcher Test Co", "u_5090", "1.00") },
    { log: 4, requestHeaders: AUTH, response: invoice("inv_10034", "Researcher Test Co", "u_5090", "1.00") },
    { log: 6, requestHeaders: AUTH, response: invoice("inv_10033", "Halden Freight LLC", "u_1187", "18240.00") },
    { log: 8, requestHeaders: AUTH, response: invoice("inv_10032", "Mirabel Dental Group", "u_0412", "3975.50") },
    { log: 9, requestHeaders: AUTH, response: JSON.stringify({ invoices: [JSON.parse(invoice("inv_10034", "Researcher Test Co", "u_5090", "1.00"))] }) },
    { log: 11, requestHeaders: { authorization: "Bearer [researcher's expired test token]" }, response: '{"error":"Unauthorized"}' },
  ],
  options: [
    [
      "token-not-verified",
      "Access tokens are accepted without checking their signature",
      "Tokens are trusted without verification, so the researcher could be acting as another user.",
    ],
    [
      "missing-ownership-check",
      "The single-invoice endpoint never checks who owns the invoice",
      "It confirms the caller is signed in, then returns any invoice by id, whoever it belongs to.",
    ],
    [
      "researcher-is-admin",
      "The researcher's account was given an admin role",
      "An admin role lets an account read every customer's invoices.",
    ],
    [
      "cors-misconfigured",
      "CORS lets another site read the API's responses",
      "A permissive CORS policy exposes invoice responses to pages on other origins.",
    ],
  ],
});
