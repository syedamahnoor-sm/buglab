/*
 * Challenge 003: Password Reset Links Rejected. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-27";
// Fictional reset tokens: 24 random bytes, base64-encoded.
const FIRST_TOKEN = "q7Hc+Lw2V0x9/aR+3mPzT1uYk8bNfE5d";
const SECOND_TOKEN = "Zp4XuW9cR2tKaB7nH1sYv6QeLm0Dj3Gf";
const REJECTED = '{"error":"This reset link is invalid or has expired."}';

export const challenge003 = defineChallenge({
  number: "003",
  title: "Password Reset Links Rejected",
  incident: "Some password reset links fail with \"invalid or expired\" moments after the email arrives.",
  difficulty: "intermediate",
  tags: ["Authentication", "Tokens", "URL encoding"],
  estimatedMinutes: 25,
  description:
    "Roughly a third of password reset links are rejected as invalid within minutes of being sent, while requesting another link often works. Work out what separates the two.",
  category: "authentication",
  technologies: ["TypeScript", "Node.js", "Express", "PostgreSQL"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://account.northwind.example",
  files: {
    "INCIDENT.md": `# INC-003 · Password Reset Links Rejected

**Opened:** ${DATE} 09:20 UTC
**Severity:** SEV-3
**Service:** northwind-accounts v3.2.0

## Summary
Support has a growing queue of users who click the link in their
password reset email and immediately see "This reset link is invalid or
has expired". Asking for a second email usually fixes it, sometimes it
takes three.

## What we know
- Links are valid for 30 minutes and can be used once
- Failures happen within a minute or two of the email arriving
- No deploy since v3.2.0 two weeks ago; the reset flow was not changed in it
- The accounts database is a single PostgreSQL primary

## Evidence attached
- Server logs (Investigation Console, logs/app.log)
- A browser capture from user u_311, who reproduced it with support.
  Passwords were removed from the capture before it was shared.

## Your task
Explain why some links are rejected and others are not.
`,
    "package.json": `{
  "name": "northwind-accounts",
  "version": "3.2.0",
  "private": true,
  "dependencies": { "express": "^4.21.1", "pg-promise": "^11.10.1", "nodemailer": "^6.9.16" }
}
`,
    "src/routes/password-reset.ts": `import { Router } from "express";
import { log } from "../lib/log";
import { sendResetEmail } from "../lib/mailer";
import { issueToken, redeemToken } from "../lib/reset-tokens";
import { users } from "../lib/users";

export const passwordReset = Router();

passwordReset.post("/api/password-reset/request", async (req, res) => {
  const user = await users.findByEmail(String(req.body.email ?? ""));
  // Always 202, so the response does not reveal whether the account exists.
  if (user) {
    log.info("reset", \`Reset requested user=\${user.id}\`);
    const token = await issueToken(user.id);
    await sendResetEmail(user, token);
  }
  res.status(202).end();
});

passwordReset.post("/api/password-reset", async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password || password.length < 12) {
    return res.status(400).json({ error: "Choose a password of at least 12 characters." });
  }
  const result = await redeemToken(token);
  if (!result.ok) {
    log.warn("reset", \`Reset token rejected reason=\${result.reason}\`);
    return res.status(400).json({ error: "This reset link is invalid or has expired." });
  }
  await users.setPassword(result.userId, password);
  log.info("reset", \`Password changed user=\${result.userId}\`);
  res.json({ ok: true });
});
`,
    "src/lib/reset-tokens.ts": `import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

const TOKEN_TTL_MINUTES = 30;

/** Only the hash is stored, so a database leak does not leak usable links. */
export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export async function issueToken(userId: string): Promise<string> {
  const token = randomBytes(24).toString("base64");
  await db.none(
    "INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 minute')",
    [hashToken(token), userId, TOKEN_TTL_MINUTES],
  );
  return token;
}

type Redemption = { ok: true; userId: string } | { ok: false; reason: "not_found" | "expired" | "used" };

export async function redeemToken(token: string): Promise<Redemption> {
  const row = await db.oneOrNone<{ user_id: string; expired: boolean; used_at: Date | null }>(
    "SELECT user_id, expires_at < now() AS expired, used_at FROM reset_tokens WHERE token_hash = $1",
    [hashToken(token)],
  );
  if (!row) return { ok: false, reason: "not_found" };
  if (row.used_at) return { ok: false, reason: "used" };
  if (row.expired) return { ok: false, reason: "expired" };
  await db.none("UPDATE reset_tokens SET used_at = now() WHERE token_hash = $1", [hashToken(token)]);
  return { ok: true, userId: row.user_id };
}
`,
    "src/lib/mailer.ts": `import nodemailer from "nodemailer";
import { config } from "../config";
import { log } from "./log";
import type { User } from "./users";

const transport = nodemailer.createTransport(config.smtpUrl);

export async function sendResetEmail(user: User, token: string) {
  const link = \`\${config.appUrl}/reset?token=\${token}\`;
  await transport.sendMail({
    to: user.email,
    from: "Northwind Accounts <no-reply@northwind.example>",
    subject: "Reset your Northwind password",
    text: \`Hi \${user.name},\\n\\nUse this link within 30 minutes to choose a new password:\\n\\n\${link}\\n\`,
  });
  log.info("mail", \`Reset email queued user=\${user.id} template=password-reset\`);
}
`,
    "src/lib/db.ts": `import pgp from "pg-promise";
import { config } from "../config";

// One primary. Reads and writes use the same connection pool.
export const db = pgp()({ connectionString: config.databaseUrl, max: 10 });
`,
    "src/config.ts": `export const config = {
  appUrl: process.env.APP_URL ?? "https://account.northwind.example",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost/accounts",
  smtpUrl: process.env.SMTP_URL ?? "smtp://localhost:1025",
};
`,
    "public/reset.js": `// Reset page: reads the token from the link and posts it with the new password.
const form = document.querySelector("#reset-form");
const message = document.querySelector("#message");
const token = new URLSearchParams(location.search).get("token");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = form.elements.password.value;
  const response = await fetch("/api/password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  const body = await response.json();
  message.textContent = response.ok ? "Your password has been changed." : body.error;
});
`,
  },
  logs: [
    ["07:30:00.004", "INFO", "http", "Server listening on :3000"],
    ["09:02:11.410", "INFO", "reset", "Reset requested user=u_311"],
    ["09:02:11.452", "INFO", "mail", "Reset email queued user=u_311 template=password-reset"],
    ["09:02:11.455", "INFO", "http", "POST /api/password-reset/request 202 46ms"],
    ["09:03:37.118", "INFO", "http", "GET /reset 200 3ms"],
    ["09:03:58.902", "WARN", "reset", "Reset token rejected reason=not_found"],
    ["09:03:58.903", "INFO", "http", "POST /api/password-reset 400 9ms"],
    ["09:04:22.660", "WARN", "reset", "Reset token rejected reason=not_found"],
    ["09:04:22.661", "INFO", "http", "POST /api/password-reset 400 7ms"],
    ["09:06:15.004", "INFO", "reset", "Reset requested user=u_311"],
    ["09:06:15.049", "INFO", "mail", "Reset email queued user=u_311 template=password-reset"],
    ["09:06:15.051", "INFO", "http", "POST /api/password-reset/request 202 48ms"],
    ["09:07:01.230", "INFO", "http", "GET /reset 200 2ms"],
    ["09:07:19.815", "INFO", "reset", "Password changed user=u_311"],
    ["09:07:19.816", "INFO", "http", "POST /api/password-reset 200 88ms"],
    ["09:11:40.371", "INFO", "reset", "Reset requested user=u_478"],
    ["09:11:40.415", "INFO", "mail", "Reset email queued user=u_478 template=password-reset"],
    ["09:11:40.417", "INFO", "http", "POST /api/password-reset/request 202 45ms"],
    ["09:12:05.926", "INFO", "http", "GET /reset 200 2ms"],
    ["09:12:31.540", "WARN", "reset", "Reset token rejected reason=not_found"],
    ["09:12:31.541", "INFO", "http", "POST /api/password-reset 400 8ms"],
  ],
  network: [
    { log: 5, type: "document", path: `/reset?token=${FIRST_TOKEN}`, response: "<!doctype html><title>Choose a new password</title>" },
    {
      log: 7,
      initiator: "public/reset.js",
      body: JSON.stringify({ token: FIRST_TOKEN.replaceAll("+", " "), password: "[removed]" }),
      response: REJECTED,
    },
    {
      log: 9,
      initiator: "public/reset.js",
      body: JSON.stringify({ token: FIRST_TOKEN.replaceAll("+", " "), password: "[removed]" }),
      response: REJECTED,
    },
    { log: 13, type: "document", path: `/reset?token=${SECOND_TOKEN}`, response: "<!doctype html><title>Choose a new password</title>" },
    {
      log: 15,
      initiator: "public/reset.js",
      body: JSON.stringify({ token: SECOND_TOKEN, password: "[removed]" }),
      response: '{"ok":true}',
    },
  ],
  options: [
    [
      "replica-lag",
      "The token is read before the database has stored it",
      "The reset row is written to one database node and looked up on another that has not caught up yet.",
    ],
    [
      "token-expires-early",
      "Tokens expire long before the 30 minutes they should last",
      "The expiry is calculated in the wrong unit or time zone, so links are already expired when they are used.",
    ],
    [
      "token-not-url-encoded",
      "The token is put into the link without URL encoding",
      "Characters in the token have a special meaning in a query string, so the token the page reads is not the one that was issued.",
    ],
    [
      "hash-mismatch",
      "Issuing and redeeming hash the token differently",
      "The token is hashed one way when it is stored and another way when it is looked up, so some lookups miss.",
    ],
    [
      "link-prefetched",
      "Email link scanners use up the token before the user clicks",
      "A mail security scanner opens the link first, which redeems the single-use token.",
    ],
  ],
});
