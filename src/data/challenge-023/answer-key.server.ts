/* Answer key for Challenge 023: The Permission That Never Updated. Server-only; registered in src/server/content. */
import "server-only";
import { challenge023 } from "@/data/challenge-023";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge023, {
  revision: "1",
  correctRootCauseId: "client-permissions-never-refreshed",
  resolutionSummary:
    "Authorization worked throughout: requirePermission reads the current role from the database on every request, and from " +
    "10:15 every admin action by u_510 was refused with 403 and logged as role=viewer. The screen was wrong because " +
    "PermissionsProvider fetched /api/me/permissions once at 10:02, kept the admin permissions in a module-level cache, and its " +
    "effect only fetches when nothing is cached, so nothing ever asked again. ProjectActions decides which buttons to show " +
    "from that stale copy, and when the server refused, the app only showed a generic toast instead of refreshing its " +
    "permissions. The capture has no permissions request between 10:02 and the reload, and the reload's request returned viewer " +
    "with Cache-Control: no-store, so no HTTP cache was involved. Refetching permissions on a 403, on window focus or on a " +
    "short interval (and replacing the cached copy when they change) fixes the display. The server's checks need no change.",
  observations: [
    { id: "server-refuses-viewer", why: "Every admin action after the change was refused, with the new role", logs: [4, 6, 8], requests: [2, 3, 4] },
    { id: "role-changed-at-1015", why: "The role change was saved at 10:15", logs: [2, 3] },
    { id: "permissions-loaded-once", why: "Permissions were loaded once, as admin, before the change", logs: [1], requests: [1] },
    { id: "reload-gets-viewer", why: "After reloading, the app finally asks again and receives viewer", logs: [11], requests: [5] },
  ],
  investigationHints: [
    "Decide first what the server allowed after 10:15, then separately what the screen showed. Which one was wrong?",
    "Find where the app gets the permissions it uses to choose which buttons to show, and when it asks for them.",
  ],
});
