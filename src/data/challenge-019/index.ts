/*
 * Challenge 019: Projects From Nowhere. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-16";
const COOKIE = { cookie: "plano_sid=4be1c7" };

export const challenge019 = defineChallenge({
  number: "019",
  title: "Projects From Nowhere",
  incident: "Project lists show archived projects again, plus projects from other companies' workspaces.",
  difficulty: "intermediate",
  tags: ["SQL", "Multi-tenancy", "Query logic"],
  estimatedMinutes: 20,
  description:
    "After the project list learned to include shared projects, users see projects they archived months ago, and one customer spotted a project that belongs to another company.",
  category: "database",
  technologies: ["SQL", "PostgreSQL", "TypeScript", "Node.js"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://app.plano.example",
  files: {
    "INCIDENT.md": `# INC-019 · Projects From Nowhere

**Opened:** ${DATE} 14:30 UTC
**Severity:** SEV-1 (cross-workspace data exposure)
**Service:** plano-api v7.5.0 (released ${DATE} 13:10 UTC)

## Summary
A user in workspace w_204 (Acme Studio) reported a project called "Q4
Payroll Review" in their list. It belongs to workspace w_317, another
customer. Other users report archived projects reappearing.

## Notes
- v7.5.0 added shared projects (visible to everyone in the workspace) to
  the project list (see CHANGELOG.md)
- The archive action still works: archived projects have archived = true
- The API checks the user belongs to the workspace in the URL

## Your task
Explain why the list includes projects it should not.
`,
    "CHANGELOG.md": `# Changelog

## 7.5.0
- Project list now includes projects shared with the whole workspace

## 7.4.2
- Faster workspace switching
`,
    "db/queries/list_projects.sql": `-- Projects a member sees in a workspace: their own active projects, plus
-- projects shared with the workspace.
-- $1 = workspace id, $2 = user id
SELECT id, workspace_id, name, archived, shared
FROM projects
WHERE workspace_id = $1
  AND owner_id = $2
  AND archived = false
   OR shared = true
ORDER BY name;
`,
    "db/schema.sql": `CREATE TABLE projects (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  owner_id      text NOT NULL REFERENCES users(id),
  name          text NOT NULL,
  archived      boolean NOT NULL DEFAULT false,
  shared        boolean NOT NULL DEFAULT false
);

CREATE INDEX projects_workspace_owner ON projects (workspace_id, owner_id);
`,
    "src/routes/projects.ts": `import { readFileSync } from "node:fs";
import { Router } from "express";
import { db } from "../db";
import { log } from "../log";
import { requireMember } from "../middleware/require-member";

const LIST = readFileSync(new URL("../../db/queries/list_projects.sql", import.meta.url), "utf8");

export const projects = Router();

projects.get("/api/workspaces/:workspaceId/projects", requireMember, async (req, res) => {
  const rows = await db.any(LIST, [req.params.workspaceId, req.userId]);
  log.info("projects", \`List workspace=\${req.params.workspaceId} user=\${req.userId} rows=\${rows.length}\`);
  res.json({ projects: rows });
});

projects.post("/api/projects/:id/archive", requireMember, async (req, res) => {
  await db.none("UPDATE projects SET archived = true WHERE id = $1 AND owner_id = $2", [req.params.id, req.userId]);
  log.info("projects", \`Archived project=\${req.params.id} user=\${req.userId}\`);
  res.status(204).end();
});
`,
    "src/middleware/require-member.ts": `import type { NextFunction, Request, Response } from "express";
import { db } from "../db";

/** 403 unless the signed-in user belongs to the workspace in the URL. */
export async function requireMember(req: Request, res: Response, next: NextFunction) {
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) return next();
  const member = await db.oneOrNone("SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id = $2", [workspaceId, req.userId]);
  if (!member) return res.status(403).json({ error: "Not a member of this workspace" });
  next();
}
`,
  },
  logs: [
    ["13:10:04.880", "INFO", "http", "Server listening on :3000"],
    ["14:02:18.330", "INFO", "projects", "Archived project=prj_a17 user=u_88"],
    ["14:02:18.331", "INFO", "http", "POST /api/projects/prj_a17/archive 204 6ms"],
    ["14:02:19.012", "INFO", "projects", "List workspace=w_204 user=u_88 rows=5"],
    ["14:02:19.013", "INFO", "http", "GET /api/workspaces/w_204/projects 200 14ms"],
    ["14:05:51.440", "INFO", "projects", "List workspace=w_317 user=u_402 rows=5"],
    ["14:05:51.441", "INFO", "http", "GET /api/workspaces/w_317/projects 200 12ms"],
    ["14:09:30.009", "INFO", "db", "audit: projects owned by u_88 in w_204: 3 (2 active, 1 archived); shared projects in w_204: 1 (archived); shared projects in w_317: 2"],
  ],
  network: [
    { log: 3, initiator: "src/routes/projects.ts", requestHeaders: COOKIE },
    {
      log: 5,
      requestHeaders: COOKIE,
      response: JSON.stringify({
        projects: [
          { id: "prj_a12", workspace_id: "w_204", name: "Brand refresh", archived: false, shared: false },
          { id: "prj_a17", workspace_id: "w_204", name: "Holiday campaign 2025", archived: true, shared: true },
          { id: "prj_b40", workspace_id: "w_317", name: "Office move", archived: false, shared: true },
          { id: "prj_b33", workspace_id: "w_317", name: "Q4 Payroll Review", archived: false, shared: true },
          { id: "prj_a09", workspace_id: "w_204", name: "Website copy", archived: false, shared: false },
        ],
      }),
    },
  ],
  options: [
    [
      "archive-not-saved",
      "Archiving no longer saves the archived flag",
      "The archive request succeeds but the project is never marked archived.",
    ],
    [
      "membership-check-missing",
      "The API no longer checks which workspace the user belongs to",
      "Requests for any workspace are allowed, so users can list other workspaces' projects.",
    ],
    [
      "and-or-precedence",
      "The new OR condition is not grouped, so it bypasses the workspace and archive filters",
      "AND binds tighter than OR, so every shared project in every workspace matches, archived or not.",
    ],
    [
      "stale-list-cache",
      "A cached project list from before the archive is being served",
      "The list response is cached and still contains projects that were archived since.",
    ],
  ],
});
