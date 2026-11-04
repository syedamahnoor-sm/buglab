/* Answer key for Challenge 017: One Lamp, Two Buyers. Server-only; registered in src/server/content. */
import "server-only";
import { challenge017 } from "@/data/challenge-017";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge017, {
  revision: "1",
  correctRootCauseId: "read-modify-write-race",
  resolutionSummary:
    "reserve() reads available, checks it and subtracts in Python, then writes the result with a plain UPDATE. Under READ " +
    "COMMITTED nothing stops two transactions from reading the same value: web-1 read 1 at 19:00:03.118 and web-2 read 1 at " +
    ".131, before either wrote. Both passed the check and both wrote available=0, so the stock never went negative and the " +
    "CHECK constraint had nothing to catch, yet two orders were created for one unit. There is a single primary and no cache, " +
    "and the next checkout correctly saw 0. An atomic conditional update (UPDATE ... SET available = available - :q WHERE sku = " +
    ":sku AND available >= :q, checking the row count) or SELECT ... FOR UPDATE fixes it.",
  observations: [
    { id: "both-read-one", why: "Both workers read available=1 before either wrote", logs: [2, 3] },
    { id: "both-wrote-zero", why: "Both wrote 0, so stock never went negative", logs: [4, 7] },
    { id: "two-orders-created", why: "Both checkouts created orders", logs: [5, 8], requests: [1] },
    { id: "warehouse-short", why: "Only one order could be picked", logs: [12], requests: [2] },
  ],
  investigationHints: [
    "Interleave the two workers' log lines by time. What did each one know when it made its decision?",
    "Check whether the database ever saw a value that broke one of its rules.",
  ],
});
