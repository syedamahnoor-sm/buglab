/* Answer key for Challenge 030: The Deployment That Broke Monday. Server-only; registered in src/server/content. */
import "server-only";
import { challenge030 } from "@/data/challenge-030";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge030, {
  revision: "1",
  correctRootCauseId: "renamed-setting-not-in-prod",
  resolutionSummary:
    "v3.0.0 replaced REDIS_HOST and REDIS_PORT with a single REDIS_URL (CHANGELOG.md), and src/config.ts falls back to " +
    "redis://localhost:6379 when REDIS_URL is missing. The staging values file was updated to set REDIS_URL; the production " +
    "values file still sets only REDIS_HOST and REDIS_PORT. So every v3 pod in production logs \"Connecting to " +
    "redis://localhost:6379\", gets ECONNREFUSED 127.0.0.1:6379, and its /healthz reports redis down with 503, which fails the " +
    "readiness probe and pauses the rollout. The v2.9.4 pods reach cache.prod.internal fine, so Redis is healthy and reachable, " +
    "and the new pods never even try that host, so a network policy is not involved; the health check shows the database up. " +
    "Setting REDIS_URL in the production values (and failing fast at startup when a required setting is missing, instead of " +
    "defaulting to localhost) fixes it.",
  observations: [
    { id: "new-pods-use-localhost", why: "New pods connect to localhost instead of the cache host", logs: [3, 7] },
    { id: "connection-refused", why: "The connection is refused on 127.0.0.1", logs: [4, 8] },
    { id: "redis-reported-down", why: "The new pods' health check reports redis down and database up", logs: [12], requests: [2] },
    { id: "old-pods-healthy", why: "Old pods reach cache.prod.internal and are ready", logs: [1, 10], requests: [1] },
    { id: "probe-fails-rollout-stuck", why: "Readiness fails and the rollout pauses", logs: [6, 9, 11] },
  ],
  investigationHints: [
    "Compare where the old pods and the new pods try to connect, then find where each address comes from.",
    "Put the staging and production deployment settings side by side and check them against what v3.0.0 reads.",
  ],
});
