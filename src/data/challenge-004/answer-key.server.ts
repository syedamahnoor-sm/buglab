/* Answer key for Challenge 004: Signed Out by Some Servers. Server-only; registered in src/server/content. */
import "server-only";
import { challenge004 } from "@/data/challenge-004";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge004, {
  revision: "1",
  correctRootCauseId: "stale-key-cache",
  resolutionSummary:
    "Each pod caches the identity service's key set for 24 hours (config.jwksCacheTtlMs) and signingKey() throws unknown_kid " +
    "when a token's kid is not in that cache, without fetching the key set again. api-6d9f-x2k and api-6d9f-r7m loaded the " +
    "keys at 06:12, when only 2026-10-b existed. At 14:00 the signing key rotated to 2026-11-a; api-7c41-p9q started at 14:20 " +
    "and loaded both keys. Tokens issued after the rotation carry kid 2026-11-a (visible in the token header in the capture), " +
    "so the two older pods reject them with reason=unknown_kid and the newer pod accepts them. With round-robin load balancing " +
    "the same user sees random 401s. Morning tokens still carry 2026-10-b, which every pod knows, so older sessions work. " +
    "Refetching the key set (rate-limited) when an unknown kid arrives fixes it.",
  observations: [
    { id: "old-pods-have-old-keys", why: "The pods started at 06:12 only loaded key 2026-10-b", logs: [2, 4] },
    { id: "new-pod-has-new-key", why: "The pod started after the rotation loaded both keys", logs: [7] },
    { id: "rejected-unknown-kid", why: "Rejections are unknown_kid for 2026-11-a, only on the older pods", logs: [11, 13], requests: [2, 3] },
    { id: "same-token-accepted-elsewhere", why: "The same token is accepted by api-7c41-p9q", logs: [9, 15], requests: [1, 4] },
    { id: "old-tokens-fine", why: "Tokens signed with 2026-10-b still verify on the older pods", logs: [17, 19] },
  ],
  investigationHints: [
    "Group the requests by the pod that served them. What do the pods that refuse have in common, and when did each of them start?",
    "Read exactly what the rejection reason means in the verification code, and when that code would look again at the identity service.",
  ],
});
