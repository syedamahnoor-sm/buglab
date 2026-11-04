/*
 * Challenge 024: The Redirect That Went Somewhere Else. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-07";
const VENDOR = "https://status.vendorcloud.example/";

export const challenge024 = defineChallenge({
  number: "024",
  title: "The Redirect That Went Somewhere Else",
  incident: "After signing in with SSO, some staff land on a third-party status page instead of the portal.",
  difficulty: "intermediate",
  tags: ["Redirects", "Validation", "SSO"],
  estimatedMinutes: 25,
  description:
    "The portal is meant to send people back to the page they started from, and only ever to its own pages. Staff who use SSO from one particular link end up on another company's website.",
  category: "security",
  technologies: ["TypeScript", "Node.js", "Express"],
  publishedAt: "2026-11-05",
  incidentDate: DATE,
  origin: "https://portal.brackenridge.example",
  files: {
    "INCIDENT.md": `# INC-024 · The Redirect That Went Somewhere Else

**Opened:** ${DATE} 11:30 UTC
**Severity:** SEV-3
**Service:** brackenridge-portal v6.3.0

## Summary
Staff who sign in from the "Portal sign-in" link on an internal wiki page
are sent to a vendor's public status page after SSO, instead of back into
the portal. The wiki link was edited by mistake last week and now carries
returnTo=${VENDOR} (it has been corrected).

The portal must only ever redirect to its own pages, whatever the link says.

## What we know
- Password sign-in from the same wiki link stays inside the portal
- The redirect unit tests pass (logs/ci.log)
- The allow-list of hosts is in src/config.ts
- Request logs are sanitised: they record redirect hosts, not full URLs

## Your task
Explain why SSO sign-in follows a redirect the portal should refuse.
`,
    "src/config.ts": `export const config = {
  publicOrigin: "https://portal.brackenridge.example",
  // Hosts the portal may send people to after sign-in. Its own pages are always allowed.
  allowedRedirectHosts: ["portal.brackenridge.example", "docs.brackenridge.example"],
  defaultAfterSignIn: "/dashboard",
};
`,
    "src/auth/redirects.ts": `import { config } from "../config";

/**
 * Where to send someone after sign-in. Accepts a path on this site or a URL on an
 * allowed host; anything else falls back to the default page.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value === "") return config.defaultAfterSignIn;
  let url: URL;
  try {
    url = new URL(value, config.publicOrigin);
  } catch {
    return config.defaultAfterSignIn;
  }
  if (url.protocol !== "https:" || !config.allowedRedirectHosts.includes(url.hostname)) {
    return config.defaultAfterSignIn;
  }
  return url.origin === config.publicOrigin ? url.pathname + url.search : url.toString();
}
`,
    "src/routes/login.ts": `import { Router } from "express";
import { safeReturnTo } from "../auth/redirects";
import { startSession } from "../auth/sessions";
import { log } from "../log";
import { users } from "../users";

export const login = Router();

login.post("/api/login", async (req, res) => {
  const user = await users.verifyPassword(String(req.body.email ?? ""), String(req.body.password ?? ""));
  if (!user) return res.status(401).json({ error: "Email or password is incorrect." });
  await startSession(res, user.id);
  const target = safeReturnTo(req.body.returnTo);
  log.info("auth", \`Password sign-in user=\${user.id} redirect=\${describe(target)}\`);
  res.json({ redirect: target });
});

function describe(target: string) {
  return target.startsWith("/") ? \`path:\${target.split("?")[0]}\` : \`host:\${new URL(target).hostname}\`;
}
`,
    "src/routes/sso.ts": `import { randomBytes } from "node:crypto";
import { Router } from "express";
import { startSession } from "../auth/sessions";
import { ssoStates } from "../auth/sso-states";
import { log } from "../log";
import { idp } from "../idp";

export const sso = Router();

sso.get("/auth/sso/start", async (req, res) => {
  const state = randomBytes(16).toString("hex");
  // Remember where the person was going, so the callback can take them back there.
  await ssoStates.save(state, { returnTo: String(req.query.returnTo ?? "/dashboard") });
  log.info("sso", "SSO sign-in started");
  res.redirect(idp.authorizeUrl(state));
});

sso.get("/auth/sso/callback", async (req, res) => {
  const saved = await ssoStates.take(String(req.query.state ?? ""));
  if (!saved) return res.status(400).send("Sign-in expired. Please try again.");
  const user = await idp.exchange(String(req.query.code ?? ""));
  await startSession(res, user.id);
  const target = saved.returnTo;
  log.info("sso", \`SSO sign-in user=\${user.id} redirect=\${target.startsWith("/") ? "path" : \`host:\${new URL(target).hostname}\`}\`);
  res.redirect(target);
});
`,
    "tests/redirects.test.ts": `import assert from "node:assert/strict";
import { test } from "node:test";
import { safeReturnTo } from "../src/auth/redirects";

test("keeps paths on this site", () => assert.equal(safeReturnTo("/reports?week=41"), "/reports?week=41"));
test("keeps allowed hosts", () => assert.equal(safeReturnTo("https://docs.brackenridge.example/a"), "https://docs.brackenridge.example/a"));
test("falls back for other hosts", () => assert.equal(safeReturnTo("https://elsewhere.example/"), "/dashboard"));
test("falls back for plain http", () => assert.equal(safeReturnTo("http://portal.brackenridge.example/"), "/dashboard"));
test("falls back for empty and missing values", () => {
  assert.equal(safeReturnTo(""), "/dashboard");
  assert.equal(safeReturnTo(undefined), "/dashboard");
});
`,
  },
  logs: [
    ["06:40:12.004", "INFO", "ci", "tests/redirects.test.ts: 5 passed, 0 failed"],
    ["11:02:30.118", "INFO", "auth", "Password sign-in user=u_41 redirect=path:/dashboard"],
    ["11:02:30.120", "INFO", "http", "POST /api/login 200 141ms"],
    ["11:05:44.902", "INFO", "sso", "SSO sign-in started"],
    ["11:05:44.904", "INFO", "http", "GET /auth/sso/start 302 3ms"],
    ["11:05:51.377", "INFO", "sso", "SSO sign-in user=u_77 redirect=host:status.vendorcloud.example"],
    ["11:05:51.379", "INFO", "http", "GET /auth/sso/callback 302 88ms"],
    ["11:09:03.511", "INFO", "sso", "SSO sign-in started"],
    ["11:09:03.513", "INFO", "http", "GET /auth/sso/start 302 2ms"],
    ["11:09:10.020", "INFO", "sso", "SSO sign-in user=u_93 redirect=path"],
    ["11:09:10.022", "INFO", "http", "GET /auth/sso/callback 302 81ms"],
  ],
  logFile: "logs/app.log",
  network: [
    {
      log: 3,
      body: `{"email":"lee.morgan@brackenridge.example","password":"[removed]","returnTo":"${VENDOR}"}`,
      response: '{"redirect":"/dashboard"}',
    },
    {
      log: 5,
      type: "document",
      path: `/auth/sso/start?returnTo=${encodeURIComponent(VENDOR)}`,
      responseHeaders: { location: "https://idp.brackenridge.example/authorize?client_id=portal&state=[removed]" },
    },
    {
      log: 7,
      type: "document",
      path: "/auth/sso/callback?code=[removed]&state=[removed]",
      responseHeaders: { location: VENDOR },
    },
    {
      log: 9,
      type: "document",
      path: "/auth/sso/start?returnTo=%2Freports",
      responseHeaders: { location: "https://idp.brackenridge.example/authorize?client_id=portal&state=[removed]" },
    },
    {
      log: 11,
      type: "document",
      path: "/auth/sso/callback?code=[removed]&state=[removed]",
      responseHeaders: { location: "/reports" },
    },
  ],
  options: [
    [
      "allow-list-includes-vendor",
      "The vendor's host is on the redirect allow-list",
      "Someone added the vendor's domain to the allowed hosts, so the portal treats it as safe.",
    ],
    [
      "validator-logic-wrong",
      "safeReturnTo accepts hosts it should reject",
      "The validation function has a flaw that lets some outside URLs through.",
    ],
    [
      "sso-path-skips-validation",
      "The SSO flow stores and follows returnTo without passing it through the redirect check",
      "Only password sign-in uses safeReturnTo; the SSO start and callback trust whatever the link supplied.",
    ],
    [
      "idp-sets-destination",
      "The identity provider sends people to the vendor page itself",
      "The identity provider is configured with the wrong return address and redirects there after sign-in.",
    ],
  ],
});
