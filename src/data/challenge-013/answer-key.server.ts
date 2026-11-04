/* Answer key for Challenge 013: The Board That Never Stops Loading. Server-only; registered in src/server/content. */
import "server-only";
import { challenge013 } from "@/data/challenge-013";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge013, {
  revision: "1",
  correctRootCauseId: "effect-depends-on-new-object",
  resolutionSummary:
    "TaskBoard builds filters = { status, assignee } during render and lists that object as the effect's dependency. React " +
    "compares dependencies with Object.is, and a new object is never equal to the previous one, so the effect runs after every " +
    "render. Each run fetches the tasks and calls setTasks with a new array, which renders again, which creates a new filters " +
    "object, which runs the effect again: an endless loop with no filter change at all. The capture shows identical requests " +
    "about 26 ms apart until the limiter answers 429. This is a production build, there is no timer, and 120 requests a minute " +
    "is generous for one board. Depending on the primitive values ([status, assignee]) or memoising the object fixes it.",
  observations: [
    { id: "identical-requests-burst", why: "The same request repeats every ~26 ms with nothing changed", logs: [3, 4, 5, 6, 7, 8, 9, 10], requests: [3, 4, 5, 6] },
    { id: "no-filter-changes", why: "Monitoring saw 412 requests with no filter change", logs: [14] },
    { id: "limiter-steps-in", why: "Only after the flood does the limiter refuse the user", logs: [11, 12], requests: [7] },
  ],
  investigationHints: [
    "Count what changes between two consecutive identical requests. If nothing the user did changed, what else could start a fetch?",
    "Trace one cycle through the component: what runs after the response arrives, and what that causes next.",
  ],
});
