/* Answer key for Challenge 019: Projects From Nowhere. Server-only; registered in src/server/content. */
import "server-only";
import { challenge019 } from "@/data/challenge-019";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge019, {
  revision: "1",
  correctRootCauseId: "and-or-precedence",
  resolutionSummary:
    "In list_projects.sql, AND binds tighter than OR, so the WHERE clause means (workspace_id = $1 AND owner_id = $2 AND " +
    "archived = false) OR shared = true. The new OR shared = true is therefore true for every shared project in the whole " +
    "table, whatever its workspace or archived flag. For u_88 in w_204 that returns their two active projects plus three shared " +
    "ones: prj_a17 (archived a second earlier, and correctly saved as archived = true) and two projects from w_317. The audit " +
    "line confirms the counts (2 active + 1 shared in w_204 + 2 shared in w_317 = 5). The membership check passed because u_88 " +
    "asked for their own workspace, and the response is fresh from the database. Grouping the conditions (workspace_id = $1 " +
    "AND archived = false AND (owner_id = $2 OR shared = true)) fixes it.",
  observations: [
    { id: "other-workspace-rows", why: "The w_204 list includes projects whose workspace_id is w_317", requests: [2] },
    { id: "archived-shared-returned", why: "An archived project comes back, and it is marked archived", logs: [2], requests: [1] },
    { id: "counts-add-up", why: "Five rows are exactly the user's active projects plus every shared project anywhere", logs: [4, 8] },
    { id: "other-workspace-same-count", why: "A member of w_317 gets the same shared projects from w_204", logs: [6] },
  ],
  investigationHints: [
    "Take each project in the response and decide which part of the WHERE clause let it through.",
    "Compare the row counts in the logs with the audit line's breakdown.",
  ],
});
