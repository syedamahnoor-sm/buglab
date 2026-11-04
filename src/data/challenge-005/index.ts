/*
 * Challenge 005: Single Sign-On Loops Back. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-29";
const IDP = "https://idp.corp.example";
const SIGN_IN_FAILED = '{"error":"Sign-in failed. Please try again."}';

const start = (state: string) => ({
  type: "document" as const,
  responseHeaders: {
    location: `${IDP}/oauth2/authorize?response_type=code&client_id=helpdesk&redirect_uri=https%3A%2F%2Fhelpdesk.corp.example%2Fauth%2Fsso%2Fcallback&scope=openid%20email&state=${state}`,
    "set-cookie": `oauth_state=${state}; Max-Age=600; Path=/auth; HttpOnly; Secure; SameSite=Strict`,
  },
});
const callback = (log: number, code: string, state: string) => ({
  log,
  type: "document" as const,
  path: `/auth/sso/callback?code=${code}&state=${state}`,
  requestHeaders: { referer: `${IDP}/`, "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" },
  response: SIGN_IN_FAILED,
});

export const challenge005 = defineChallenge({
  number: "005",
  title: "Single Sign-On Loops Back",
  incident: "Every company single sign-on attempt ends in \"Sign-in failed\", while password sign-in still works.",
  difficulty: "intermediate",
  tags: ["OAuth", "Cookies", "SameSite"],
  estimatedMinutes: 25,
  description:
    "Since this week's release, employees who choose \"Sign in with Corp SSO\" approve the sign-in at the identity provider and land back on an error page. Password sign-in is unaffected.",
  category: "authentication",
  technologies: ["TypeScript", "Node.js", "Express", "OAuth 2.0"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://helpdesk.corp.example",
  files: {
    "INCIDENT.md": `# INC-005 · Single Sign-On Loops Back

**Opened:** ${DATE} 08:50 UTC
**Severity:** SEV-2
**Service:** helpdesk-web v2.14.0 (released ${DATE} 07:55 UTC)

## Summary
"Sign in with Corp SSO" sends people to the identity provider, they
approve, and they come back to "Sign-in failed. Please try again." It
fails every time, in every browser we tried. Password sign-in works.

## What we know
- The identity provider's logs show the sign-ins as approved, and it
  redirected back to our registered callback URL
- Nothing changed at the identity provider this week
- v2.14.0 shipped this morning (see CHANGELOG.md)

## Evidence attached
- Server logs (Investigation Console, logs/app.log)
- A browser capture of two SSO attempts and a password sign-in.
  Requests to the identity provider itself are not included.

## Your task
Explain why the callback rejects sign-ins the identity provider approved.
`,
    "CHANGELOG.md": `# Changelog

## 2.14.0
- Ticket list loads 40% faster
- Cookies now use hardened defaults (SEC-212)
- Updated the help article links in the footer

## 2.13.2
- Fixed attachment previews for HEIC images
`,
    "package.json": `{
  "name": "helpdesk-web",
  "version": "2.14.0",
  "private": true,
  "dependencies": { "cookie-parser": "^1.4.7", "express": "^4.21.1", "openid-client": "^5.7.0" }
}
`,
    "src/routes/sso.ts": `import { randomBytes } from "node:crypto";
import { Router } from "express";
import { config } from "../config";
import { clearCookie, setCookie } from "../lib/cookies";
import { log } from "../lib/log";
import { startSession } from "../lib/sessions";
import { oidc } from "../lib/oidc";

export const sso = Router();

sso.get("/auth/sso/start", (req, res) => {
  const state = randomBytes(4).toString("hex");
  setCookie(res, "oauth_state", state, { maxAgeSeconds: 600, path: "/auth" });
  log.info("sso", \`SSO sign-in started state=\${state}\`);
  res.redirect(oidc.authorizationUrl({ redirect_uri: config.callbackUrl, scope: "openid email", state }));
});

sso.get("/auth/sso/callback", async (req, res) => {
  const expected = req.cookies.oauth_state as string | undefined;
  const received = String(req.query.state ?? "");
  if (!expected || expected !== received) {
    log.warn("sso", \`SSO callback rejected reason=state_mismatch cookie=\${expected ? "present" : "absent"}\`);
    return res.status(400).json({ error: "Sign-in failed. Please try again." });
  }
  clearCookie(res, "oauth_state", { path: "/auth" });

  const tokens = await oidc.callback(config.callbackUrl, { code: String(req.query.code), state: received }, { state: expected });
  const claims = tokens.claims();
  await startSession(res, String(claims.sub));
  log.info("sso", \`SSO sign-in succeeded user=\${claims.sub}\`);
  res.redirect("/home");
});
`,
    "src/lib/cookies.ts": `import type { Response } from "express";

export interface CookieOptions {
  maxAgeSeconds?: number;
  path?: string;
}

// Hardened defaults for every cookie the app sets (SEC-212).
const DEFAULTS = { httpOnly: true, secure: true, sameSite: "strict" } as const;

export function setCookie(res: Response, name: string, value: string, options: CookieOptions = {}) {
  res.cookie(name, value, {
    ...DEFAULTS,
    path: options.path ?? "/",
    ...(options.maxAgeSeconds ? { maxAge: options.maxAgeSeconds * 1000 } : {}),
  });
}

export function clearCookie(res: Response, name: string, options: CookieOptions = {}) {
  res.clearCookie(name, { ...DEFAULTS, path: options.path ?? "/" });
}
`,
    "src/routes/login.ts": `import { Router } from "express";
import { log } from "../lib/log";
import { startSession } from "../lib/sessions";
import { users } from "../lib/users";

export const login = Router();

login.post("/auth/login", async (req, res) => {
  const user = await users.verifyPassword(String(req.body.email), String(req.body.password));
  if (!user) return res.status(401).json({ error: "Email or password is incorrect." });
  await startSession(res, user.id);
  log.info("auth", \`Password sign-in succeeded user=\${user.id}\`);
  res.json({ redirect: "/home" });
});
`,
    "src/lib/sessions.ts": `import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { setCookie } from "./cookies";
import { redis } from "./redis";

export async function startSession(res: Response, userId: string) {
  const id = randomUUID();
  await redis.set(\`session:\${id}\`, userId, { EX: 8 * 60 * 60 });
  setCookie(res, "sid", id, { maxAgeSeconds: 8 * 60 * 60 });
}
`,
    "src/config.ts": `export const config = {
  issuer: "https://idp.corp.example",
  clientId: "helpdesk",
  callbackUrl: "https://helpdesk.corp.example/auth/sso/callback",
};
`,
  },
  logs: [
    ["07:55:41.101", "INFO", "http", "Server listening on :8443"],
    ["08:41:12.300", "INFO", "sso", "SSO sign-in started state=c41e9a07"],
    ["08:41:12.301", "INFO", "http", "GET /auth/sso/start 302 2ms"],
    ["08:41:19.874", "WARN", "sso", "SSO callback rejected reason=state_mismatch cookie=absent"],
    ["08:41:19.875", "INFO", "http", "GET /auth/sso/callback 400 3ms"],
    ["08:41:31.020", "INFO", "sso", "SSO sign-in started state=5b70d2e8"],
    ["08:41:31.021", "INFO", "http", "GET /auth/sso/start 302 1ms"],
    ["08:41:36.441", "WARN", "sso", "SSO callback rejected reason=state_mismatch cookie=absent"],
    ["08:41:36.442", "INFO", "http", "GET /auth/sso/callback 400 2ms"],
    ["08:43:05.552", "INFO", "auth", "Password sign-in succeeded user=u_7781"],
    ["08:43:05.553", "INFO", "http", "POST /auth/login 200 97ms"],
    ["08:43:05.910", "INFO", "http", "GET /home 200 12ms"],
  ],
  network: [
    { log: 3, ...start("c41e9a07") },
    callback(5, "Xk3Lq9wPz2", "c41e9a07"),
    { log: 7, ...start("5b70d2e8") },
    callback(9, "Rt7Vn1mHc8", "5b70d2e8"),
    {
      log: 11,
      body: '{"email":"dana.ortiz@corp.example","password":"[removed]"}',
      requestHeaders: { "sec-fetch-site": "same-origin" },
      responseHeaders: { "set-cookie": "sid=0b6c2f6e-91d4-4a7e-b3a5-5f0e2c8d7a19; Max-Age=28800; Path=/; HttpOnly; Secure; SameSite=Strict" },
      response: '{"redirect":"/home"}',
    },
    {
      log: 12,
      type: "document",
      requestHeaders: { cookie: "sid=0b6c2f6e-91d4-4a7e-b3a5-5f0e2c8d7a19", "sec-fetch-site": "same-origin" },
      response: "<!doctype html><title>Helpdesk</title>",
    },
  ],
  options: [
    [
      "state-cookie-expired",
      "The state cookie expires before the user returns",
      "The state cookie's lifetime is too short for the time people spend at the identity provider.",
    ],
    [
      "cookie-path-excludes-callback",
      "The state cookie's path does not cover the callback URL",
      "The cookie is scoped to a path that the callback route is outside of, so the browser keeps it to itself.",
    ],
    [
      "samesite-strict-state-cookie",
      "The state cookie is SameSite=Strict, so it is not sent on the return from the identity provider",
      "The redirect back from the identity provider is a navigation from another site, and Strict cookies are only sent on same-site requests.",
    ],
    [
      "redirect-uri-mismatch",
      "The callback URL registered with the identity provider no longer matches",
      "The identity provider refuses the sign-in because the redirect URI the app sends is not the registered one.",
    ],
    [
      "state-compared-wrongly",
      "The callback compares the state in a different format from the one it stored",
      "The stored state and the returned state are encoded differently, so a correct state never matches.",
    ],
  ],
});
