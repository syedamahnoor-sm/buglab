/* Answer key for Challenge 026: The Query That Never Ends. Server-only; registered in src/server/content. */
import "server-only";
import { challenge026 } from "@/data/challenge-026";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge026, {
  revision: "1",
  correctRootCauseId: "function-defeats-index",
  resolutionSummary:
    "To make tracking codes case-insensitive, v4.6.0 changed the lookup to WHERE lower(tracking_code) = lower($1). The only " +
    "index is on tracking_code itself, and PostgreSQL can use an index only for conditions on the indexed expression, so the " +
    "planner falls back to a sequential scan of all 48 million rows. auto_explain shows it: before the release an Index Scan " +
    "using shipments_tracking_code_idx in 2.9 ms, after it a Seq Scan removing 48,120,331 rows in 8.4 s, for every lookup, " +
    "which also explains the CPU. The index is still used by name before the release and was not dropped, the pool reports " +
    "nothing waiting, and bloat would not turn an index scan into a sequential scan. An expression index on lower(tracking_code) " +
    "(or normalising codes to upper case on write and on lookup) fixes it.",
  observations: [
    { id: "seq-scan-after-release", why: "After the release the plan is a sequential scan over the whole table", logs: [5, 8] },
    { id: "index-scan-before", why: "Before the release the same lookup used the index", logs: [1] },
    { id: "slow-requests", why: "Every lookup now takes over 8 seconds", logs: [7, 10], requests: [2, 3] },
    { id: "pool-not-waiting", why: "No request waits for a connection", logs: [6, 9] },
  ],
  investigationHints: [
    "Compare the query plan from before the release with one from after. What does the database do differently?",
    "Check whether the condition the query now uses matches what the index was built on.",
  ],
});
