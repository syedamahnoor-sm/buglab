/* Answer key for Challenge 008: Charged Twice at Checkout. Server-only; registered in src/server/content. */
import "server-only";
import { challenge008 } from "@/data/challenge-008";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge008, {
  revision: "1",
  correctRootCauseId: "key-recorded-after-charge",
  resolutionSummary:
    "The checkout route looks the key up, charges the card, and only then saves the key with its response. The first request's " +
    "charge took 11.8 s, longer than the gateway's 10 s timeout, so the gateway answered 504 while the service kept working. " +
    "The app retried 1.2 s later with the same key, as designed, but the first request had not stored anything yet, so the " +
    "lookup missed again and a second charge was requested. Both charges succeeded and both requests stored the key (the " +
    "second insert was ignored by ON CONFLICT). The key was identical on both requests, the gateway does not retry (retries: 0, " +
    "and the second request starts after the 504), and the processor received two separate requests. Claiming the key before " +
    "charging (insert an in-progress record first, and answer 409 or wait while it is in progress) fixes it.",
  observations: [
    { id: "same-key-both-attempts", why: "Both requests carry the same Idempotency-Key", requests: [1, 2] },
    { id: "lookup-missed-twice", why: "The retry's lookup missed because nothing had been stored yet", logs: [3, 8] },
    { id: "first-request-still-running", why: "The gateway gave up at 10 s while the first charge was still in flight", logs: [5, 6] },
    { id: "two-charges", why: "Two charges were requested and both succeeded", logs: [4, 9, 10, 13] },
    { id: "stored-only-after", why: "The key is stored only after each charge succeeds", logs: [11, 14] },
  ],
  investigationHints: [
    "Put the two attempts on one timeline: when each started, when each looked up its key, and when each finished.",
    "For the idempotency key to protect a retry, something must exist when the retry arrives. Check when that happens in the route.",
  ],
});
