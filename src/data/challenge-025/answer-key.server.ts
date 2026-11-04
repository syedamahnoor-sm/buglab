/* Answer key for Challenge 025: The Missing Audit Trail. Server-only; registered in src/server/content. */
import "server-only";
import { challenge025 } from "@/data/challenge-025";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge025, {
  revision: "1",
  correctRootCauseId: "worker-drops-failed-inserts",
  resolutionSummary:
    "Migration 0047 renamed audit_events.target_user to target_id, but the audit worker's INSERT still names target_user, so " +
    "since 09:30 every insert has failed with \"column target_user does not exist\". The worker catches the error, logs a WARN " +
    "and then acknowledges the message in its finally block, so the event is removed from the queue and lost. The role change " +
    "published its event normally (event e3a94c27), and monitoring confirms 1,842 events consumed and acknowledged with no " +
    "backlog, while audit_events gained no rows. The only alert watches queue depth, which stays at 0 because failures are " +
    "acknowledged, so nothing paged. The audit view is right to return nothing, since nothing was stored. Updating the worker " +
    "for the new column, only acknowledging after a successful insert (with retries and a dead-letter queue), and alerting on " +
    "failed or missing audit writes fixes it. The lost events need to be rebuilt from the application logs.",
  observations: [
    { id: "event-published", why: "The role change published its audit event", logs: [6, 7] },
    { id: "insert-fails-renamed-column", why: "The worker's insert fails on the renamed column", logs: [9, 5] },
    { id: "migration-renamed-column", why: "The migration that renamed the column ran just before", logs: [2] },
    { id: "acked-but-not-stored", why: "Every event was consumed and acknowledged, yet no rows were stored", logs: [10, 11] },
    { id: "audit-view-empty", why: "The audit view finds nothing for the user", requests: [2] },
    { id: "change-succeeded", why: "The console reported the role change as successful", logs: [8], requests: [1] },
  ],
  investigationHints: [
    "Follow the audit event from the moment it is published to the row that should exist. Where is the last sign of it?",
    "Ask what the worker does with a message it could not store, and what the alerting would notice.",
  ],
});
