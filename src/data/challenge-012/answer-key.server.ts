/* Answer key for Challenge 012: Search Results From the Past. Server-only; registered in src/server/content. */
import "server-only";
import { challenge012 } from "@/data/challenge-012";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge012, {
  revision: "1",
  correctRootCauseId: "out-of-order-responses",
  resolutionSummary:
    "SearchBox starts a request on every keystroke and calls setResults with whichever response arrives, with no way to ignore " +
    "a stale one. Working back from the finish times and durations, the requests started in typing order (r, re, rea, reac, " +
    "react), but the broad \"rea\" query took 1.2 s on the server and 1.4 s in the browser. The \"react\" results arrived and were " +
    "rendered correctly at 10:02:42.096, then the \"rea\" response arrived at 10:02:42.746 and replaced them, so the screen shows " +
    "\"rea\" results under \"react\". Each response matches its own query and has Cache-Control: no-store, and each request was " +
    "for the full text typed so far. Ignoring stale responses (an AbortController or a flag in the effect's cleanup) fixes it.",
  observations: [
    { id: "rea-finished-last", why: "The \"rea\" request finished after the \"react\" request", logs: [12], requests: [5] },
    { id: "react-results-replaced", why: "The correct results were rendered and then replaced", logs: [10, 13] },
    { id: "slow-broad-query", why: "The broad query took far longer on the server", logs: [11] },
    { id: "responses-match-queries", why: "Each response matches the query it was sent for", requests: [4] },
    { id: "input-is-react", why: "The input shows \"react\" throughout", logs: [9, 14] },
  ],
  investigationHints: [
    "Work out when each request started as well as when it finished, and put them on one timeline.",
    "Look at what the component does with a response that arrives after the user has typed more.",
  ],
});
