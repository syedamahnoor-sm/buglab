/* Answer key for Challenge 003: Password Reset Links Rejected. Server-only; registered in src/server/content. */
import "server-only";
import { challenge003 } from "@/data/challenge-003";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge003, {
  revision: "1",
  correctRootCauseId: "token-not-url-encoded",
  resolutionSummary:
    "Tokens are 24 random bytes encoded as standard base64, which can contain \"+\", \"/\" and \"=\". src/lib/mailer.ts puts " +
    "the token into the link as-is, without encodeURIComponent. In a query string \"+\" means a space, so when public/reset.js " +
    "reads it with URLSearchParams, every \"+\" becomes a space. The page then posts a token that differs from the one issued, " +
    "its SHA-256 does not match any stored hash, and redeemToken reports not_found. The capture shows it: the first link " +
    "contains \"+\" and the posted token has spaces in the same places, while the second token has no \"+\" and works. Tokens " +
    "without a \"+\" are unaffected, which is why a new email often helps. Encoding the token in the link (or issuing " +
    "base64url tokens) fixes it.",
  observations: [
    { id: "link-contains-plus", why: "The failing link's token contains '+' characters", requests: [1] },
    { id: "posted-token-has-spaces", why: "The token posted by the page has spaces where the link had '+'", requests: [2, 3] },
    { id: "lookup-not-found", why: "The server finds no token for that hash, rather than an expired or used one", logs: [6, 8, 20] },
    { id: "token-without-plus-works", why: "A token with no '+' is accepted for the same user moments later", logs: [14], requests: [5] },
  ],
  investigationHints: [
    "Compare a link that worked with one that failed, and follow each token from the email to the request body the server receives.",
    "Note the reason the server gives when it rejects a token, and which of its checks could produce that reason.",
  ],
});
