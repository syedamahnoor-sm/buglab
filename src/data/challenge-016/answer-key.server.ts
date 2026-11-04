/* Answer key for Challenge 016: Revenue Too Good to Be True. Server-only; registered in src/server/content. */
import "server-only";
import { challenge016 } from "@/data/challenge-016";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge016, {
  revision: "1",
  correctRootCauseId: "join-repeats-order-totals",
  resolutionSummary:
    "To add units sold, v1.12.0 joined order_items into the daily query. The join produces one row per item, and o.total is " +
    "repeated on every one of them, so sum(o.total) counts each order once per item. count(DISTINCT o.id) is still right (212, " +
    "matching settlement), which is why only revenue looks wrong. The QA store shows it cleanly: one order of 30.00 with three " +
    "items reports 90.00, exactly three times the total. For the main store 611 items over 212 orders inflate 19,804.55 to " +
    "48,331.10. There are no refunds, the order count rules out duplicate orders, and the day window is a single UTC day. " +
    "Aggregating the items in a subquery (or summing totals over DISTINCT orders separately from units) fixes it.",
  observations: [
    { id: "single-order-tripled", why: "One 30.00 order with three items reports 90.00", logs: [3], requests: [2, 3] },
    { id: "order-count-matches", why: "Order and payment counts agree; only revenue is off", logs: [2, 5] },
    { id: "payments-are-real-revenue", why: "Settlement gives the true amounts", logs: [6] },
    { id: "main-store-inflated", why: "The main store's revenue is inflated by its items per order", requests: [1] },
  ],
  investigationHints: [
    "The QA store has one order. Work out what each row of the query looks like for that one order before anything is summed.",
    "Compare which figures in the report agree with the payments and which do not.",
  ],
});
