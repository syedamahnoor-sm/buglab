/*
 * The inactive linking boundary (src/server/identity/link-boundary.ts), without a database. It uses a spy in place of the
 * store, so these tests are about what the boundary ASKS the store, and when it refuses to ask at all. The same boundary on
 * real PostgreSQL is in tests/postgres/link-boundary.test.ts.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveAuthProvider, unconfiguredAuthProvider } from "@/server/auth/provider";
import { createLearnerLinking } from "@/server/identity/link-boundary";
import type { AccountLearnerRecord, AccountLearnerStore, LinkBrowserLearnerInput, LinkOutcome, VerifiedAccount } from "@/server/identity/types";
import { assertVerifiedAccount } from "@/server/identity/verified-account";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { hashSessionToken, issueSessionToken, parseSessionToken } from "@/server/session/token";
import { SIGNED_IN_AS, requestAs, testProvider } from "../postgres/identity-helpers";

const RECORD: AccountLearnerRecord = Object.freeze({ id: "internal-learner-id", revision: 0, createdAt: 1, updatedAt: 1, linkedAt: 1, hasAnonymousCredential: true });

/** A store that records what it was asked, and answers what the test says. */
function spyStore(outcome: LinkOutcome = { status: "linked", learner: RECORD }) {
  const calls: { method: string; account?: VerifiedAccount; input?: LinkBrowserLearnerInput }[] = [];
  const store: AccountLearnerStore = {
    async findLearnerByAccount(account) {
      calls.push({ method: "find", account });
      return RECORD;
    },
    async ensureAccountLearner(account) {
      calls.push({ method: "ensure", account });
      return { learner: RECORD, created: true };
    },
    async linkBrowserLearner(account, input) {
      calls.push({ method: "link", account, input });
      return outcome;
    },
  };
  return { store, calls };
}

/** A store that must never be reached. */
const forbiddenStore: AccountLearnerStore = {
  findLearnerByAccount: async () => { throw new Error("the store must not be reached"); },
  ensureAccountLearner: async () => { throw new Error("the store must not be reached"); },
  linkBrowserLearner: async () => { throw new Error("the store must not be reached"); },
};

describe("the inactive linking boundary", () => {
  describe("today, with the only provider that exists", () => {
    test("the default provider is the unconfigured one, and every operation answers `unavailable` without touching storage", async () => {
      const auth = resolveAuthProvider(undefined);
      assert.equal(auth, unconfiguredAuthProvider);
      const linking = createLearnerLinking({ auth, accounts: forbiddenStore });

      // Even a request that is dressed up as signed in, by every means a client could think of.
      const dressed = requestAs("victim", { [SIGNED_IN_AS]: "victim", cookie: `${LEARNER_COOKIE}=${issueSessionToken().token}; accountId=victim`, "x-account-id": "victim", authorization: "Bearer victim" });
      assert.deepEqual(await linking.linkBrowserLearner(dressed, { consent: true }), { status: "unavailable" });
      assert.deepEqual(await linking.ensureLearner(dressed), { status: "unavailable" });
      assert.deepEqual(await linking.resolveLearner(dressed), { status: "unavailable" });
    });

    test("selecting a provider that is not implemented fails loudly instead of disabling or faking sign-in", () => {
      assert.throws(() => resolveAuthProvider("some-provider"), /not available/);
    });
  });

  describe("with a provider configured", () => {
    test("nobody signed in: `unauthenticated`, and the store is never asked", async () => {
      const linking = createLearnerLinking({ auth: testProvider(), accounts: forbiddenStore });
      const anonymous = requestAs(null, { cookie: `${LEARNER_COOKIE}=${issueSessionToken().token}` });
      assert.deepEqual(await linking.linkBrowserLearner(anonymous, { consent: true }), { status: "unauthenticated" });
      assert.deepEqual(await linking.ensureLearner(anonymous), { status: "unauthenticated" });
      assert.deepEqual(await linking.resolveLearner(anonymous), { status: "unauthenticated" });
    });

    test("the store is given a verified account that came from the provider, and the token hash of the browser's cookie", async () => {
      const { store, calls } = spyStore();
      const linking = createLearnerLinking({ auth: testProvider(), accounts: store });
      const issued = issueSessionToken();

      const result = await linking.linkBrowserLearner(requestAs("real-user", { cookie: `${LEARNER_COOKIE}=${issued.token}` }), { consent: true });

      assert.deepEqual(result, { status: "linked", retiredAnonymousCredential: true }, "and the caller is told the old cookie is retired, so it can clear it");
      assert.equal(calls.length, 1);
      assertVerifiedAccount(calls[0].account);
      assert.equal(calls[0].account?.accountId, "real-user");
      assert.equal(calls[0].input?.tokenHash, hashSessionToken(parseSessionToken(issued.token) as never), "the hash, never the raw token");
      assert.equal(JSON.stringify(calls[0]).includes(issued.token), false, "the raw token is not passed anywhere");
    });

    test("an account named by the request (header, query, cookie, body) is ignored: only the provider's answer is used", async () => {
      const { store, calls } = spyStore();
      const linking = createLearnerLinking({ auth: testProvider(), accounts: store });
      const request = new Request("http://localhost:3000/api/link?accountId=victim", {
        method: "POST",
        headers: { [SIGNED_IN_AS]: "real-user", "x-account-id": "victim", cookie: "accountId=victim", "content-type": "application/json" },
        body: JSON.stringify({ accountId: "victim", account: { id: "victim" } }),
      });

      await linking.linkBrowserLearner(request, { consent: true });
      await linking.ensureLearner(request);
      await linking.resolveLearner(request);

      assert.deepEqual(calls.map((c) => c.account?.accountId), ["real-user", "real-user", "real-user"]);
    });

    test("consent is `true` only when the caller passes exactly true, and a missing or malformed cookie is no learner at all", async () => {
      const { store, calls } = spyStore({ status: "consent-required" });
      const linking = createLearnerLinking({ auth: testProvider(), accounts: store });
      const cookie = `${LEARNER_COOKIE}=${issueSessionToken().token}`;

      for (const consent of [false, undefined, null, "true", 1, {}]) {
        await linking.linkBrowserLearner(requestAs("u", { cookie }), { consent: consent as boolean });
      }
      assert.ok(calls.every((c) => c.input?.consent === false), "nothing but a real `true` becomes consent");

      calls.length = 0;
      await linking.linkBrowserLearner(requestAs("u"), { consent: true });
      await linking.linkBrowserLearner(requestAs("u", { cookie: `${LEARNER_COOKIE}=not-a-token` }), { consent: true });
      await linking.linkBrowserLearner(requestAs("u", { cookie: "other=thing" }), { consent: true });
      assert.deepEqual(calls.map((c) => c.input?.tokenHash), [null, null, null]);
    });

    test("there is no way to ask for the credential to be KEPT: the store input is only the cookie's hash and the consent", async () => {
      const { store, calls } = spyStore();
      const linking = createLearnerLinking({ auth: testProvider(), accounts: store });
      // Extra options a caller might try are not forwarded: retirement is not a choice.
      await linking.linkBrowserLearner(requestAs("u"), { consent: true, keepCredential: true, detachCredential: false } as never);
      assert.deepEqual(Object.keys(calls[0].input ?? {}).sort(), ["consent", "tokenHash"]);
    });

    test("an ended or malformed provider session is not an identity, so the store is not asked", async () => {
      const ended = testProvider({ session: (id) => ({ user: { id, email: "e@example.test", emailVerified: true, displayName: null, role: "learner" }, expiresAt: new Date(Date.now() - 1).toISOString() }) });
      const linking = createLearnerLinking({ auth: ended, accounts: forbiddenStore });
      assert.deepEqual(await linking.linkBrowserLearner(requestAs("u"), { consent: true }), { status: "unauthenticated" });
    });

    test("what a linking request is told is a status and nothing else: no id, hash or token", async () => {
      const outcomes: LinkOutcome[] = [
        { status: "linked", learner: RECORD },
        { status: "already-linked", learner: RECORD },
        { status: "consent-required" },
        { status: "no-browser-learner" },
        { status: "claimed-by-another-account" },
      ];
      for (const outcome of outcomes) {
        const linking = createLearnerLinking({ auth: testProvider(), accounts: spyStore(outcome).store });
        const result = await linking.linkBrowserLearner(requestAs("u"), { consent: true });
        // A status, plus on `linked` only the fact that the old cookie is retired. Never an id, hash or token.
        assert.deepEqual(Object.keys(result), outcome.status === "linked" ? ["status", "retiredAnonymousCredential"] : ["status"]);
        assert.equal(JSON.stringify(result).includes("internal-learner-id"), false);
      }
      const ensure = await createLearnerLinking({ auth: testProvider(), accounts: spyStore().store }).ensureLearner(requestAs("u"));
      assert.equal(JSON.stringify(ensure).includes("internal-learner-id"), false, "ensureLearner reveals no id either");
    });

    test("only resolveLearner, which is for server code, returns the learner's internal id", async () => {
      const linking = createLearnerLinking({ auth: testProvider(), accounts: spyStore().store });
      assert.deepEqual(await linking.resolveLearner(requestAs("u")), { status: "ok", learnerId: "internal-learner-id" });

      const none: AccountLearnerStore = { ...spyStore().store, findLearnerByAccount: async () => null };
      assert.deepEqual(await createLearnerLinking({ auth: testProvider(), accounts: none }).resolveLearner(requestAs("u")), { status: "no-learner" });
    });
  });
});
