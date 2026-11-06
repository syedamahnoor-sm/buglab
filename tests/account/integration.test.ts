import assert from "node:assert/strict";
import { before, after, beforeEach, describe, test } from "node:test";
import { createAccountHandler } from "@/server/account/handler";
import { requirePermission } from "@/server/auth/guards";
import { readAccountSession } from "@/server/account/session";
import { isVerifiedAccount, verifyAccount } from "@/server/auth/verified-account";
import { createEmailVerificationToken } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { accountFixture, emailToken } from "./fixture";

describe("real PostgreSQL + Better Auth + BugLab HTTP boundary", { concurrency: false }, () => {
  let fixture: Awaited<ReturnType<typeof accountFixture>>;
  let handle: ReturnType<typeof createAccountHandler>;
  const origin = "http://localhost:3198";
  const password = "Only-a-generated-test-passphrase-73";
  let counter = 0;
  before(async () => { fixture = await accountFixture(origin); handle = createAccountHandler({ runtime: () => fixture.runtime }); });
  after(async () => { if (fixture) await fixture.close(); });
  beforeEach(async () => { await fixture.runtime.pool.query('DELETE FROM "buglab_auth_rate_limit"'); });
  const call = (path: string, method = "GET", body?: unknown, cookie?: string, headers?: Record<string, string>) => handle(new Request(`${origin}/api/account/${path}`, { method, headers: { origin, ...(method !== "GET" ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) }));
  const cookieFrom = (response: Response) => response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  async function register() {
    const email = `test-${++counter}@example.com`;
    const response = await call("sign-up", "POST", { email, password, displayName: "Ada", role: "admin" });
    assert.equal(response.status, 200, "registration accepted");
    return { email, token: emailToken(fixture.mail.at(-1)) };
  }
  async function signedIn() {
    const user = await register();
    assert.equal((await call("verify-email", "POST", { token: user.token })).status, 200);
    const response = await call("sign-in", "POST", { email: user.email, password });
    assert.equal(response.status, 200, "verified user can sign in");
    return { ...user, cookie: cookieFrom(response), response };
  }
  test("unconfigured accounts refuse all operations without touching storage", async () => {
    const disabled = createAccountHandler({ runtime: () => null });
    assert.equal((await disabled(new Request(`${origin}/api/account/session`))).status, 503);
  });
  test("registration hashes passwords, forces learner role and requires email verification", async () => {
    const user = await register();
    const stored = await fixture.runtime.pool.query('SELECT u."role", u."emailVerified", a."password" FROM "buglab_auth_user" u JOIN "buglab_auth_account" a ON a."userId" = u."id" WHERE u."email" = $1', [user.email]);
    assert.equal(stored.rows[0].role, "learner");
    assert.equal(stored.rows[0].emailVerified, false);
    assert.notEqual(stored.rows[0].password, password);
    assert.ok(stored.rows[0].password.length > 64);
    const login = await call("sign-in", "POST", { email: user.email, password });
    assert.equal(login.status, 403);
    assert.equal((await login.json()).code, "email-unverified");
  });
  test("verification, login, restoration and logout use real provider cookies", async () => {
    const user = await signedIn();
    const cookies = user.response.headers.getSetCookie().join(";");
    assert.match(cookies, /HttpOnly/i); assert.match(cookies, /SameSite=Lax/i);
    const body = await user.response.json();
    assert.equal(body.session.user.role, "learner"); assert.equal(body.session.user.emailVerified, true);
    assert.doesNotMatch(JSON.stringify(body), /"(?:password|token|sessionToken|accessToken|tokenHash)"\s*:/);
    const restored = await call("session", "GET", undefined, user.cookie);
    assert.equal((await restored.json()).session.user.email, user.email);
    assert.equal((await call("sign-out", "POST", {}, user.cookie)).status, 200);
    assert.equal((await (await call("session", "GET", undefined, user.cookie)).json()).session, null);
  });
  test("duplicate signup and recovery do not enumerate accounts", async () => {
    const user = await register();
    const duplicate = await call("sign-up", "POST", { email: user.email, password, displayName: null });
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { status: "verification-required" });
    const unknown = await call("password/forgot", "POST", { email: "missing@example.com" });
    const known = await call("password/forgot", "POST", { email: user.email });
    assert.equal(unknown.status, known.status); assert.deepEqual(await unknown.json(), await known.json());
  });
  test("password reset consumes the token and revokes existing sessions", async () => {
    const user = await signedIn();
    assert.equal((await call("password/forgot", "POST", { email: user.email })).status, 200);
    const token = emailToken(fixture.mail.at(-1));
    const newPassword = "New-test-passphrase-with-78-characters";
    assert.equal((await call("password/reset", "POST", { token, password: newPassword })).status, 200);
    assert.equal((await (await call("session", "GET", undefined, user.cookie)).json()).session, null);
    assert.notEqual((await call("password/reset", "POST", { token, password: newPassword })).status, 200);
    assert.notEqual((await call("sign-in", "POST", { email: user.email, password })).status, 200);
    assert.equal((await call("sign-in", "POST", { email: user.email, password: newPassword })).status, 200);
  });
  test("expired reset and verification tokens fail closed", async () => {
    const user = await register();
    assert.notEqual((await call("verify-email", "POST", { token: "invalid-token-value-1234" })).status, 200);
    const expired = await createEmailVerificationToken(fixture.runtime.settings.secret, user.email, undefined, -1);
    assert.notEqual((await call("verify-email", "POST", { token: expired })).status, 200);
    await call("password/forgot", "POST", { email: user.email });
    const token = emailToken(fixture.mail.at(-1));
    await fixture.runtime.pool.query('UPDATE "buglab_auth_verification" SET "expiresAt" = NOW() - INTERVAL \'1 hour\'');
    assert.notEqual((await call("password/reset", "POST", { token, password })).status, 200);
  });
  test("cross-origin, missing origin, prefetch and non-JSON writes are refused", async () => {
    const cases: Record<string, string>[] = [{ origin: "https://evil.example" }, { origin: "" }, { origin, purpose: "prefetch" }, { origin, "content-type": "text/plain" }];
    for (const headers of cases) {
      assert.ok([403, 415].includes((await call("sign-up", "POST", {}, undefined, headers)).status));
    }
  });
  test("oversized and malformed bodies are refused before provider processing", async () => {
    assert.equal((await call("sign-up", "POST", { email: "a".repeat(17000) })).status, 413);
    const response = await handle(new Request(`${origin}/api/account/sign-up`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{" }));
    assert.equal(response.status, 400);
  });
  test("unauthenticated profile/security operations and forged roles are refused", async () => {
    assert.equal((await call("profile", "PATCH", { displayName: "x", role: "admin" })).status, 401);
    const user = await signedIn();
    const changed = await call("profile", "PATCH", { displayName: "  Grace  ", role: "admin" }, user.cookie);
    assert.equal(changed.status, 200);
    const updatedUser = (await changed.json()).user;
    assert.equal(updatedUser.role, "learner"); assert.equal(updatedUser.displayName, "Grace");
    const provider = { name: "better-auth", configured: true, getSession: (request: Request) => readAccountSession(fixture.runtime, request.headers) };
    const result = await requirePermission(new Request(`${origin}/admin`, { headers: { cookie: user.cookie, "x-user-role": "admin" } }), "admin:access", provider);
    assert.ok(!result.ok && result.status === 403);
  });
  test("session listing never exposes session tokens; another account cannot revoke it", async () => {
    const first = await signedIn(); const second = await signedIn();
    const sessions = await (await call("sessions", "GET", undefined, first.cookie)).json();
    assert.ok(sessions.sessions.length > 0); assert.ok(!("token" in sessions.sessions[0]));
    assert.equal((await call(`sessions/${sessions.sessions[0].id}`, "DELETE", {}, second.cookie)).status, 403);
  });
  test("password change verifies the current password and revokes the other login", async () => {
    const user = await signedIn();
    const second = await call("sign-in", "POST", { email: user.email, password });
    assert.equal(second.status, 200);
    const otherCookie = cookieFrom(second);
    assert.notEqual((await call("password/change", "POST", { currentPassword: "wrong", newPassword: "New-valid-test-passphrase-492" }, user.cookie)).status, 200);
    const updated = await call("password/change", "POST", { currentPassword: password, newPassword: "New-valid-test-passphrase-492" }, user.cookie);
    assert.equal(updated.status, 200);
    assert.equal((await (await call("session", "GET", undefined, otherCookie)).json()).session, null);
    assert.equal((await call("sign-in", "POST", { email: user.email, password: "New-valid-test-passphrase-492" })).status, 200);
  });
  test("revoking other sessions preserves the caller; revoking one's own session ends it", async () => {
    const user = await signedIn();
    const second = await call("sign-in", "POST", { email: user.email, password });
    const otherCookie = cookieFrom(second);
    assert.equal((await call("sessions/revoke-others", "POST", {}, user.cookie)).status, 200);
    assert.equal((await (await call("session", "GET", undefined, otherCookie)).json()).session, null);
    const sessions = await (await call("sessions", "GET", undefined, user.cookie)).json();
    assert.equal(sessions.sessions.length, 1);
    assert.equal((await call(`sessions/${sessions.sessions[0].id}`, "DELETE", {}, user.cookie)).status, 200);
    assert.equal((await (await call("session", "GET", undefined, user.cookie)).json()).session, null);
  });
  test("VerifiedAccount comes from the live database session and cannot be forged or restored after logout", async () => {
    const user = await signedIn();
    const incoming = new Request(`${origin}/api/account/link`, { headers: { cookie: user.cookie, "x-user-role": "admin" } });
    const provider = { name: "better-auth", configured: true, getSession: (request: Request) => readAccountSession(fixture.runtime, request.headers) };
    const proof = await verifyAccount(incoming, provider);
    assert.ok(isVerifiedAccount(proof, incoming));
    assert.equal(proof.email, user.email); assert.equal(proof.role, "learner"); assert.equal(proof.emailVerified, true);
    assert.equal(isVerifiedAccount({ ...proof }, incoming), false);
    await call("sign-out", "POST", {}, user.cookie);
    assert.equal(await verifyAccount(incoming, provider), null);
  });
  test("provider schema plans are idempotent and never create learner tables", async () => {
    const plan = await getMigrations(fixture.runtime.auth.options);
    assert.equal(plan.toBeCreated.length, 0); assert.equal(plan.toBeAdded.length, 0); assert.equal(plan.toBeAddedIndexes.length, 0);
  });
  test("database expiry is authoritative even with an intact browser cookie", async () => {
    const user = await signedIn();
    await fixture.runtime.pool.query('UPDATE "buglab_auth_session" SET "expiresAt" = NOW() - INTERVAL \'1 minute\' WHERE "userId" = (SELECT "id" FROM "buglab_auth_user" WHERE "email" = $1)', [user.email]);
    assert.equal((await (await call("session", "GET", undefined, user.cookie)).json()).session, null);
    assert.equal((await call("profile", "PATCH", { displayName: "No" }, user.cookie)).status, 401);
  });
  test("linking stays unavailable without Habin's shared adapter", async () => {
    const user = await signedIn();
    assert.equal((await call("link", "POST", { consent: true, learnerId: "forged" }, user.cookie)).status, 503);
    const tables = await fixture.runtime.pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    assert.ok(tables.rows.every((item) => item.tablename.startsWith("buglab_auth_")), "no learner persistence is duplicated");
  });
  test("link boundary requires authenticated account and exact consent before invoking the shared adapter", async () => {
    const user = await signedIn(); let calls = 0;
    const boundary = createAccountHandler({ runtime: () => fixture.runtime, learner: {
      async status() { return { account: "unlinked", browserLearner: "present" }; },
      async link(request, account, consent) { calls++; assert.ok(isVerifiedAccount(account, request)); assert.equal(account.email, user.email); assert.equal(account.emailVerified, true); assert.equal(account.role, "learner"); assert.equal(consent, true); assert.equal(request.headers.get("cookie"), user.cookie); return { outcome: "no-browser-learner", clearAnonymousCookie: false }; },
    } });
    for (const consent of [false, "true", 1, null]) {
      const result = await boundary(new Request(`${origin}/api/account/link`, { method: "POST", headers: { origin, "content-type": "application/json", cookie: user.cookie }, body: JSON.stringify({ consent, learnerId: "untrusted" }) }));
      assert.equal((await result.json()).outcome, "consent-required");
    }
    assert.equal(calls, 0);
    const response = await boundary(new Request(`${origin}/api/account/link`, { method: "POST", headers: { origin, "content-type": "application/json", cookie: user.cookie }, body: JSON.stringify({ consent: true }) }));
    assert.equal((await response.json()).outcome, "no-browser-learner"); assert.equal(calls, 1);
  });
  test("failed login attempts are throttled through PostgreSQL, not client headers", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) statuses.push((await call("sign-in", "POST", { email: "nobody@example.com", password }, undefined, { "x-forwarded-for": `203.0.113.${attempt}` })).status);
    assert.ok(statuses.includes(429));
  });
});
