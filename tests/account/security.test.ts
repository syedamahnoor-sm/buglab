import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readAccountSettings, type AccountSettings } from "@/server/account/settings";
import { providerHeaders } from "@/server/account/provider-headers";
import { safeReturnPath, takeFragmentToken } from "@/lib/account/routes";
import { parseAccountSession } from "@/lib/account/contract";
import { createHttpAccountApi, disconnectedAccountApi } from "@/lib/account/api";
import { checkNewPassword } from "@/lib/account/validation";
import { createEmailDelivery } from "@/server/account/email";
import { requireUser } from "@/server/auth/guards";

describe("account activation and security boundaries", () => {
  const configured: NodeJS.ProcessEnv = { NODE_ENV: "development", BUGLAB_AUTH_PROVIDER: "better-auth", BUGLAB_ACCOUNTS_ENABLED: "enabled", DATABASE_URL: "postgresql://fixture.invalid/test", BETTER_AUTH_SECRET: "unit-test-only-secret-with-at-least-32-characters", BUGLAB_APP_ORIGIN: "http://localhost:3000", BUGLAB_EMAIL_MODE: "capture" };
  test("every required setting is needed; no implicit memory or dev authentication", () => {
    assert.equal(readAccountSettings({ NODE_ENV: "test" }), null);
    assert.ok(readAccountSettings(configured));
    for (const name of ["BUGLAB_ACCOUNTS_ENABLED", "BUGLAB_AUTH_PROVIDER", "DATABASE_URL", "BETTER_AUTH_SECRET", "BUGLAB_APP_ORIGIN", "BUGLAB_EMAIL_MODE"]) assert.equal(readAccountSettings({ ...configured, [name]: undefined }), null, name);
  });
  test("production requires explicit verification, HTTPS and SMTP; capture never enables it", () => {
    assert.equal(readAccountSettings({ ...configured, NODE_ENV: "production" }), null);
    assert.throws(() => readAccountSettings({ ...configured, NODE_ENV: "production", BUGLAB_AUTH_PRODUCTION_VERIFIED: "enabled" }), /HTTPS/);
    assert.equal(readAccountSettings({ ...configured, NODE_ENV: "production", BUGLAB_APP_ORIGIN: "https://buglab.example", BUGLAB_AUTH_PRODUCTION_VERIFIED: "enabled" }), null);
    const production = readAccountSettings({ ...configured, NODE_ENV: "production", BUGLAB_APP_ORIGIN: "https://buglab.example", BUGLAB_AUTH_PRODUCTION_VERIFIED: "enabled", BUGLAB_SMTP_HOST: "smtp.example", BUGLAB_EMAIL_FROM: "BugLab <hello@buglab.example>" });
    assert.ok(production?.production && production.email.mode === "smtp");
  });
  test("capture refuses production even if constructed by a mistaken caller", () => {
    assert.throws(() => createEmailDelivery({ ...readAccountSettings(configured)!, production: true }), /forbidden/);
  });
  test("configured origins cannot contain paths, credentials, query strings or fragments", () => {
    for (const value of ["https://buglab.example/", "https://buglab.example/path", "https://user:pass@buglab.example", "https://buglab.example?x=1", "https://buglab.example#x"]) assert.throws(() => readAccountSettings({ ...configured, BUGLAB_APP_ORIGIN: value }));
  });
  test("return URLs resist host redirects, browser normalization, loops and encoded delimiters", () => {
    for (const path of ["https://evil.example", "//evil.example", "/\\evil.example", "/%2fevil", "/\t/evil", "/api/account/sign-out", "/login", "/signup", "/a/../login", "/%5cevil", "/foo\nbar"]) assert.equal(safeReturnPath(path), null, path);
    assert.equal(safeReturnPath("/challenges?difficulty=easy#results"), "/challenges?difficulty=easy#results");
  });
  test("email token is removed from the URL, bounded and not read from the query string", () => {
    let replaced = "";
    const token = "a".repeat(900);
    assert.equal(takeFragmentToken({ hash: `#token=${token}` }, (url) => { replaced = url; }, "/verify-email"), token);
    assert.equal(replaced, "/verify-email");
    assert.equal(takeFragmentToken({ hash: "#token=short" }, () => {}, "/"), null);
  });
  test("provider IP headers are rewritten only from the explicitly trusted proxy position", () => {
    const settings: AccountSettings = readAccountSettings(configured)!;
    const request = new Request("http://localhost/api/account/sign-in", { headers: { "x-buglab-client-ip": "1.2.3.4", "x-forwarded-for": "9.8.7.6, 192.0.2.5" } });
    assert.equal(providerHeaders(request, settings).get("x-buglab-client-ip"), null);
    assert.equal(providerHeaders(request, { ...settings, trustedProxyHops: 1 }).get("x-buglab-client-ip"), "192.0.2.5");
  });
  test("the client never turns malformed success or an unknown role into authentication", async () => {
    assert.equal(parseAccountSession({ user: { id: "x", email: "x@example.com", emailVerified: true, role: "owner" }, expiresAt: new Date().toISOString() }), null);
    const api = createHttpAccountApi({ fetch: async () => Response.json({ session: { token: "not-a-session" } }) });
    const result = await api.getSession();
    assert.ok(!result.ok && result.error.kind === "invalid-response");
    assert.equal((await disconnectedAccountApi.signIn({ email: "x@example.com", password: "fixture" })).ok, false);
  });
  test("password limits match the provider's UTF-16 checks", () => {
    assert.equal(checkNewPassword("a".repeat(128)), null);
    assert.ok(checkNewPassword("😀".repeat(65)));
    assert.ok(checkNewPassword(" ".repeat(20)));
  });
  test("generic server guards reject expired or malformed provider sessions", async () => {
    for (const expiresAt of ["2000-01-01T00:00:00Z", "invalid"]) {
      const response = await requireUser(new Request("https://buglab.example/account"), { name: "test", configured: true, async getSession() { return { user: { id: "fixture", email: "fixture@example.com", displayName: null, role: "learner" }, expiresAt }; } });
      assert.ok(!response.ok && response.status === 401);
    }
  });
});
