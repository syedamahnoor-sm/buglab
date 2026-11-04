/* Answer key for Challenge 007: Payments Stuck as Pending. Server-only; registered in src/server/content. */
import "server-only";
import { challenge007 } from "@/data/challenge-007";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge007, {
  revision: "1",
  correctRootCauseId: "signature-over-reserialized-json",
  resolutionSummary:
    "Paylane signs \"<t>.<raw request body>\". express.json() parses every body before the webhook route runs, and the route " +
    "verifies the signature against JSON.stringify(req.body). For plain ASCII payloads re-serializing happens to reproduce the " +
    "same bytes, so evt_8841 and evt_8843 pass. Paylane escapes non-ASCII characters (\"Zo\\u00eb\", \"Jos\\u00e9\"), but " +
    "JSON.stringify writes them as the characters themselves, so the string being hashed differs from the bytes Paylane signed " +
    "and every delivery for those customers fails with reason=mismatch, retries included. The secret is right (other deliveries " +
    "verify), the reason is not stale_timestamp, and each delivery carries a single v1. Verifying against the raw body (for " +
    "example express.raw() on the webhook route, or the verify callback of express.json) fixes it.",
  observations: [
    { id: "only-some-fail", why: "Deliveries with the same secret both pass and fail", logs: [3, 13] },
    { id: "failures-are-mismatch", why: "Failures are HMAC mismatches, not stale timestamps or missing headers", logs: [7, 10, 17] },
    { id: "failing-bodies-escaped", why: "Every rejected body contains \\u escapes; every accepted body is plain ASCII", requests: [2, 3, 5] },
    { id: "passing-bodies-ascii", why: "Accepted deliveries have no characters JSON.stringify would rewrite", requests: [1, 4] },
  ],
  investigationHints: [
    "Line up the deliveries that were accepted with the ones that were rejected. What do the rejected bodies have that the others do not?",
    "Paylane signs specific bytes. Trace exactly which bytes this endpoint feeds into its HMAC.",
  ],
});
