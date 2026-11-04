/* Answer key for Challenge 028: The Cache That Lied. Server-only; registered in src/server/content. */
import "server-only";
import { challenge028 } from "@/data/challenge-028";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge028, {
  revision: "1",
  correctRootCauseId: "invalidates-wrong-key",
  resolutionSummary:
    "The product page caches responses under product:<slug> (product:linen-shirt), but the admin save calls " +
    "invalidate(`product:${updated.id}`), which deletes product:p_311, a key nothing ever writes. The log shows the wrong key " +
    "being invalidated, and every page view afterwards is still a cache hit on product:linen-shirt, which keeps 49.00 until its " +
    "24-hour TTL runs out (2,398 s left at 08:54). The database has 39.00 and the admin response shows it, so the save worked, " +
    "and the API sends Cache-Control: no-store with no CDN in front, so no outside cache is involved. The TTL only decides how " +
    "long the stale entry lives; with correct invalidation it would not matter. Using one key scheme for reads and " +
    "invalidation (for example caching by id, or deleting both keys on save) fixes it.",
  observations: [
    { id: "wrong-key-invalidated", why: "The save invalidates product:p_311", logs: [2] },
    { id: "slug-key-still-hit", why: "Page views keep hitting product:linen-shirt after the save", logs: [4, 6] },
    { id: "stale-price-served", why: "The shop API still returns 49.00 with no-store", requests: [2, 3] },
    { id: "database-updated", why: "The database and the admin response have 39.00", logs: [8], requests: [1] },
    { id: "keys-in-redis", why: "The slug key still has its TTL and the id key does not exist", logs: [9] },
  ],
  investigationHints: [
    "Compare the exact cache key the save clears with the exact key the product page reads.",
    "Check each layer in turn: database, application cache, HTTP caching. Which one still holds the old price?",
  ],
});
