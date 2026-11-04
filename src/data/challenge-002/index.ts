/*
 * Challenge 002: Reports Visible to Everyone. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-11-02";
const MEMBER_COOKIE = "ll_sid=7d1f0c2a-5b9e-4c61-8f3d-2e6a9b04c7d1";

const report = (id: string, title: string) =>
  JSON.stringify({ id, title, generatedAt: `${id === "rpt_2026_10" ? "2026-11-01" : "2026-10-01"}T06:00:00Z`, rows: 42 });

export const challenge002 = defineChallenge({
  number: "002",
  title: "Reports Visible to Everyone",
  incident: "Member accounts can download finance reports that only administrators should see.",
  difficulty: "beginner",
  tags: ["Authorization", "Express", "Middleware"],
  estimatedMinutes: 15,
  description:
    "A security review found ordinary members downloading admin-only payroll reports, while other admin pages still refuse them. Find out why.",
  category: "authentication",
  technologies: ["TypeScript", "Node.js", "Express"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://ledgerline.example",
  files: {
    "INCIDENT.md": `# INC-002 · Reports Visible to Everyone

**Opened:** ${DATE} 10:20 UTC
**Severity:** SEV-2
**Service:** ledgerline-portal v4.8.1

## Summary
A weekly access review flagged member account u_204 downloading two
payroll summary reports from /admin/reports. Members should not be able to
open anything under /admin.

## What we know
- u_204 is a member, not an administrator, and has been for a year
- The same account is refused on /admin/users and /admin/audit-log
- Administrators can use every admin page normally

## Evidence attached
- Server logs from the portal (Investigation Console, logs/app.log)
- A browser capture exported from u_204's session (Network tab)

## Your task
Explain why one admin page lets a member through when the others refuse.
`,
    "package.json": `{
  "name": "ledgerline-portal",
  "version": "4.8.1",
  "private": true,
  "scripts": { "start": "node dist/server.js", "build": "tsc" },
  "dependencies": { "cookie-parser": "^1.4.7", "express": "^4.21.1" },
  "devDependencies": { "@types/express": "^4.17.21", "typescript": "^5.6.3" }
}
`,
    "src/server.ts": `import cookieParser from "cookie-parser";
import express from "express";
import { authenticate } from "./middleware/authenticate";
import { requestLog } from "./middleware/request-log";
import { adminRouter } from "./routes/admin";
import { accountRouter } from "./routes/account";

const app = express();

app.use(requestLog);
app.use(cookieParser());
app.use(authenticate);

app.use("/account", accountRouter);
app.use("/admin", adminRouter);

app.listen(8080, () => console.info("[http] Server listening on :8080"));
`,
    "src/middleware/authenticate.ts": `import type { NextFunction, Request, Response } from "express";
import { sessions } from "../lib/sessions";
import { log } from "../lib/log";

/** Resolves the session cookie to a user. Every route below this requires one. */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const session = await sessions.find(req.cookies.ll_sid);
  if (!session) return res.status(401).json({ error: "Sign in required" });

  req.user = { id: session.userId, role: session.role };
  log.info("auth", \`Session resumed user=\${session.userId} role=\${session.role}\`);
  next();
}
`,
    "src/middleware/require-role.ts": `import type { NextFunction, Request, Response } from "express";
import { log } from "../lib/log";

export type Role = "member" | "admin";

export function requireRole(required: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { id, role } = req.user;
    if (role !== required) {
      log.warn("authz", \`Role check denied user=\${id} role=\${role} required=\${required} path=\${req.originalUrl}\`);
      return res.status(403).json({ error: "Forbidden" });
    }
    log.info("authz", \`Role check passed user=\${id} role=\${role} required=\${required} path=\${req.originalUrl}\`);
    next();
  };
}
`,
    "src/routes/admin.ts": `import { Router } from "express";
import { auditLog } from "../lib/audit-log";
import { log } from "../lib/log";
import { reports } from "../lib/reports";
import { users } from "../lib/users";
import { requireRole } from "../middleware/require-role";

export const adminRouter = Router();

// Report downloads are linked from the weekly finance email, which points
// straight at this URL, so it gets its own handler.
adminRouter.get("/reports/:reportId", async (req, res) => {
  const report = await reports.find(req.params.reportId);
  if (!report) return res.status(404).json({ error: "Not found" });
  log.info("reports", \`Report downloaded report=\${report.id} user=\${req.user.id}\`);
  res.set("Cache-Control", "private, no-store").json(report);
});

adminRouter.use(requireRole("admin"));

adminRouter.get("/users", async (_req, res) => {
  res.set("Cache-Control", "private, no-store").json(await users.list());
});

adminRouter.get("/audit-log", async (_req, res) => {
  res.set("Cache-Control", "private, no-store").json(await auditLog.recent(100));
});
`,
    "src/routes/account.ts": `import { Router } from "express";
import { users } from "../lib/users";

export const accountRouter = Router();

accountRouter.get("/me", async (req, res) => {
  res.json(await users.find(req.user.id));
});
`,
    "src/lib/sessions.ts": `export interface Session {
  id: string;
  userId: string;
  role: "member" | "admin";
  expiresAt: number;
}

const store = new Map<string, Session>();

export const sessions = {
  async find(id: string | undefined): Promise<Session | undefined> {
    if (!id) return undefined;
    const session = store.get(id);
    return session && session.expiresAt > Date.now() ? session : undefined;
  },
  // Role is copied from the users table at sign-in and refreshed every 15 minutes.
  async save(session: Session) {
    store.set(session.id, session);
  },
};
`,
    "src/lib/reports.ts": `import { db } from "./db";

export interface Report {
  id: string;
  title: string;
  generatedAt: string;
  rows: number;
}

export const reports = {
  find: (id: string) => db.one<Report>("SELECT id, title, generated_at AS \\"generatedAt\\", rows FROM reports WHERE id = $1", [id]),
};
`,
    "src/middleware/request-log.ts": `import type { NextFunction, Request, Response } from "express";
import { log } from "../lib/log";

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const started = Date.now();
  res.on("finish", () => log.info("http", \`\${req.method} \${req.originalUrl} \${res.statusCode} \${Date.now() - started}ms\`));
  next();
}
`,
  },
  logs: [
    ["08:00:03.112", "INFO", "http", "Server listening on :8080"],
    ["09:41:17.204", "INFO", "auth", "Session resumed user=u_118 role=admin"],
    ["09:41:17.231", "INFO", "authz", "Role check passed user=u_118 role=admin required=admin path=/admin/users"],
    ["09:41:17.262", "INFO", "http", "GET /admin/users 200 31ms"],
    ["09:41:22.481", "INFO", "auth", "Session resumed user=u_118 role=admin"],
    ["09:41:22.540", "INFO", "reports", "Report downloaded report=rpt_2026_10 user=u_118"],
    ["09:41:22.541", "INFO", "http", "GET /admin/reports/rpt_2026_10 200 58ms"],
    ["10:03:47.961", "INFO", "auth", "Session resumed user=u_204 role=member"],
    ["10:03:48.019", "INFO", "reports", "Report downloaded report=rpt_2026_10 user=u_204"],
    ["10:03:48.020", "INFO", "http", "GET /admin/reports/rpt_2026_10 200 61ms"],
    ["10:03:55.402", "INFO", "auth", "Session resumed user=u_204 role=member"],
    ["10:03:55.403", "WARN", "authz", "Role check denied user=u_204 role=member required=admin path=/admin/users"],
    ["10:03:55.404", "INFO", "http", "GET /admin/users 403 2ms"],
    ["10:04:10.832", "INFO", "auth", "Session resumed user=u_204 role=member"],
    ["10:04:10.882", "INFO", "reports", "Report downloaded report=rpt_2026_09 user=u_204"],
    ["10:04:10.883", "INFO", "http", "GET /admin/reports/rpt_2026_09 200 49ms"],
    ["10:04:31.100", "INFO", "auth", "Session resumed user=u_204 role=member"],
    ["10:04:31.101", "WARN", "authz", "Role check denied user=u_204 role=member required=admin path=/admin/audit-log"],
    ["10:04:31.102", "INFO", "http", "GET /admin/audit-log 403 1ms"],
  ],
  network: [
    {
      log: 10,
      type: "document",
      requestHeaders: { cookie: MEMBER_COOKIE },
      responseHeaders: { "cache-control": "private, no-store", "x-request-id": "8f2c41d0" },
      response: report("rpt_2026_10", "Payroll summary, October 2026"),
    },
    {
      log: 13,
      requestHeaders: { cookie: MEMBER_COOKIE },
      responseHeaders: { "x-request-id": "8f2c4a77" },
      response: '{"error":"Forbidden"}',
    },
    {
      log: 16,
      type: "document",
      requestHeaders: { cookie: MEMBER_COOKIE },
      responseHeaders: { "cache-control": "private, no-store", "x-request-id": "8f2c5be3" },
      response: report("rpt_2026_09", "Payroll summary, September 2026"),
    },
    {
      log: 19,
      requestHeaders: { cookie: MEMBER_COOKIE },
      responseHeaders: { "x-request-id": "8f2c6e19" },
      response: '{"error":"Forbidden"}',
    },
  ],
  options: [
    [
      "route-registered-before-guard",
      "The report route is registered before the admin role check",
      "Express runs a router's handlers in registration order, so a handler added before the role-check middleware answers the request without it.",
    ],
    [
      "role-check-wrong-field",
      "requireRole compares the wrong value and lets members through",
      "The role check reads a field that is the same for every user, so it passes for members.",
    ],
    [
      "stale-session-role",
      "u_204's session still carries an old admin role",
      "The session copied an admin role at sign-in and has not been refreshed since the account was downgraded.",
    ],
    [
      "shared-cache-served-report",
      "A shared cache served an administrator's report to the member",
      "A proxy or CDN stored the administrator's report response and replayed it to the member's request.",
    ],
    [
      "email-link-bypasses-auth",
      "Links from the finance email skip authentication",
      "Report URLs in the weekly email carry a token that lets the request skip the session check.",
    ],
  ],
});
