/* Answer key for Challenge 021: Anyone's Invoice. Server-only; registered in src/server/content. */
import "server-only";
import { challenge021 } from "@/data/challenge-021";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge021, {
  revision: "1",
  correctRootCauseId: "missing-ownership-check",
  resolutionSummary:
    "GET /api/invoices/:id runs after requireAuth, so it knows the caller is signed in, but it loads the invoice with WHERE " +
    "id = $1 only and returns it whoever owns it. That is an insecure direct object reference (IDOR): the researcher, u_5090, " +
    "requested inv_10033 and inv_10032 and the log itself records owner=u_1187 and owner=u_0412 with by=u_5090. The list " +
    "endpoint filters by owner_id, which is why the UI never showed it. Tokens are verified properly (an expired token was " +
    "rejected with 401), the account is a member, and CORS is limited to the app's own origin. Adding AND owner_id = $2 (and " +
    "answering 404, not 403, for other people's invoices) fixes it.",
  observations: [
    { id: "other-owners-returned", why: "Invoices owned by other users were returned to u_5090", logs: [5, 7], requests: [3, 4] },
    { id: "list-is-filtered", why: "The list endpoint only returns the caller's own invoice", requests: [5] },
    { id: "token-verification-works", why: "An invalid token is rejected", logs: [10], requests: [6] },
    { id: "own-invoice-baseline", why: "The researcher's own invoice is inv_10034", logs: [1, 3] },
  ],
  investigationHints: [
    "For each invoice the researcher opened, compare who owns it with who asked for it.",
    "Compare the checks the list endpoint makes with the checks the single-invoice endpoint makes.",
  ],
});
