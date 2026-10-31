/*
 * PROVISIONAL answer key for Challenge 001: Broken User Sessions.
 *
 * - Server-only: the "server-only" import makes any client import a build
 *   error, so this can never reach a browser bundle.
 * - Not imported anywhere yet. Validation and scoring belong to the
 *   Challenge Engine; replace or adapt this once the two are aligned.
 */
import "server-only";

export const provisionalAnswerKey = {
  challengeId: "challenge-001",
  status: "provisional",
  rootCause:
    "The login route issues the session cookie as a signed cookie (signed: true). " +
    "Because the app uses cookieParser(secret), signed cookies are parsed into " +
    "req.signedCookies and removed from req.cookies. The authenticate middleware " +
    "reads req.cookies.sid, which is always undefined, so every authenticated " +
    "request is rejected with 401 even though the session exists in the store.",
  evidence: [
    { path: "src/routes/auth.ts", detail: "res.cookie(..., { signed: true })" },
    { path: "src/middleware/authenticate.ts", detail: "reads req.cookies[cookieName]" },
    { path: "src/server.ts", detail: "app.use(cookieParser(config.cookieSecret))" },
    { path: "src/routes/auth.ts", detail: "logout reads req.signedCookies (works)" },
    { path: "logs/app.log", detail: "login 200 followed by 401 on every protected route" },
  ],
  // Stable IDs from logs.ts / network.ts that a learner can collect as evidence.
  keyEvidenceRefs: [
    { kind: "network", requestId: "req-01", why: "Set-Cookie issues sid in signed format (s:...)" },
    { kind: "network", requestId: "req-04", why: "Browser sends that sid cookie, still gets 401" },
    { kind: "log", logId: "log-06", why: "authenticate rejects the request despite a valid login" },
    { kind: "log", logId: "log-02", why: "Login succeeded for the same user moments earlier" },
  ],
  expectedFix:
    "Read the session ID from req.signedCookies[config.session.cookieName] in the " +
    "authenticate middleware.",
  plausibleRedHerrings: [
    "Session TTL or expiry logic in session-store.ts",
    "SameSite / Secure cookie attributes",
    "fetch credentials mode in public/dashboard.js",
  ],
} as const;
