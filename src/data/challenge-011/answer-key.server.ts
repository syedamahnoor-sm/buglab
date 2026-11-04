/* Answer key for Challenge 011: The Checkbox That Moves. Server-only; registered in src/server/content. */
import "server-only";
import { challenge011 } from "@/data/challenge-011";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge011, {
  revision: "1",
  correctRootCauseId: "index-keys-reuse-row-state",
  resolutionSummary:
    "TaskList renders rows with key={index}, and TaskRow keeps the tick in local state initialised once from task.done. After " +
    "\"Pay electricity bill\" (index 0, ticked) is deleted, \"Book dentist\" moves to index 0. React sees the same key, keeps the " +
    "existing TaskRow component with its state (done = true) and only passes it new props, so \"Book dentist\" renders ticked. " +
    "The server is right throughout: the toggle and delete requests target t_101, and the list after a reload has Book dentist " +
    "not done. The filter removes the right task (the titles are correct), and no request finishes after the delete to " +
    "overwrite anything. Using key={task.id} (and ideally deriving the tick from the task rather than copying it into state) " +
    "fixes it.",
  observations: [
    { id: "tick-moves-after-delete", why: "Right after the delete, the next task renders ticked", logs: [7] },
    { id: "requests-target-right-task", why: "Toggle and delete were sent for t_101 only", logs: [4, 6], requests: [2, 3] },
    { id: "server-state-correct", why: "The server's list has Book dentist not done", logs: [11], requests: [4] },
    { id: "user-ticked-first-task", why: "The user only ticked the first task", logs: [3] },
  ],
  investigationHints: [
    "Compare what the server says about each task with what the screen shows, before and after the delete.",
    "Ask how React decides which component instance renders which task when the list gets shorter.",
  ],
});
