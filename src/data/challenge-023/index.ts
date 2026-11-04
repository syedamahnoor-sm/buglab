/*
 * Challenge 023: The Permission That Never Updated. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-04";
const COOKIE = { cookie: "pd_sid=[removed]" };
const ADMIN_PERMS = JSON.stringify({ userId: "u_510", role: "admin", permissions: ["project.read", "project.edit", "project.archive", "project.delete", "members.manage"] });
const VIEWER_PERMS = JSON.stringify({ userId: "u_510", role: "viewer", permissions: ["project.read"] });
const FORBIDDEN = '{"error":"forbidden","required":"project.archive"}';

export const challenge023 = defineChallenge({
  number: "023",
  title: "The Permission That Never Updated",
  incident: "A user moved from Administrator to Viewer still sees admin buttons, and every one of them fails when clicked.",
  difficulty: "intermediate",
  tags: ["React", "Caching", "Authorization"],
  estimatedMinutes: 25,
  description:
    "An employee's role was reduced to Viewer mid-morning. Their open browser tab kept offering Archive, Delete and Manage members, and each click ended in an error. After a refresh the buttons were gone.",
  category: "security",
  technologies: ["TypeScript", "React", "Node.js", "Express"],
  publishedAt: "2026-11-05",
  incidentDate: DATE,
  origin: "https://app.plinthdesk.example",
  files: {
    "INCIDENT.md": `# INC-023 · The Permission That Never Updated

**Opened:** ${DATE} 10:40 UTC
**Severity:** SEV-3 (confusing UI; security team asked for confirmation)
**Service:** plinthdesk-web v4.2.0 and plinthdesk-api v4.2.0

## Summary
At 10:15 workspace owner u_002 changed u_510 from Administrator to
Viewer. u_510 had the app open since 10:02. For the next nine minutes
their tab still showed admin controls, and every admin action they tried
failed with "Something went wrong". After reloading, the controls were gone.

The security team wants to know whether u_510 could still perform admin
actions after the change, and why the screen disagreed with their role.

## Evidence attached
- API logs (Investigation Console, logs/app.log)
- u_510's browser capture from 10:02 to the reload at 10:24

## Your task
Explain why the screen showed controls the user no longer had.
`,
    "package.json": `{
  "name": "plinthdesk-web",
  "version": "4.2.0",
  "private": true,
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" }
}
`,
    "web/src/permissions/PermissionsProvider.tsx": `import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchPermissions, type Permissions } from "../api";

// Kept for the lifetime of the page, so moving between screens never waits on the API.
let cached: Permissions | null = null;

const PermissionsContext = createContext<Permissions | null>(null);

/** Loads the signed-in user's permissions once and shares them with the whole app. */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [permissions, setPermissions] = useState<Permissions | null>(cached);

  useEffect(() => {
    if (permissions) return;
    fetchPermissions().then((loaded) => {
      cached = loaded;
      setPermissions(loaded);
    });
  }, [permissions]);

  return <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>;
}

export function useCan(permission: string): boolean {
  return useContext(PermissionsContext)?.permissions.includes(permission) ?? false;
}
`,
    "web/src/projects/ProjectActions.tsx": `import { archiveProject, deleteProject } from "../api";
import { useCan } from "../permissions/PermissionsProvider";
import { showToast } from "../ui/toast";

export function ProjectActions({ projectId }: { projectId: string }) {
  const canArchive = useCan("project.archive");
  const canDelete = useCan("project.delete");

  async function run(action: () => Promise<Response>) {
    const response = await action();
    if (!response.ok) showToast("Something went wrong. Please try again.");
  }

  return (
    <div className="actions">
      {canArchive && <button onClick={() => run(() => archiveProject(projectId))}>Archive</button>}
      {canDelete && <button onClick={() => run(() => deleteProject(projectId))}>Delete</button>}
    </div>
  );
}
`,
    "web/src/api.ts": `export interface Permissions {
  userId: string;
  role: "admin" | "editor" | "viewer";
  permissions: string[];
}

export const fetchPermissions = (): Promise<Permissions> => fetch("/api/me/permissions").then((r) => r.json());
export const archiveProject = (id: string) => fetch(\`/api/projects/\${id}/archive\`, { method: "POST" });
export const deleteProject = (id: string) => fetch(\`/api/projects/\${id}/delete\`, { method: "POST" });
`,
    "server/middleware/require-permission.ts": `import type { NextFunction, Request, Response } from "express";
import { log } from "../log";
import { permissionsFor } from "../roles";

/** Checks the caller's CURRENT role on every request; roles are read from the database, not the session. */
export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { role, permissions } = await permissionsFor(req.userId);
    if (!permissions.includes(permission)) {
      log.warn("authz", \`Denied user=\${req.userId} role=\${role} required=\${permission}\`);
      return res.status(403).json({ error: "forbidden", required: permission });
    }
    next();
  };
}
`,
    "server/routes/me.ts": `import { Router } from "express";
import { permissionsFor } from "../roles";

export const me = Router();

me.get("/api/me/permissions", async (req, res) => {
  const { role, permissions } = await permissionsFor(req.userId);
  res.set("Cache-Control", "no-store").json({ userId: req.userId, role, permissions });
});
`,
  },
  logs: [
    ["10:02:11.204", "INFO", "http", "GET /api/me/permissions 200 7ms"],
    ["10:15:03.660", "INFO", "admin", "Role changed user=u_510 from=admin to=viewer by=u_002"],
    ["10:15:03.662", "INFO", "http", "POST /api/workspaces/w_31/members/u_510/role 200 12ms"],
    ["10:18:40.017", "WARN", "authz", "Denied user=u_510 role=viewer required=project.archive"],
    ["10:18:40.018", "INFO", "http", "POST /api/projects/prj_9/archive 403 4ms"],
    ["10:20:12.775", "WARN", "authz", "Denied user=u_510 role=viewer required=project.delete"],
    ["10:20:12.776", "INFO", "http", "POST /api/projects/prj_9/delete 403 3ms"],
    ["10:22:58.301", "WARN", "authz", "Denied user=u_510 role=viewer required=members.manage"],
    ["10:22:58.302", "INFO", "http", "POST /api/workspaces/w_31/members/u_77/remove 403 3ms"],
    ["10:24:30.118", "INFO", "web", "Page reloaded by u_510"],
    ["10:24:30.402", "INFO", "http", "GET /api/me/permissions 200 6ms"],
  ],
  network: [
    { log: 1, initiator: "web/src/api.ts", requestHeaders: COOKIE, responseHeaders: { "cache-control": "no-store" }, response: ADMIN_PERMS },
    { log: 5, initiator: "web/src/api.ts", requestHeaders: COOKIE, response: FORBIDDEN },
    { log: 7, initiator: "web/src/api.ts", requestHeaders: COOKIE, response: FORBIDDEN.replace("project.archive", "project.delete") },
    { log: 9, requestHeaders: COOKIE, response: FORBIDDEN.replace("project.archive", "members.manage") },
    { log: 11, initiator: "web/src/api.ts", requestHeaders: COOKIE, responseHeaders: { "cache-control": "no-store" }, response: VIEWER_PERMS },
  ],
  options: [
    [
      "backend-still-allows-admin",
      "The API kept accepting the user's admin actions after the change",
      "The server did not apply the new role, so the user could still archive and delete until they reloaded.",
    ],
    [
      "role-change-not-saved",
      "The role change was not saved until later",
      "The new role only took effect when the user reloaded, so the screen showed what the server believed at the time.",
    ],
    [
      "client-permissions-never-refreshed",
      "The app loaded the permissions once and kept showing them after the role changed",
      "The browser kept the 10:02 permissions in memory, and nothing in the app asked for them again until the page was reloaded.",
    ],
    [
      "permissions-response-cached",
      "A cache returned an old permissions response",
      "An HTTP or CDN cache served the earlier admin permissions instead of the current ones.",
    ],
  ],
});
