/* Answer key for Challenge 024: The Redirect That Went Somewhere Else. Server-only; registered in src/server/content. */
import "server-only";
import { challenge024 } from "@/data/challenge-024";
import { defineAnswerKey } from "@/server/content/define-answer-key";

export const answerKey = defineAnswerKey(challenge024, {
  revision: "1",
  correctRootCauseId: "sso-path-skips-validation",
  resolutionSummary:
    "safeReturnTo is correct and tested: it keeps paths on the portal and URLs on the two allowed hosts, and falls back to " +
    "/dashboard for anything else. Password sign-in uses it, which is why the same wiki link with the vendor URL ends at " +
    "/dashboard. The SSO flow never calls it: /auth/sso/start saves req.query.returnTo as-is into the state, and the callback " +
    "redirects to saved.returnTo. So the portal itself answers the callback with Location: https://status.vendorcloud.example/ " +
    "(the identity provider only returned a code and state). The allow-list in config.ts does not contain the vendor, and the " +
    "unit tests only cover the validator, not the routes that should use it. Passing returnTo through safeReturnTo before " +
    "saving it (and again before redirecting), plus a route-level test for the SSO flow, fixes it.",
  observations: [
    { id: "callback-redirects-to-vendor", why: "The portal's own callback response points at the vendor host", logs: [6], requests: [3] },
    { id: "password-path-falls-back", why: "The same returnTo through password sign-in falls back to /dashboard", logs: [2], requests: [1] },
    { id: "start-takes-raw-value", why: "The SSO start request carries the vendor URL", requests: [2] },
    { id: "validator-tests-pass", why: "The validator's own tests pass", logs: [1] },
    { id: "normal-sso-works", why: "A path returnTo works normally through SSO", logs: [10], requests: [5] },
  ],
  investigationHints: [
    "Find every place the portal decides where to send someone after sign-in, and check which of them uses the shared check.",
    "Compare the response the portal itself sends at the end of each sign-in flow.",
  ],
});
