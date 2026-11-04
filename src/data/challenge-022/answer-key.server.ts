/* Answer key for Challenge 022: The Forgotten Role Check. Server-only; registered in src/server/content. */
import "server-only";
import { challenge022 } from "@/data/challenge-022";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge022, {
  revision: "1",
  correctRootCauseId: "server-trusts-ui-visibility",
  resolutionSummary:
    "POST /:userId/remove in src/routes/members.ts runs after requireMembership only. Its comment explains the assumption: " +
    "only owners see the button. Hiding a button is not access control: any client that sends the request (here QA's " +
    "authorization test) reaches the handler, and nothing on the server requires the owner role. " +
    "The logs show the difference: the rename request from the same editor gets \"Role check denied ... required=owner\" and 403, " +
    "while the removal logs only \"Membership ok ... role=editor\" and succeeds with 204. The membership and session correctly " +
    "say editor, and requireRole works where it is used. Adding requireRole(\"owner\") to the remove route (and to every member " +
    "management route, ideally with a test per action) fixes it.",
  observations: [
    { id: "removal-succeeds-for-editor", why: "The editor's removal request succeeds and is audited", logs: [7, 8], requests: [3] },
    { id: "role-is-editor", why: "The server knows the caller is an editor", logs: [1, 6] },
    { id: "rename-is-protected", why: "The same editor is refused on an owner-only route that has a role check", logs: [4, 5], requests: [2] },
    { id: "production-event", why: "The same pattern occurred in production", logs: [9] },
  ],
  investigationHints: [
    "Compare the log lines for the refused rename with those for the accepted removal. Which check appears in one and not the other?",
    "List where each owner-only action enforces its permission, on the client and on the server.",
  ],
});
