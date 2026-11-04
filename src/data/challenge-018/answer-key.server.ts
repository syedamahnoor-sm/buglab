/* Answer key for Challenge 018: The Account With Nothing in It. Server-only; registered in src/server/content. */
import "server-only";
import { challenge018 } from "@/data/challenge-018";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge018, {
  revision: "1",
  correctRootCauseId: "case-sensitive-unique-email",
  resolutionSummary:
    "users_email_key is a unique index on email as typed, so it is case-sensitive: \"Ana.Ruiz@example.com\" (her 2024 account) " +
    "and \"ana.ruiz@example.com\" (typed in the app this morning) are different values and both were accepted, so signup " +
    "returned 201 instead of 409. Sign-in, however, matches lower(email) = lower($1) with LIMIT 1 and no ORDER BY, so either " +
    "account can come back: one sign-in landed on u_7c21e0b4 with 0 orders, another on u_1a90f3d2 with 37. The admin lookup " +
    "shows both accounts. Her orders were never moved and the sessions are working as designed. A unique index on " +
    "lower(email) (after merging existing duplicates), and normalising emails at signup, fixes it.",
  observations: [
    { id: "second-account-created", why: "Signup created a new account for the lowercase address", logs: [1, 2] },
    { id: "two-accounts-one-person", why: "The admin tool shows two accounts differing only in case", requests: [1] },
    { id: "login-lands-on-either", why: "Sign-ins with the same address land on different accounts", logs: [3, 7] },
    { id: "history-differs", why: "One account has her 37 orders and the other none", logs: [5, 9] },
  ],
  investigationHints: [
    "Compare exactly how signup and sign-in each decide whether two email addresses are the same.",
    "Look at every account the admin tool finds for her address, character by character.",
  ],
});
