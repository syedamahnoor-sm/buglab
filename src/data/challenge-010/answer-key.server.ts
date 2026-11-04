/* Answer key for Challenge 010: Page 1 of 548. Server-only; registered in src/server/content. */
import "server-only";
import { challenge010 } from "@/data/challenge-010";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge010, {
  revision: "1",
  correctRootCauseId: "count-serialized-as-string",
  resolutionSummary:
    "PostgreSQL's count(*) is a bigint, and node-postgres returns bigint values as strings, so the new ticket query's total is " +
    "\"137\". The route sends it on unchanged, and the response shows \"total\":\"137\" in quotes, while the Prisma-based projects " +
    "endpoint returns the number 42. In the browser, Pagination computes Math.floor((total + pageSize - 1) / pageSize): with a " +
    "string, \"137\" + 25 is the string \"13725\", minus 1 is 13724, divided by 25 and floored is 548. Pages 1 to 6 have tickets " +
    "and the rest are empty, exactly as the logs show (offset 7775 for page 312, 0 rows). The total itself is correct for the " +
    "team, and the same component works for projects, so the formula and the count are fine. Converting the count to a number " +
    "on the server (count(*)::int, or Number(total)) fixes it.",
  observations: [
    { id: "total-is-quoted", why: "The ticket responses carry total as the string \"137\"", requests: [1, 4] },
    { id: "projects-total-is-number", why: "The projects endpoint returns total as a number, and its pagination is right", requests: [5] },
    { id: "page-count-548", why: "The browser computed 548 pages for 137 tickets", logs: [6], requests: [3] },
    { id: "count-is-right", why: "The database total for the team is 137, as expected", logs: [2, 8] },
    { id: "far-pages-empty", why: "Pages past 6 return no rows", logs: [4], requests: [2] },
  ],
  investigationHints: [
    "Work out the page count by hand from the values in a real response, exactly as the browser code would.",
    "Compare a response from the ticket endpoint with one from the projects endpoint, value by value.",
  ],
});
