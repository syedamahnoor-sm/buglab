/* Answer key for Challenge 020: The Rollback That Didn't. Server-only; registered in src/server/content. */
import "server-only";
import { challenge020 } from "@/data/challenge-020";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge020, {
  revision: "1",
  correctRootCauseId: "statements-on-different-connections",
  resolutionSummary:
    "createInvoice sends BEGIN, the inserts, COMMIT and ROLLBACK with pool.query. Each pool.query borrows whichever connection " +
    "is free and returns it straight away, so the statements are not guaranteed to share a connection, and a transaction " +
    "belongs to one connection. In the quiet morning test every statement happened to run on pid 3108, so the rollback worked. " +
    "Under load, BEGIN ran on pid 4121, the invoice INSERT on 4133 (outside any transaction, so it committed immediately), the " +
    "failing line on 4127, and ROLLBACK on 4140, where PostgreSQL warned \"there is no transaction in progress\". The invoice " +
    "therefore survived with no lines, and pid 4121 sat idle in its open transaction until it was terminated. The rollback was " +
    "sent, the invoice is not visible early (it was committed), and the 80-character limit only triggers the failure. Taking " +
    "one client with pool.connect() and running every statement of the transaction on it fixes it.",
  observations: [
    { id: "different-pids", why: "BEGIN, INSERT, the failing line and ROLLBACK ran on four different backends", logs: [6, 7, 8, 9] },
    { id: "rollback-had-no-transaction", why: "PostgreSQL says the ROLLBACK had no transaction to roll back", logs: [10] },
    { id: "orphan-invoice", why: "The invoice exists afterwards with no lines", requests: [2] },
    { id: "same-pid-works", why: "When everything ran on one backend the rollback worked", logs: [1, 2, 4] },
    { id: "begin-left-open", why: "The connection that ran BEGIN was left idle in a transaction", logs: [14] },
  ],
  investigationHints: [
    "A transaction lives on one database connection. Check which connection each statement of a failed creation ran on.",
    "Compare the quiet morning test with the busy afternoon failure line by line. What is different in the database log?",
  ],
});
