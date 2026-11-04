/* Answer key for Challenge 006: The Missing Recent Orders. Server-only; registered in src/server/content. */
import "server-only";
import { challenge006 } from "@/data/challenge-006";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge006, {
  revision: "1",
  correctRootCauseId: "offset-skips-first-page",
  resolutionSummary:
    "The page parameter is 1-based (Query(1, ge=1)), but app/routes/orders.py passes offset=page * per_page. Page 1 therefore " +
    "skips the first 20 rows, which are the 20 newest orders because the query sorts newest first. The logs show offset=20 for " +
    "page 1, 40 for page 2 and 60 for page 3, and the responses match: page 1 starts at ord_7153 instead of ord_7173, page 3 is " +
    "empty, and c_2210, with only 12 orders, gets an empty first page, so the app says no orders were placed. The count (47) " +
    "and the sort order are correct, and the requests ask for page 1 first. Using offset=(page - 1) * per_page fixes it.",
  observations: [
    { id: "page-one-offset-twenty", why: "Page 1 is queried with offset 20", logs: [3, 12] },
    { id: "offsets-run-ahead", why: "Every later page is a full page ahead too", logs: [6, 9] },
    { id: "newest-orders-missing", why: "Page 1 starts at the 21st newest order and the last page is empty", requests: [1, 3] },
    { id: "small-customer-sees-nothing", why: "A customer with 12 orders gets an empty first page", requests: [4] },
    { id: "count-correct", why: "The count matches the orders in the database", logs: [2, 11] },
  ],
  investigationHints: [
    "Work out which rows each page should contain, then compare that with what the query was asked for and what came back.",
    "Check where page numbers start in the API and in the app, and follow the number from the request to the SQL.",
  ],
});
