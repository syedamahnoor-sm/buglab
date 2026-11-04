/* Answer key for Challenge 002: Reports Visible to Everyone. Server-only; registered in src/server/content. */
import "server-only";
import { defineAnswerKey } from "@/server/content/define-answer-key";
import { challenge002 } from "@/data/challenge-002";

export const answerKey = defineAnswerKey(challenge002, {
  revision: "1",
  correctRootCauseId: "route-registered-before-guard",
  resolutionSummary:
    "In src/routes/admin.ts the GET /reports/:reportId handler is registered before adminRouter.use(requireRole(\"admin\")). " +
    "Express runs a router's stack in order, and the report handler ends the request with a response, so the role check " +
    "registered after it never runs for report downloads. The logs show it: every report download, even the administrator's, " +
    "goes straight from \"Session resumed\" to \"Report downloaded\" with no authz line, while /admin/users and /admin/audit-log " +
    "always log a role check and refuse u_204 with 403. The session role is current (role=member) and the responses are " +
    "private, no-store, so neither a stale role nor a cache is involved. Registering requireRole(\"admin\") before every admin " +
    "route (or applying it where the router is mounted) fixes it.",
  observations: [
    { id: "member-downloads-report", why: "A member gets 200 and the report body from /admin/reports", logs: [9, 15], requests: [1, 3] },
    { id: "guard-refuses-member-elsewhere", why: "The same member is refused by the role check on other admin pages", logs: [12, 18], requests: [2, 4] },
    { id: "no-role-check-on-reports", why: "Report downloads never log a role check, even for the administrator", logs: [6] },
    { id: "role-is-current", why: "The session already reports role=member, so the role is not stale", logs: [8, 14] },
  ],
  investigationHints: [
    "Put a refused request and an allowed request side by side in the logs. Which steps appear for one but not the other?",
    "Follow one report download through src/server.ts and the router it is mounted on, in the order Express would run each function.",
  ],
});
