/*
 * Challenge 018: The Account With Nothing in It. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-18";

export const challenge018 = defineChallenge({
  number: "018",
  title: "The Account With Nothing in It",
  incident: "Some customers sign in and find an empty account, with none of their past orders.",
  difficulty: "beginner",
  tags: ["Constraints", "SQL", "Data integrity"],
  estimatedMinutes: 15,
  description:
    "A long-time customer created an account in the new mobile app and found no order history. Signing in again on the website sometimes shows everything, sometimes nothing.",
  category: "database",
  technologies: ["TypeScript", "Node.js", "PostgreSQL"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://www.cobaltbooks.example",
  files: {
    "INCIDENT.md": `# INC-018 · The Account With Nothing in It

**Opened:** ${DATE} 11:00 UTC
**Severity:** SEV-3
**Service:** cobalt-accounts v4.0.2

## Summary
Customer Ana Ruiz has ordered from us since 2024. This morning she created an
account in the new mobile app "because it asked me to". Since then, signing
in with her usual email sometimes shows her history and sometimes an empty
account.

## Notes
- Email addresses must be unique: users.email has a unique index
- Support looked her up in the admin tool (Network tab)
- No orders have been deleted; the orders table is append-only

## Your task
Explain why the same email address leads to different accounts.
`,
    "db/schema.sql": `CREATE TABLE users (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_key ON users (email);
`,
    "src/routes/signup.ts": `import { Router } from "express";
import { hash } from "../lib/passwords";
import { log } from "../lib/log";
import { users } from "../lib/users";

export const signup = Router();

signup.post("/api/signup", async (req, res) => {
  const email = String(req.body.email ?? "").trim();
  const password = String(req.body.password ?? "");
  if (!email.includes("@") || password.length < 10) return res.status(400).json({ error: "Check your email and password." });

  try {
    const user = await users.create(email, await hash(password));
    log.info("signup", \`Account created user=\${user.id} email=\${email}\`);
    res.status(201).json({ user: user.id });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ error: "An account with this email already exists." });
    throw error;
  }
});
`,
    "src/lib/users.ts": `import { randomUUID } from "node:crypto";
import { db } from "./db";

export interface User {
  id: string;
  email: string;
  password_hash: string;
}

export const users = {
  create: (email: string, passwordHash: string) =>
    db.one<User>("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING *", [\`u_\${randomUUID().slice(0, 8)}\`, email, passwordHash]),

  // People type their address in all sorts of ways, so sign-in ignores case.
  findForLogin: (email: string) =>
    db.oneOrNone<User>("SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1", [email.trim()]),

  findAllByEmail: (email: string) =>
    db.any<User>("SELECT id, email, created_at FROM users WHERE lower(email) = lower($1) ORDER BY created_at", [email.trim()]),
};
`,
    "src/routes/login.ts": `import { Router } from "express";
import { verify } from "../lib/passwords";
import { log } from "../lib/log";
import { startSession } from "../lib/sessions";
import { users } from "../lib/users";

export const login = Router();

login.post("/api/login", async (req, res) => {
  const user = await users.findForLogin(String(req.body.email ?? ""));
  if (!user || !(await verify(String(req.body.password ?? ""), user.password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  await startSession(res, user.id);
  log.info("auth", \`Signed in user=\${user.id}\`);
  res.json({ user: user.id });
});
`,
    "mobile/src/screens/SignUp.tsx": `import { useState } from "react";
import { Button, TextInput } from "react-native";
import { api } from "../api";

export function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <>
      <TextInput placeholder="Email" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Button title="Create account" onPress={() => api.signUp(email, password)} />
    </>
  );
}
`,
  },
  logs: [
    ["08:21:40.118", "INFO", "signup", "Account created user=u_7c21e0b4 email=ana.ruiz@example.com"],
    ["08:21:40.120", "INFO", "http", "POST /api/signup 201 212ms"],
    ["08:22:05.402", "INFO", "auth", "Signed in user=u_7c21e0b4"],
    ["08:22:05.403", "INFO", "http", "POST /api/login 200 188ms"],
    ["08:22:05.690", "INFO", "orders", "Order history user=u_7c21e0b4 orders=0"],
    ["08:22:05.691", "INFO", "http", "GET /api/orders 200 9ms"],
    ["09:40:11.880", "INFO", "auth", "Signed in user=u_1a90f3d2"],
    ["09:40:11.881", "INFO", "http", "POST /api/login 200 190ms"],
    ["09:40:12.103", "INFO", "orders", "Order history user=u_1a90f3d2 orders=37"],
    ["09:40:12.104", "INFO", "http", "GET /api/orders 200 14ms"],
    ["10:52:30.206", "INFO", "http", "GET /api/admin/users?email=ana.ruiz%40example.com 200 11ms"],
  ],
  network: [
    {
      log: 11,
      path: "/api/admin/users?email=ana.ruiz%40example.com",
      requestHeaders: { cookie: "admin_sid=0c5e" },
      response: JSON.stringify([
        { id: "u_1a90f3d2", email: "Ana.Ruiz@example.com", created_at: "2024-03-02T14:11:09Z", orders: 37 },
        { id: "u_7c21e0b4", email: "ana.ruiz@example.com", created_at: "2026-10-18T08:21:39Z", orders: 0 },
      ]),
    },
  ],
  options: [
    [
      "case-sensitive-unique-email",
      "The unique index treats the same address in different letter case as different emails",
      "Signup lets a second account in with a differently capitalised address, and sign-in, which ignores case, picks either account.",
    ],
    [
      "session-mixup",
      "Sessions are being mixed up between customers",
      "The session cookie is shared or reused, so the customer is shown someone else's account.",
    ],
    [
      "orders-moved",
      "A migration moved her orders to a different user id",
      "Her orders now belong to another id, so her account looks empty.",
    ],
    [
      "app-uses-other-backend",
      "The mobile app signs up against a separate accounts database",
      "The app's account lives in a different system, so it has none of the website's history.",
    ],
  ],
});
