/* Answer key for Challenge 005: Single Sign-On Loops Back. Server-only; registered in src/server/content. */
import "server-only";
import { challenge005 } from "@/data/challenge-005";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge005, {
  revision: "1",
  correctRootCauseId: "samesite-strict-state-cookie",
  resolutionSummary:
    "v2.14.0 made every cookie SameSite=Strict through the shared defaults in src/lib/cookies.ts, including the oauth_state " +
    "cookie set by /auth/sso/start. The identity provider sends the browser back to /auth/sso/callback with a top-level " +
    "navigation from idp.corp.example, which is a cross-site request (Sec-Fetch-Site: cross-site). Browsers only send Strict " +
    "cookies on same-site requests, so the callback arrives without oauth_state, the log records cookie=absent, and the state " +
    "check fails every time. The cookie's path (/auth) covers the callback, it lives for 10 minutes, and the identity provider " +
    "returned a code and the right state, so none of those is the problem. Password sign-in only uses same-site requests, so " +
    "its Strict session cookie works. Setting the state cookie to SameSite=Lax (sent on top-level GET navigations) fixes it.",
  observations: [
    { id: "state-cookie-strict", why: "The state cookie is set with SameSite=Strict", requests: [1, 3] },
    { id: "callback-without-cookie", why: "The callback is a cross-site navigation carrying the right state but no cookie", requests: [2, 4] },
    { id: "server-sees-no-cookie", why: "The server logs the state cookie as absent, not mismatched", logs: [4, 8] },
    { id: "same-site-strict-works", why: "A Strict cookie is sent fine on same-site navigation after password sign-in", requests: [6] },
  ],
  investigationHints: [
    "Compare the request headers of a callback with those of a request that carried its cookies. What is different about how each request was made?",
    "Read what the callback logs when it refuses, and work out every way that log line can be produced.",
  ],
});
