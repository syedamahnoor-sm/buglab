/* Answer key for Challenge 015: Every Message Arrives Twice. Server-only; registered in src/server/content. */
import "server-only";
import { challenge015 } from "@/data/challenge-015";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge015, {
  revision: "1",
  correctRootCauseId: "click-and-submit-both-send",
  resolutionSummary:
    "SubmitButton renders a type=\"submit\" button, and ContactForm gives it onClick={() => submit()} while also handling the " +
    "form's onSubmit with the same submit function. One click runs the onClick (no event, so nothing is prevented) and then the " +
    "browser's default action submits the form, which runs submit again. The sending guard does not help: both calls happen in " +
    "the same click, before React re-renders with sending = true, so both see false. The replay records a single click, the " +
    "browser sent two separate POSTs 3 ms apart, both before either response came back, and the server created one ticket per " +
    "request. Removing the onClick and relying on onSubmit (or making the button type=\"button\") fixes it.",
  observations: [
    { id: "single-click", why: "The customer clicked once", logs: [2] },
    { id: "two-posts-same-body", why: "The browser sent two identical POSTs a few milliseconds apart", requests: [2, 3] },
    { id: "one-ticket-per-request", why: "Each request created exactly one ticket", logs: [3, 4] },
    { id: "both-answered", why: "Both requests completed with 201", logs: [6, 8] },
  ],
  investigationHints: [
    "Count the clicks, the requests the browser sent and the tickets the server created. Where does the number first double?",
    "List everything that runs, in order, when someone clicks a submit button inside a form here.",
  ],
});
