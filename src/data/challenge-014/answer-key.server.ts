/* Answer key for Challenge 014: Autosave Saves Nothing. Server-only; registered in src/server/content. */
import "server-only";
import { challenge014 } from "@/data/challenge-014";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge014, {
  revision: "1",
  correctRootCauseId: "stale-closure-in-interval",
  resolutionSummary:
    "The autosave interval is created once (its effect depends only on docId), so its callback closes over the draft value from " +
    "the first render, \"Retro notes\". Typing updates state and re-renders, but the timer's function never changes, so every " +
    "autosave posts the original 11 characters, and the server faithfully stores them (chars=11, versions 42 to 44) while the " +
    "replay shows the text growing to 116 characters. The status still says \"Saved\" because the request succeeds. The Save " +
    "button's handler is recreated on every render and sends the current text (chars=116), and the server returns what it last " +
    "stored on reload, so the server, other tabs and local copies are not involved. Reading the latest draft through a ref " +
    "(or restarting the timer when the draft changes, with a debounce) fixes it.",
  observations: [
    { id: "autosave-sends-original", why: "Every autosave request body is the original text", requests: [2, 3, 4] },
    { id: "server-stores-what-it-gets", why: "The server stores exactly the 11 characters it receives", logs: [4, 7, 10] },
    { id: "text-was-growing", why: "Meanwhile the text on screen was growing", logs: [3, 6, 9] },
    { id: "manual-save-works", why: "The Save button sends and stores the current text", logs: [18], requests: [6] },
    { id: "reload-gets-last-saved", why: "The reload returns what autosave last stored", requests: [5] },
  ],
  investigationHints: [
    "Compare what was on screen at each autosave with what the request carried.",
    "The Save button and the timer call the same function. Look at when each of their callbacks was created.",
  ],
});
