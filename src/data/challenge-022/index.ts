/*
 * Challenge 022: The Forgotten Role Check. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-13";
const EDITOR = { cookie: "tw_sid=qa-editor-7f21" };

export const challenge022 = defineChallenge({
  number: "022",
  title: "The Forgotten Role Check",
  incident: "An editor removed a workspace owner from the team, an action only owners are meant to have.",
  difficulty: "intermediate",
  tags: ["Authorization", "RBAC", "API design"],
  estimatedMinutes: 20,
  description:
    "Editors never see the \"Remove member\" button, yet the audit log shows an editor removing a colleague. QA reproduced it in a test workspace. Find where the permission is meant to be enforced.",
  category: "security",
  technologies: ["TypeScript", "Node.js", "Express", "React"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://app.teamweave.example",
  files: {
    "INCIDENT.md": `# INC-022 · The Forgotten Role Check

**Opened:** ${DATE} 15:00 UTC
**Severity:** SEV-2
**Service:** teamweave-api v3.8.0

## Summary
Workspace w_55's audit log shows editor u_77 removing owner u_12. Editors
should not be able to remove anyone. The UI only shows "Remove member" to
owners.

## What QA did
QA added authorization tests that call each owner-only endpoint in the
test workspace w_qa with an editor account. The rename test was refused
as expected; the member-removal test succeeded. The test run's logs and
requests are attached.

## Roles
- owner: manage members, rename and delete the workspace
- editor: edit documents
- viewer: read documents

## Your task
Explain why an editor's removal request succeeds.
`,
    "package.json": `{
  "name": "teamweave-api",
  "version": "3.8.0",
  "private": true,
  "dependencies": { "express": "^4.21.1", "react": "^18.3.1" }
}
`,
    "src/routes/members.ts": `import { Router } from "express";
import { audit } from "../lib/audit";
import { members } from "../lib/members";
import { requireMembership } from "../middleware/require-membership";

export const membersRouter = Router({ mergeParams: true });

membersRouter.use(requireMembership);

membersRouter.get("/", async (req, res) => {
  res.json({ members: await members.list(req.params.workspaceId) });
});

// Only owners see the Remove button (see MemberList.tsx).
membersRouter.post("/:userId/remove", async (req, res) => {
  await members.remove(req.params.workspaceId, req.params.userId);
  await audit.record({ actor: req.user.id, action: "member.removed", workspace: req.params.workspaceId, target: req.params.userId });
  res.status(204).end();
});
`,
    "src/routes/workspace.ts": `import { Router } from "express";
import { workspaces } from "../lib/workspaces";
import { requireMembership } from "../middleware/require-membership";
import { requireRole } from "../middleware/require-role";

export const workspaceRouter = Router({ mergeParams: true });

workspaceRouter.post("/rename", requireMembership, requireRole("owner"), async (req, res) => {
  await workspaces.rename(req.params.workspaceId, String(req.body.name));
  res.status(204).end();
});
`,
    "src/middleware/require-membership.ts": `import type { NextFunction, Request, Response } from "express";
import { log } from "../lib/log";
import { members } from "../lib/members";

/** Loads the caller's membership of the workspace in the URL, or answers 403. */
export async function requireMembership(req: Request, res: Response, next: NextFunction) {
  const membership = await members.find(req.params.workspaceId, req.user.id);
  if (!membership) return res.status(403).json({ error: "Not a member" });
  req.membership = membership;
  log.info("authz", \`Membership ok user=\${req.user.id} workspace=\${req.params.workspaceId} role=\${membership.role}\`);
  next();
}
`,
    "src/middleware/require-role.ts": `import type { NextFunction, Request, Response } from "express";
import { log } from "../lib/log";

export function requireRole(role: "owner" | "editor") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.membership?.role !== role) {
      log.warn("authz", \`Role check denied user=\${req.user.id} role=\${req.membership?.role} required=\${role}\`);
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
`,
    "web/src/members/MemberList.tsx": `import type { Member } from "../api";

export function MemberList({ members, myRole, onRemove }: { members: Member[]; myRole: string; onRemove: (id: string) => void }) {
  return (
    <ul>
      {members.map((member) => (
        <li key={member.userId}>
          {member.name} · {member.role}
          {myRole === "owner" && <button onClick={() => onRemove(member.userId)}>Remove member</button>}
        </li>
      ))}
    </ul>
  );
}
`,
  },
  logs: [
    ["14:21:05.330", "INFO", "authz", "Membership ok user=u_qa_editor workspace=w_qa role=editor"],
    ["14:21:05.336", "INFO", "http", "GET /api/workspaces/w_qa/members 200 9ms"],
    ["14:21:31.902", "INFO", "authz", "Membership ok user=u_qa_editor workspace=w_qa role=editor"],
    ["14:21:31.904", "WARN", "authz", "Role check denied user=u_qa_editor role=editor required=owner"],
    ["14:21:31.905", "INFO", "http", "POST /api/workspaces/w_qa/rename 403 4ms"],
    ["14:22:10.117", "INFO", "authz", "Membership ok user=u_qa_editor workspace=w_qa role=editor"],
    ["14:22:10.129", "INFO", "audit", "member.removed actor=u_qa_editor workspace=w_qa target=u_qa_owner"],
    ["14:22:10.130", "INFO", "http", "POST /api/workspaces/w_qa/members/u_qa_owner/remove 204 14ms"],
    ["14:23:00.000", "INFO", "audit", "Audit lookup: production event at 09:12:47 member.removed actor=u_77 workspace=w_55 target=u_12"],
  ],
  network: [
    {
      log: 2,
      requestHeaders: EDITOR,
      response: JSON.stringify({ members: [{ userId: "u_qa_owner", name: "QA Owner", role: "owner" }, { userId: "u_qa_editor", name: "QA Editor", role: "editor" }] }),
    },
    { log: 5, requestHeaders: EDITOR, body: '{"name":"Renamed by editor"}', response: '{"error":"Forbidden"}' },
    { log: 8, requestHeaders: EDITOR },
  ],
  options: [
    [
      "role-stored-wrongly",
      "The editor's membership is stored with the owner role",
      "A data problem gives the editor owner rights everywhere.",
    ],
    [
      "server-trusts-ui-visibility",
      "The remove endpoint relies on the UI hiding the button and never checks the role",
      "The server only confirms membership; nothing on the server requires the owner role for this action.",
    ],
    [
      "role-check-broken",
      "The shared role-check middleware lets editors through",
      "requireRole compares roles incorrectly, so editors pass as owners.",
    ],
    [
      "stale-session-role",
      "The editor's session still carries an owner role from earlier",
      "The session remembers an old role, so the server treats the editor as an owner.",
    ],
  ],
});
