import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { verifyAccount, isVerifiedAccount } from "@/server/auth/verified-account";
import type { AuthProvider } from "@/server/auth/provider";
import type { AuthSession } from "@/server/auth/types";

const request = () => new Request("https://buglab.example/api/account/link", { headers: { "x-account-id": "forged", "x-user-role": "admin", cookie: "account=forged" } });
const live = (): AuthSession => ({ user: { id: "opaque-provider-account", email: "verified@example.com", emailVerified: true, displayName: "Ada", role: "learner" }, expiresAt: new Date(Date.now() + 60000).toISOString() });
const provider = (session: AuthSession | null): AuthProvider => ({ name: "trusted-server-test", configured: true, async getSession() { return session; } });

describe("server-issued VerifiedAccount integration contract", () => {
  test("contains only server-resolved account fields and is frozen", async () => {
    const incoming = request();
    const proof = await verifyAccount(incoming, provider(live()));
    assert.ok(isVerifiedAccount(proof, incoming));
    assert.equal(proof.accountId, "opaque-provider-account");
    assert.equal(proof.email, "verified@example.com");
    assert.equal(proof.emailVerified, true);
    assert.equal(proof.role, "learner");
    assert.ok(Object.isFrozen(proof));
    assert.deepEqual(Object.keys(proof).sort(), ["accountId", "displayName", "email", "emailVerified", "role"]);
  });
  test("copied, serialized, hand-built and wrong-request proofs are refused", async () => {
    const incoming = request();
    const proof = await verifyAccount(incoming, provider(live()));
    assert.ok(proof);
    for (const copy of [{ ...proof }, JSON.parse(JSON.stringify(proof)), Object.create(proof), { accountId: "forged", emailVerified: true }, null]) assert.equal(isVerifiedAccount(copy, incoming), false);
    assert.equal(isVerifiedAccount(proof, request()), false);
  });
  test("missing, unverified, malformed, expired and unknown-role sessions issue no proof", async () => {
    const invalid: Array<AuthSession | null> = [null, { ...live(), expiresAt: "invalid" }, { ...live(), expiresAt: "2000-01-01T00:00:00Z" }];
    for (const fields of [{ emailVerified: false }, { emailVerified: undefined }, { id: "" }, { id: "x".repeat(257) }, { email: "invalid" }, { role: "owner" }]) invalid.push({ ...live(), user: { ...live().user, ...fields } } as AuthSession);
    for (const session of invalid) assert.equal(await verifyAccount(request(), provider(session)), null);
  });
  test("unconfigured providers never receive an authentication lookup", async () => {
    assert.equal(await verifyAccount(request(), { name: "unconfigured", configured: false, async getSession() { throw new Error("must not be called"); } }), null);
  });
});
