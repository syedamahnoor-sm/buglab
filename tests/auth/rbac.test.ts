import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { requirePermission, requirePermissionForWrite, requireUser } from "@/server/auth/guards";
import { ALL_PERMISSIONS, can, type Permission } from "@/server/auth/permissions";
import { resolveAuthProvider, unconfiguredAuthProvider, type AuthProvider } from "@/server/auth/provider";
import type { AuthenticatedUser, Role } from "@/server/auth/types";

const APP = "https://buglab.example";

/** A test provider that "authenticates" whoever it is given, and counts lookups. */
function providerFor(role: Role | null) {
  let lookups = 0;
  const provider: AuthProvider = {
    name: "test",
    configured: true,
    async getSession() {
      lookups += 1;
      if (role === null) return null;
      const user: AuthenticatedUser = { id: `acct-${role}`, email: `${role}@buglab.example`, displayName: null, role };
      return { user, expiresAt: "2026-12-01T00:00:00.000Z" };
    },
  };
  return { provider, lookups: () => lookups };
}

const request = (headers: Record<string, string> = {}, method = "GET") => new Request(`${APP}/api/x`, { method, headers });

describe("permission matrix", () => {
  const expected: Record<"anonymous" | Role, Permission[]> = {
    anonymous: [],
    learner: ["account:read-own", "account:update-own"],
    admin: [...ALL_PERMISSIONS],
  };
  for (const [who, granted] of Object.entries(expected)) {
    test(`${who}`, () => {
      const role = who === "anonymous" ? null : (who as Role);
      for (const permission of ALL_PERMISSIONS) assert.equal(can(role, permission), granted.includes(permission), `${who} ${permission}`);
    });
  }

  test("unknown roles and inherited property names hold nothing", () => {
    for (const role of ["owner", "superuser", "__proto__", "constructor", "toString"]) {
      assert.equal(can(role as Role, "admin:access"), false, role);
    }
  });

  test("learners can never reach admin permissions", () => {
    for (const permission of ALL_PERMISSIONS.filter((p) => p.startsWith("admin:"))) assert.equal(can("learner", permission), false, permission);
  });
});

describe("guards: unauthenticated, learner and admin", () => {
  test("no session: 401 with no-store and an authentication challenge", async () => {
    const result = await requireUser(request(), providerFor(null).provider);
    assert.ok(!result.ok);
    assert.equal(result.status, 401);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    assert.ok(result.response.headers.get("www-authenticate"));
    assert.deepEqual(await result.response.json(), { status: "error", code: "unauthenticated", message: "Sign in to continue." });
  });

  test("an admin permission: 401 anonymous, 403 learner, allowed for admin", async () => {
    const outcomes: Record<string, number | "ok"> = {};
    for (const role of [null, "learner", "admin"] as const) {
      const result = await requirePermission(request(), "admin:challenges:read", providerFor(role).provider);
      outcomes[String(role)] = result.ok ? "ok" : result.status;
    }
    assert.deepEqual(outcomes, { null: 401, learner: 403, admin: "ok" });
  });

  test("an own-account permission: learner and admin allowed", async () => {
    for (const role of ["learner", "admin"] as const) {
      assert.ok((await requirePermission(request(), "account:read-own", providerFor(role).provider)).ok, role);
    }
  });

  test("writes check the origin first, before any session lookup", async () => {
    const admin = providerFor("admin");
    const crossOrigin: Record<string, string>[] = [{ origin: "https://evil.example" }, { origin: "https://@buglab.example" }, { origin: "null" }, {}, { "sec-fetch-site": "cross-site" }];
    for (const headers of crossOrigin) {
      const result = await requirePermissionForWrite(request(headers, "POST"), "admin:challenges:write", admin.provider, APP);
      assert.ok(!result.ok && result.status === 403 && result.code === "cross-origin", JSON.stringify(headers));
    }
    assert.equal(admin.lookups(), 0, "no session was looked up for a cross-origin write");
    const ok = await requirePermissionForWrite(request({ origin: APP }, "POST"), "admin:challenges:write", admin.provider, APP);
    assert.ok(ok.ok);
    const learner = await requirePermissionForWrite(request({ "sec-fetch-site": "same-origin" }, "POST"), "admin:challenges:write", providerFor("learner").provider, APP);
    assert.ok(!learner.ok && learner.status === 403 && learner.code === "forbidden");
  });
});

describe("the provider in this deployment", () => {
  test("unconfigured by default: nobody is authenticated, every protected operation is refused", async () => {
    assert.equal(resolveAuthProvider(undefined), unconfiguredAuthProvider);
    assert.equal(resolveAuthProvider("  "), unconfiguredAuthProvider);
    assert.equal(unconfiguredAuthProvider.configured, false);
    // Even a request that claims to be an admin in every header is anonymous.
    const claims = request({ cookie: "role=admin; session=admin", authorization: "Bearer admin", "x-user-role": "admin" });
    assert.equal(await unconfiguredAuthProvider.getSession(claims), null);
    const result = await requirePermission(claims, "admin:access", unconfiguredAuthProvider);
    assert.ok(!result.ok && result.status === 401);
  });

  test("selecting a provider that is not implemented fails loudly", () => {
    assert.throws(() => resolveAuthProvider("better-auth"), /not available/);
    assert.throws(() => resolveAuthProvider("memory"), /not available/);
  });
});
