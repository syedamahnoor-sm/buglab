/*
 * The account-to-learner boundary, on a real PostgreSQL. INACTIVE code: nothing mounts it and no real provider exists. These
 * tests use a test provider that stands in for one, and check the properties the approved model depends on:
 *
 *   - one account to at most one learner, and one learner to at most one account, enforced by the database;
 *   - an account is never trusted from a caller: every operation refuses anything that did not come from the provider;
 *   - the link policy agrees, for every combination, with Syeda's pure `decideLearnerLink`;
 *   - claims race safely and linking is atomic;
 *   - the anonymous credential and the authenticated identity stay separate: a learner with no credential is unreachable by
 *     any token, and removing a credential never cuts the account off.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createAppServices } from "@/server/app-services";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";
import { PostgresAccountLinkStore } from "@/server/db/postgres-account-links";
import { decideLearnerLink } from "@/server/auth/learner-link";
import { IdentityError, assertVerifiedAccount, verifyAccount } from "@/server/identity/verified-account";
import type { LinkOutcome, VerifiedAccount } from "@/server/identity/types";
import { DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import { hashSessionToken, issueSessionToken, parseSessionToken } from "@/server/session/token";
import { StoreError } from "@/server/session/types";
import { RESULT } from "../session/attempt-contract";
import { stampede, warm } from "./concurrency";
import { SKIP } from "./helpers";
import { requestAs, testProvider, verified } from "./identity-helpers";
import { pgFixture, type PgFixture } from "./pg-fixture";

const fixture = pgFixture();
const WINDOW = { limit: 3, windowMs: 600_000 };
const open: PostgresPersistence[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.close()));
});

let counter = 0;
const unique = (prefix: string) => `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

async function accountStore(pg: PgFixture, pool = pg.newPool(5)) {
  return { accounts: new PostgresAccountLinkStore({ pool }), store: pg.newStore({}, pool), pool };
}

const expireCredential = (pg: PgFixture, learnerId: string, standing: "in-grace" | "past-grace") =>
  pg.query(
    `UPDATE learners SET idle_expires_at = (floor(extract(epoch from clock_timestamp()) * 1000))::bigint - $2::bigint,
                         absolute_expires_at = (floor(extract(epoch from clock_timestamp()) * 1000))::bigint - $2::bigint WHERE id = $1`,
    [learnerId, standing === "past-grace" ? DEFAULT_EXPIRY_POLICY.purgeGraceMs + 3_600_000 : DEFAULT_EXPIRY_POLICY.purgeGraceMs - 3_600_000],
  );

const linkCount = async (pg: PgFixture, where = "TRUE", values: unknown[] = []) =>
  (await pg.query(`SELECT count(*)::int AS n FROM account_learner_links WHERE ${where}`, values)).rows[0].n as number;

describe("account links (real PostgreSQL)", { skip: SKIP }, () => {
  describe("what the database itself enforces", () => {
    test("one account to one learner and one learner to one account, whatever the application does", async () => {
      const pg = await fixture();
      await pg.reset();
      const store = pg.newStore();
      const a = await store.create({ tokenHash: issueSessionToken().tokenHash });
      const b = await store.create({ tokenHash: issueSessionToken().tokenHash });
      await pg.query("INSERT INTO account_learner_links VALUES ('acct-1', $1, 1)", [a.id]);

      await assert.rejects(pg.query("INSERT INTO account_learner_links VALUES ('acct-2', $1, 1)", [a.id]), (e: { code?: string }) => e.code === "23505", "a second account for the same learner");
      await assert.rejects(pg.query("INSERT INTO account_learner_links VALUES ('acct-1', $1, 1)", [b.id]), (e: { code?: string }) => e.code === "23505", "a second learner for the same account");
      await assert.rejects(pg.query("INSERT INTO account_learner_links VALUES ('acct-3', 'ghost', 1)"), (e: { code?: string }) => e.code === "23503", "a link to a learner that does not exist");
      await assert.rejects(pg.query("INSERT INTO account_learner_links VALUES ('', $1, 1)", [b.id]), (e: { code?: string }) => e.code === "23514", "an empty account id");
      assert.equal(await linkCount(pg), 1);
    });

    test("an anonymous credential is all or nothing, and any number of learners may have none", async () => {
      const pg = await fixture();
      await pg.reset();
      const half = (sql: string) => assert.rejects(pg.query(sql), (e: { code?: string }) => e.code === "23514");
      await half("INSERT INTO learners (id, token_hash, created_at, updated_at) VALUES ('h1', '" + "a".repeat(64) + "', 1, 1)");
      await half("INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at) VALUES ('h2', NULL, 1, 1, 1, 2, 3)");
      await half("INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at) VALUES ('h3', '" + "b".repeat(64) + "', 1, 1, 1, 2)");
      await pg.query("INSERT INTO learners (id, token_hash, created_at, updated_at) VALUES ('n1', NULL, 1, 1), ('n2', NULL, 1, 1), ('n3', NULL, 1, 1)");
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners WHERE token_hash IS NULL")).rows[0].n, 3, "NULL credentials are distinct, so they never collide");
      await assert.rejects(pg.query("INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at) VALUES ('bad', 'not-hex', 1, 1, 1, 2, 3)"), (e: { code?: string }) => e.code === "23514");
    });
  });

  describe("an account is never trusted from a caller", () => {
    test("every operation refuses a value that did not come from the provider, and writes nothing", async () => {
      const pg = await fixture();
      await pg.reset();
      const { accounts } = await accountStore(pg);
      const real = await verified("real-account");
      const forgeries: unknown[] = [
        "real-account",
        { accountId: "real-account" },
        { ...real },
        Object.assign(Object.create(null), { accountId: "x" }),
        JSON.parse(JSON.stringify(real)),
        null,
        undefined,
        42,
      ];
      for (const forged of forgeries) {
        const account = forged as VerifiedAccount;
        await assert.rejects(accounts.findLearnerByAccount(account), IdentityError, `find with ${JSON.stringify(forged)}`);
        await assert.rejects(accounts.ensureAccountLearner(account), IdentityError, `ensure with ${JSON.stringify(forged)}`);
        await assert.rejects(accounts.linkBrowserLearner(account, { tokenHash: null, consent: true }), IdentityError, `link with ${JSON.stringify(forged)}`);
      }
      assert.equal(await linkCount(pg), 0);
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n, 0, "no learner was created either");
      assert.doesNotThrow(() => assertVerifiedAccount(real), "...yet a genuinely issued one is accepted");
    });

    test("verifyAccount asks only the provider: an account named by the request itself counts for nothing", async () => {
      const calls: Request[] = [];
      const provider = testProvider({ calls });
      const hostile = new Request("http://localhost:3000/api/link?accountId=victim&account_id=victim", {
        method: "POST",
        headers: { "x-account-id": "victim", "x-user-id": "victim", authorization: "Bearer victim", cookie: "accountId=victim; buglab_account=victim", "content-type": "application/json" },
        body: JSON.stringify({ accountId: "victim", account: { id: "victim" }, userId: "victim" }),
      });

      assert.equal(await verifyAccount(provider, hostile), null, "the provider saw no session, so nobody is signed in, whatever the request claims");
      assert.equal(calls.length, 1);
      assert.equal(calls[0], hostile, "the provider was given the request itself to verify");

      const real = await verifyAccount(provider, requestAs("the-real-user", { "x-account-id": "victim", cookie: "accountId=victim" }));
      assert.equal(real?.accountId, "the-real-user", "when someone IS signed in, the account is the provider's, not the header's");
    });

    test("no provider, an unconfigured provider, an ended session and an unusable id are all refused", async () => {
      const request = requestAs("someone");
      assert.equal(await verifyAccount({ name: "unconfigured", configured: false, getSession: async () => { throw new Error("must not be asked"); } }, request), null);
      assert.equal(await verifyAccount(testProvider({ session: () => null }), request), null);
      const expired = testProvider({ session: (id) => ({ user: { id, email: "e@example.test", emailVerified: true, displayName: null, role: "learner" }, expiresAt: new Date(Date.now() - 1000).toISOString() }) });
      assert.equal(await verifyAccount(expired, request), null, "a session that has ended is not an identity");
      const badDate = testProvider({ session: (id) => ({ user: { id, email: "e@example.test", emailVerified: true, displayName: null, role: "learner" }, expiresAt: "not a date" }) });
      assert.equal(await verifyAccount(badDate, request), null);
      for (const id of ["", " ", "has space", "tab\tid", "line\nbreak", "x".repeat(257), "nul\u0000"]) {
        const odd = testProvider({ session: () => ({ user: { id, email: "e@example.test", emailVerified: true, displayName: null, role: "learner" }, expiresAt: new Date(Date.now() + 60_000).toISOString() }) });
        assert.equal(await verifyAccount(odd, request), null, JSON.stringify(id));
      }
    });

    test("a verified account cannot be altered after it is issued", async () => {
      const account = await verified("immutable");
      assert.throws(() => { (account as { accountId: string }).accountId = "someone-else"; }, TypeError);
      assert.equal(account.accountId, "immutable");
    });
  });

  describe("the learner of an account", () => {
    test("is created with NO anonymous credential, once, and found again", async () => {
      const pg = await fixture();
      await pg.reset();
      const { accounts } = await accountStore(pg);
      const account = await verified(unique("acct"));

      assert.equal(await accounts.findLearnerByAccount(account), null);
      const first = await accounts.ensureAccountLearner(account);
      const second = await accounts.ensureAccountLearner(account);

      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(second.learner.id, first.learner.id);
      assert.equal(first.learner.hasAnonymousCredential, false);
      assert.equal((await accounts.findLearnerByAccount(account))?.id, first.learner.id);
      const row = (await pg.query("SELECT token_hash, last_touched_at, idle_expires_at, absolute_expires_at FROM learners WHERE id = $1", [first.learner.id])).rows[0];
      assert.deepEqual({ ...row }, { token_hash: null, last_touched_at: null, idle_expires_at: null, absolute_expires_at: null });
    });

    test("twenty simultaneous requests for one account create exactly one learner and leave no orphan", async () => {
      const pg = await fixture();
      await pg.reset();
      const pools = [pg.newPool(10), pg.newPool(10)];
      await Promise.all(pools.map((p) => warm(p)));
      const stores = pools.map((pool) => new PostgresAccountLinkStore({ pool }));
      const account = await verified(unique("acct"));

      const settled = await stampede(pools[0], "LOCK TABLE account_learner_links IN EXCLUSIVE MODE", [], () =>
        Array.from({ length: 20 }, (_, i) => stores[i % 2].ensureAccountLearner(account)),
      );

      assert.ok(settled.every((s) => s.status === "fulfilled"), "none failed with a raw database error");
      const results = settled.map((s) => (s as PromiseFulfilledResult<{ learner: { id: string }; created: boolean }>).value);
      assert.equal(results.filter((r) => r.created).length, 1);
      assert.equal(new Set(results.map((r) => r.learner.id)).size, 1, "everyone got the same learner");
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n, 1, "the losers' learner rows rolled back with their transactions");
      assert.equal(await linkCount(pg), 1);
    });
  });

  describe("linking a browser's anonymous learner", () => {
    type Browser = "no-cookie" | "unknown-cookie" | "expired-in-grace" | "expired-past-grace" | "live" | "live-claimed-by-other";
    const BROWSERS: Browser[] = ["no-cookie", "unknown-cookie", "expired-in-grace", "expired-past-grace", "live", "live-claimed-by-other"];

    const ACTION: Record<LinkOutcome["status"], string> = {
      linked: "link-browser-learner",
      "already-linked": "use-account-learner",
      "consent-required": "ask-consent",
      "no-browser-learner": "create-account-learner",
      "claimed-by-another-account": "create-account-learner",
    };

    test("the outcome agrees with Syeda's decideLearnerLink for EVERY combination, and only `linked` writes a link", async () => {
      const pg = await fixture();
      await pg.reset();
      const { accounts, store } = await accountStore(pg);
      let combos = 0;

      for (const accountHasLearner of [false, true]) {
        for (const browser of BROWSERS) {
          for (const consent of [false, true]) {
            combos += 1;
            const accountId = unique("acct");
            const account = await verified(accountId);
            if (accountHasLearner) await accounts.ensureAccountLearner(account);

            let tokenHash: ReturnType<typeof issueSessionToken>["tokenHash"] | null = null;
            let browserLearnerId: string | null = null;
            let claimedBy: string | null = null;
            if (browser !== "no-cookie") {
              const issued = issueSessionToken();
              tokenHash = issued.tokenHash;
              if (browser !== "unknown-cookie") {
                const learner = await store.create({ tokenHash });
                if (browser === "expired-in-grace" || browser === "expired-past-grace") await expireCredential(pg, learner.id, browser === "expired-in-grace" ? "in-grace" : "past-grace");
                if (browser === "live" || browser === "live-claimed-by-other") browserLearnerId = learner.id;
                if (browser === "live-claimed-by-other") {
                  claimedBy = "someone-else";
                  await pg.query("INSERT INTO account_learner_links VALUES ($1, $2, 1)", [unique("other"), learner.id]);
                }
              }
            }
            const linksBefore = await linkCount(pg, "account_id = $1", [accountId]);

            const outcome = await accounts.linkBrowserLearner(account, { tokenHash, consent });

            const decision = decideLearnerLink({
              accountLearnerId: accountHasLearner ? "the-account-learner" : null,
              browserLearnerId,
              browserLearnerClaimedBy: claimedBy,
              accountId,
              consent,
            });
            const label = `account has learner=${accountHasLearner}, browser=${browser}, consent=${consent}`;
            assert.equal(ACTION[outcome.status], decision.action, label);
            const expectedLinks = linksBefore + (outcome.status === "linked" ? 1 : 0);
            assert.equal(await linkCount(pg, "account_id = $1", [accountId]), expectedLinks, `${label}: links written`);
          }
        }
      }
      assert.equal(combos, 24);
    });

    test("an account that already owns THIS browser's learner is told it already has it", async () => {
      const pg = await fixture();
      await pg.reset();
      const { accounts, store } = await accountStore(pg);
      const account = await verified(unique("acct"));
      const tokenHash = issueSessionToken().tokenHash;
      await store.create({ tokenHash });
      assert.equal((await accounts.linkBrowserLearner(account, { tokenHash, consent: true })).status, "linked");

      const again = await accounts.linkBrowserLearner(account, { tokenHash, consent: true });
      assert.equal(again.status, "already-linked");
      assert.equal(decideLearnerLink({ accountLearnerId: "x", browserLearnerId: "x", browserLearnerClaimedBy: account.accountId, accountId: account.accountId, consent: true }).action, "use-account-learner");
    });

    test("only `consent: true` counts: no other value, however truthy, links anything", async () => {
      const pg = await fixture();
      await pg.reset();
      const { accounts, store } = await accountStore(pg);
      const tokenHash = issueSessionToken().tokenHash;
      await store.create({ tokenHash });
      const account = await verified(unique("acct"));
      for (const consent of [false, undefined, null, 0, 1, "true", "yes", {}, []]) {
        const outcome = await accounts.linkBrowserLearner(account, { tokenHash, consent: consent as boolean });
        assert.equal(outcome.status, "consent-required", JSON.stringify(consent));
      }
      assert.equal(await linkCount(pg), 0);
    });

    test("a malformed token hash is refused as invalid input, never treated as a lookup", async () => {
      const pg = await fixture();
      const { accounts } = await accountStore(pg);
      const account = await verified(unique("acct"));
      for (const bad of ["", "nope", "A".repeat(64), "a".repeat(63), "a".repeat(65)]) {
        await assert.rejects(accounts.linkBrowserLearner(account, { tokenHash: bad as never, consent: true }), (e: StoreError) => e.code === "invalid-input", JSON.stringify(bad));
      }
    });

    test("twenty simultaneous links of one pair: exactly one `linked`, the rest `already-linked`, one row", async () => {
      const pg = await fixture();
      await pg.reset();
      const pools = [pg.newPool(10), pg.newPool(10)];
      await Promise.all(pools.map((p) => warm(p)));
      const stores = pools.map((pool) => new PostgresAccountLinkStore({ pool }));
      const tokenHash = issueSessionToken().tokenHash;
      await pg.newStore({}, pools[0]).create({ tokenHash });
      const account = await verified(unique("acct"));

      const settled = await stampede(pools[0], "LOCK TABLE account_learner_links IN EXCLUSIVE MODE", [], () =>
        Array.from({ length: 20 }, (_, i) => stores[i % 2].linkBrowserLearner(account, { tokenHash, consent: true })),
      );

      assert.ok(settled.every((s) => s.status === "fulfilled"), settled.map((s) => (s.status === "rejected" ? String(s.reason) : "")).join(""));
      const statuses = settled.map((s) => (s as PromiseFulfilledResult<LinkOutcome>).value.status);
      assert.equal(statuses.filter((s) => s === "linked").length, 1);
      assert.equal(statuses.filter((s) => s === "already-linked").length, 19);
      assert.equal(await linkCount(pg), 1);
    });

    test("two accounts racing for one learner: exactly one wins; losers get no-browser-learner after credential retirement", async () => {
      const pg = await fixture();
      await pg.reset();
      const pools = [pg.newPool(10), pg.newPool(10)];
      await Promise.all(pools.map((p) => warm(p)));
      const stores = pools.map((pool) => new PostgresAccountLinkStore({ pool }));
      const sessionStore = pg.newStore({}, pools[0]);
      const tokenHash = issueSessionToken().tokenHash;
      const created = await sessionStore.create({ tokenHash });
      const learnersBefore = (await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n as number;
      const [alice, bob] = [await verified(unique("alice")), await verified(unique("bob"))];

      // Deterministic overlap: hold the links table while every contender is already in flight (see concurrency.ts).
      const settled = await stampede(pools[0], "LOCK TABLE account_learner_links IN EXCLUSIVE MODE", [], () =>
        Array.from({ length: 20 }, (_, i) => stores[i % 2].linkBrowserLearner(i % 2 === 0 ? alice : bob, { tokenHash, consent: true })),
      );

      assert.ok(
        settled.every((s) => s.status === "fulfilled"),
        settled.map((s) => (s.status === "rejected" ? String(s.reason) : "")).join("") || "no raw database uniqueness error escapes",
      );
      const outcomes = settled.map((s, i) => ({
        who: i % 2 === 0 ? "alice" : "bob",
        value: (s as PromiseFulfilledResult<LinkOutcome>).value,
      }));
      const linked = outcomes.filter((o) => o.value.status === "linked");
      assert.equal(linked.length, 1, "exactly one account wins the link");
      const winner = linked[0].who;
      const winnerAccount = winner === "alice" ? alice : bob;
      const loserAccount = winner === "alice" ? bob : alice;

      for (const o of outcomes) {
        if (o.who === winner) {
          assert.ok(o.value.status === "linked" || o.value.status === "already-linked", `the winning account was told ${o.value.status}`);
        } else {
          // Winner retired the hash before losers' locking SELECT re-checked WHERE. Public contract: generic miss, not ownership disclosure.
          assert.equal(o.value.status, "no-browser-learner", `the losing account was told ${o.value.status}`);
        }
      }

      assert.equal(await linkCount(pg), 1, "exactly one link row");
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n, learnersBefore, "no orphan learner was created");
      assert.equal((await stores[0].findLearnerByAccount(winnerAccount))?.id, created.id, "the winner owns the original learner");
      assert.equal(await stores[0].findLearnerByAccount(loserAccount), null, "the losing account does not obtain the learner");

      const row = (await pg.query("SELECT token_hash, last_touched_at, idle_expires_at, absolute_expires_at FROM learners WHERE id = $1", [created.id])).rows[0];
      assert.deepEqual(
        { ...row },
        { token_hash: null, last_touched_at: null, idle_expires_at: null, absolute_expires_at: null },
        "the anonymous credential is retired after the successful link",
      );
      assert.equal((await sessionStore.findByTokenHash(tokenHash)).state, "none", "the old token cannot find the learner anonymously");
      assert.equal((await sessionStore.touch(tokenHash, "write")).state, "none", "the old token cannot access the learner anonymously");
    });

    test("a learner already claimed by another account while its credential remains is claimed-by-another-account", async () => {
      const pg = await fixture();
      await pg.reset();
      const { accounts, store } = await accountStore(pg);
      const tokenHash = issueSessionToken().tokenHash;
      const learner = await store.create({ tokenHash });
      // Credential still present (unlike a completed linkBrowserLearner, which would have retired it).
      await pg.query("INSERT INTO account_learner_links VALUES ($1, $2, 1)", [unique("owner"), learner.id]);

      const outcome = await accounts.linkBrowserLearner(await verified(unique("challenger")), { tokenHash, consent: true });

      assert.equal(outcome.status, "claimed-by-another-account");
      assert.equal(await linkCount(pg), 1, "challenger did not obtain a link");
      assert.ok((await pg.query("SELECT token_hash FROM learners WHERE id = $1", [learner.id])).rows[0].token_hash, "credential left present");
      assert.equal((await store.findByTokenHash(tokenHash)).state, "active", "anonymous access still works until a real link retires it");
    });

    test("one account racing for two different browser learners keeps exactly one", async () => {
      const pg = await fixture();
      await pg.reset();
      const pools = [pg.newPool(10), pg.newPool(10)];
      await Promise.all(pools.map((p) => warm(p)));
      const stores = pools.map((pool) => new PostgresAccountLinkStore({ pool }));
      const hashes = [issueSessionToken().tokenHash, issueSessionToken().tokenHash];
      for (const tokenHash of hashes) await pg.newStore({}, pools[0]).create({ tokenHash });
      const account = await verified(unique("acct"));

      const settled = await stampede(pools[0], "LOCK TABLE account_learner_links IN EXCLUSIVE MODE", [], () =>
        Array.from({ length: 20 }, (_, i) => stores[i % 2].linkBrowserLearner(account, { tokenHash: hashes[i % 2], consent: true })),
      );

      assert.ok(settled.every((s) => s.status === "fulfilled"));
      const statuses = settled.map((s) => (s as PromiseFulfilledResult<LinkOutcome>).value.status);
      assert.equal(statuses.filter((s) => s === "linked").length, 1);
      assert.ok(statuses.every((s) => s === "linked" || s === "already-linked"), "nothing merged, nothing refused as claimed");
      assert.equal(await linkCount(pg, "account_id = $1", [account.accountId]), 1, "one learner per account");
    });

    test("a learner cannot be linked once its credential expired, even inside the grace period, and linking never revives one", async () => {
      const pg = await fixture();
      await pg.reset();
      const { accounts, store } = await accountStore(pg);
      const tokenHash = issueSessionToken().tokenHash;
      const learner = await store.create({ tokenHash });
      await expireCredential(pg, learner.id, "in-grace");
      const before = (await pg.query("SELECT idle_expires_at FROM learners WHERE id = $1", [learner.id])).rows[0].idle_expires_at;

      const outcome = await accounts.linkBrowserLearner(await verified(unique("acct")), { tokenHash, consent: true });

      assert.equal(outcome.status, "no-browser-learner");
      assert.equal((await pg.query("SELECT idle_expires_at FROM learners WHERE id = $1", [learner.id])).rows[0].idle_expires_at, before, "left exactly as it was");
    });
  });

  describe("anonymous credential and authenticated identity stay separate", () => {
    async function composition(pg: PgFixture) {
      const persistence = createPostgresPersistence({ config: { connectionString: pg.db.url, poolMax: 5 } });
      open.push(persistence);
      const accounts = new PostgresAccountLinkStore({ pool: persistence.pool });
      return { persistence, services: createAppServices({ store: persistence.store, appOrigin: null }), accounts };
    }

    test("no token can reach a learner that has no credential: random hashes, and every malformed value, find nothing", async () => {
      const pg = await fixture();
      await pg.reset();
      const { persistence, accounts } = await composition(pg);
      for (let i = 0; i < 5; i += 1) await accounts.ensureAccountLearner(await verified(unique("acct")));

      for (let i = 0; i < 200; i += 1) {
        const guess = hashSessionToken(issueSessionToken().token);
        assert.equal((await persistence.store.findByTokenHash(guess)).state, "none");
        assert.equal((await persistence.store.touch(guess, "write")).state, "none");
      }
      for (const bad of ["", "null", "NULL", " ", "undefined", null, undefined, 0, "0".repeat(63), "0".repeat(64) + "0"]) {
        await assert.rejects(persistence.store.findByTokenHash(bad as never), (e: StoreError) => e.code === "invalid-input", JSON.stringify(bad));
        await assert.rejects(persistence.store.touch(bad as never, "write"), (e: StoreError) => e.code === "invalid-input", JSON.stringify(bad));
      }
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners WHERE token_hash IS NULL")).rows[0].n, 5, "and the credential-less learners are all still there, untouched");
    });

    test("through the real service, the anonymous path cannot see an authenticated learner and makes a separate learner of its own", async () => {
      const pg = await fixture();
      await pg.reset();
      const { services, accounts, persistence } = await composition(pg);
      const account = await verified(unique("acct"));
      const { learner } = await accounts.ensureAccountLearner(account);
      await persistence.store.start({ learnerId: learner.id, challengeId: "challenge-001", challengeVersion: "v1" });

      const anonymous = await services.service.startLearner(undefined);
      assert.equal(anonymous.created, true);
      const cookieLearner = await persistence.store.findByTokenHash(hashSessionToken(parseSessionToken(anonymous.cookie.value) as never));
      assert.ok(cookieLearner.state === "active");
      assert.notEqual(cookieLearner.learner.id, learner.id, "a different learner");
      const session = await services.service.getChallengeSession(anonymous.cookie.value, "challenge-001");
      assert.ok(session.status === "ok" && session.session === null, "the account's session is not visible to the anonymous learner");
      assert.equal(await linkCount(pg), 1, "and nothing linked them");
    });

    test("the account resolves its canonical learner server-side and uses the ordinary session ports, with no token anywhere", async () => {
      const pg = await fixture();
      await pg.reset();
      const { accounts, persistence } = await composition(pg);
      const account = await verified(unique("acct"));
      const { learner } = await accounts.ensureAccountLearner(account);

      const resolved = await accounts.findLearnerByAccount(account);
      assert.equal(resolved?.id, learner.id);
      const { session } = await persistence.store.start({ learnerId: resolved!.id, challengeId: "challenge-001", challengeVersion: "v1" });
      await persistence.store.record({
        learnerId: resolved!.id, sessionId: session.id, submissionId: "s-1", requestHash: "a".repeat(64), rootCauseId: "option-a",
        explanation: "x", evidence: [], outcome: "correct", result: RESULT, window: WINDOW,
      });

      const again = await accounts.findLearnerByAccount(account);
      const stored = await persistence.store.find({ learnerId: again!.id, challengeId: "challenge-001" });
      assert.equal(stored?.status, "completed", "a second device resolves the same learner and finds the same progress");
      assert.deepEqual(stored?.result, RESULT);
    });
  });
});

