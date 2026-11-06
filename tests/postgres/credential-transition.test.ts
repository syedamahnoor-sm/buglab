/*
 * The credential transition when an account links a browser's anonymous learner, on a real PostgreSQL.
 *
 * THE DECISION (Syeda): linking requires a verified authenticated identity, possession of the existing anonymous credential
 * and explicit consent; authenticated access is established BEFORE the anonymous credential is retired; the retirement is in
 * the same transaction as the link; the old credential can never reach the linked learner afterwards; progress and completed
 * results are preserved; and no failure leaves a link without a retirement or a retirement without a link.
 *
 * Failures are injected INSIDE PostgreSQL with temporary triggers (raising an error, silently swallowing the update, killing
 * the connection, failing only at COMMIT), because a test that merely calls the code twice proves nothing about atomicity.
 * Each injection is removed again, and a retry after it must succeed on clean state.
 *
 * INACTIVE code: nothing mounts it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAppServices } from "@/server/app-services";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";
import { PostgresAccountLinkStore } from "@/server/db/postgres-account-links";
import { createLearnerLinking } from "@/server/identity/link-boundary";
import { IdentityError } from "@/server/identity/verified-account";
import type { LinkOutcome } from "@/server/identity/types";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { hashSessionToken, parseSessionToken } from "@/server/session/token";
import { CHALLENGE_ID, CORRECT_ID, RESOLUTION, WRONG_IDS, submission } from "../diagnosis/fixtures";
import { stampede, warm } from "./concurrency";
import { SKIP } from "./helpers";
import { requestAs, testProvider, verified } from "./identity-helpers";
import { pgFixture, type PgFixture } from "./pg-fixture";

const fixture = pgFixture();
const open: PostgresPersistence[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.close()));
});

let counter = 0;
const unique = (prefix: string) => `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
const key = (n: number) => `0a0b0c0d-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function composition(pg: PgFixture) {
  const persistence = createPostgresPersistence({ config: { connectionString: pg.db.url, poolMax: 6 } });
  open.push(persistence);
  const services = createAppServices({ store: persistence.store, appOrigin: null });
  const accounts = new PostgresAccountLinkStore({ pool: persistence.pool });
  const linking = createLearnerLinking({ auth: testProvider(), accounts });
  return { persistence, services, accounts, linking };
}
type Composition = Awaited<ReturnType<typeof composition>>;

/** An anonymous learner who has started Challenge 001 and COMPLETED it, through the real service. */
async function anonymousWithProgress(c: Composition, answerKey = 1) {
  const { cookie } = await c.services.service.startLearner(undefined);
  await c.services.service.startChallenge(cookie.value, CHALLENGE_ID);
  await c.services.service.submitDiagnosis(cookie.value, CHALLENGE_ID, submission({ rootCauseId: WRONG_IDS[0] }), { submissionId: key(answerKey) });
  const done = await c.services.service.submitDiagnosis(cookie.value, CHALLENGE_ID, submission({ rootCauseId: CORRECT_ID }), { submissionId: key(answerKey + 100) });
  assert.ok(done.status === "ok" && done.response.status === "correct");
  const token = parseSessionToken(cookie.value);
  assert.ok(token);
  return { cookie: cookie.value, tokenHash: hashSessionToken(token) };
}

const learnerOf = async (pg: PgFixture, tokenHash: string) =>
  (await pg.query<{ id: string }>("SELECT id FROM learners WHERE token_hash = $1", [tokenHash])).rows[0]?.id as string;

/** Every row of the learner's progress, as sorted text, so "preserved" is an exact comparison. */
async function progressOf(pg: PgFixture, learnerId: string) {
  const { rows } = await pg.query<{ dump: string }>(
    `SELECT coalesce(string_agg(x::text, E'\\n' ORDER BY x::text), '') AS dump FROM (
       SELECT to_jsonb(s) AS x FROM challenge_sessions s WHERE s.learner_id = $1
       UNION ALL SELECT to_jsonb(a) FROM diagnosis_attempts a JOIN challenge_sessions s ON s.id = a.session_id WHERE s.learner_id = $1) t`,
    [learnerId],
  );
  return rows[0].dump;
}

/** The invariant of the transition: no learner is both claimed by an account and still reachable by an anonymous credential. */
async function assertNoLinkedLearnerHasACredential(pg: PgFixture) {
  const { rows } = await pg.query("SELECT l.id FROM learners l JOIN account_learner_links k ON k.learner_id = l.id WHERE l.token_hash IS NOT NULL");
  assert.deepEqual(rows, [], "a learner is linked AND still has an anonymous credential");
}

const linkCount = async (pg: PgFixture) => (await pg.query("SELECT count(*)::int AS n FROM account_learner_links")).rows[0].n as number;

/** Installs a temporary trigger (and the function behind it), runs `run`, and always removes both. */
async function withInjection<T>(pg: PgFixture, sql: { create: string; drop: string }, run: () => Promise<T>): Promise<T> {
  await pg.query(sql.create);
  try {
    return await run();
  } finally {
    await pg.query(sql.drop);
  }
}

const RETIRING = "OLD.token_hash IS NOT NULL AND NEW.token_hash IS NULL";
const injections = {
  /** The retirement raises an error. */
  retireRaises: {
    create: `CREATE FUNCTION tmp_retire_raises() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
               IF ${RETIRING} THEN RAISE EXCEPTION 'injected failure while retiring'; END IF; RETURN NEW; END $$;
             CREATE TRIGGER tmp_retire_raises_trg BEFORE UPDATE ON learners FOR EACH ROW EXECUTE FUNCTION tmp_retire_raises();`,
    drop: "DROP TRIGGER IF EXISTS tmp_retire_raises_trg ON learners; DROP FUNCTION IF EXISTS tmp_retire_raises();",
  },
  /** The retirement is silently skipped: the UPDATE succeeds but changes zero rows. */
  retireSwallowed: {
    create: `CREATE FUNCTION tmp_retire_swallowed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
               IF ${RETIRING} THEN RETURN NULL; END IF; RETURN NEW; END $$;
             CREATE TRIGGER tmp_retire_swallowed_trg BEFORE UPDATE ON learners FOR EACH ROW EXECUTE FUNCTION tmp_retire_swallowed();`,
    drop: "DROP TRIGGER IF EXISTS tmp_retire_swallowed_trg ON learners; DROP FUNCTION IF EXISTS tmp_retire_swallowed();",
  },
  /** The link insert raises an error. */
  linkRaises: {
    create: `CREATE FUNCTION tmp_link_raises() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure while linking'; END $$;
             CREATE TRIGGER tmp_link_raises_trg BEFORE INSERT ON account_learner_links FOR EACH ROW EXECUTE FUNCTION tmp_link_raises();`,
    drop: "DROP TRIGGER IF EXISTS tmp_link_raises_trg ON account_learner_links; DROP FUNCTION IF EXISTS tmp_link_raises();",
  },
  /** The connection is killed from inside the database at the moment of retirement (a crashed backend). */
  connectionKilled: {
    create: `CREATE FUNCTION tmp_kill_backend() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
               IF ${RETIRING} THEN PERFORM pg_terminate_backend(pg_backend_pid()); PERFORM pg_sleep(1); END IF; RETURN NEW; END $$;
             CREATE TRIGGER tmp_kill_backend_trg BEFORE UPDATE ON learners FOR EACH ROW EXECUTE FUNCTION tmp_kill_backend();`,
    drop: "DROP TRIGGER IF EXISTS tmp_kill_backend_trg ON learners; DROP FUNCTION IF EXISTS tmp_kill_backend();",
  },
  /** Everything succeeds statement by statement, and the transaction fails only when it tries to COMMIT. */
  failsAtCommit: {
    create: `CREATE FUNCTION tmp_fail_at_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure at commit'; END $$;
             CREATE CONSTRAINT TRIGGER tmp_fail_at_commit_trg AFTER INSERT ON account_learner_links DEFERRABLE INITIALLY DEFERRED
               FOR EACH ROW EXECUTE FUNCTION tmp_fail_at_commit();`,
    drop: "DROP TRIGGER IF EXISTS tmp_fail_at_commit_trg ON account_learner_links; DROP FUNCTION IF EXISTS tmp_fail_at_commit();",
  },
  /** A database-level witness: retiring a credential is refused unless the account's link already exists in this transaction. */
  requireLinkFirst: {
    create: `CREATE FUNCTION tmp_require_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
               IF ${RETIRING} AND NOT EXISTS (SELECT 1 FROM account_learner_links WHERE learner_id = OLD.id) THEN
                 RAISE EXCEPTION 'credential retired before authenticated access existed'; END IF; RETURN NEW; END $$;
             CREATE TRIGGER tmp_require_link_trg BEFORE UPDATE ON learners FOR EACH ROW EXECUTE FUNCTION tmp_require_link();`,
    drop: "DROP TRIGGER IF EXISTS tmp_require_link_trg ON learners; DROP FUNCTION IF EXISTS tmp_require_link();",
  },
};

describe("the credential transition when an account links a learner (real PostgreSQL)", { skip: SKIP }, () => {
  describe("what linking does", () => {
    test("the old cookie reaches NOTHING afterwards: not the session, not the attempts, not a submission, and it cannot be revived", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { cookie, tokenHash } = await anonymousWithProgress(c);
      assert.equal((await c.services.service.checkLearner(cookie)).state, "active", "before: the cookie works");
      const before = await c.services.service.getChallengeSession(cookie, CHALLENGE_ID);
      assert.ok(before.status === "ok" && before.session?.status === "completed");

      const outcome = await c.accounts.linkBrowserLearner(await verified(unique("acct")), { tokenHash: tokenHash as never, consent: true });
      assert.equal(outcome.status, "linked");

      assert.equal((await c.services.service.checkLearner(cookie)).state, "none");
      for (const result of [
        await c.services.service.getChallengeSession(cookie, CHALLENGE_ID),
        await c.services.service.listAttempts(cookie, CHALLENGE_ID),
        await c.services.service.startChallenge(cookie, CHALLENGE_ID),
        await c.services.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: CORRECT_ID }), { submissionId: key(900) }),
      ]) {
        assert.ok(result.status === "rejected" && result.code === "learner-missing", JSON.stringify(result).slice(0, 120));
      }
      assert.equal((await c.persistence.store.findByTokenHash(tokenHash as never)).state, "none");
      assert.equal((await c.persistence.store.touch(tokenHash as never, "write")).state, "none", "activity cannot bring a retired credential back");
      const row = (await pg.query("SELECT token_hash, last_touched_at, idle_expires_at, absolute_expires_at FROM learners WHERE token_hash IS NULL")).rows[0];
      assert.deepEqual({ ...row }, { token_hash: null, last_touched_at: null, idle_expires_at: null, absolute_expires_at: null });
      await assertNoLinkedLearnerHasACredential(pg);
    });

    test("the credential is retired, not replaced: no new credential is created for the learner, and presenting the old one makes a fresh, separate anonymous learner", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { cookie, tokenHash } = await anonymousWithProgress(c);
      const linked = await c.accounts.linkBrowserLearner(await verified(unique("acct")), { tokenHash: tokenHash as never, consent: true });
      assert.ok(linked.status === "linked");

      const reborn = await c.services.service.startLearner(cookie);
      assert.equal(reborn.created, true);
      const learners = (await pg.query("SELECT id, token_hash FROM learners ORDER BY created_at")).rows;
      assert.equal(learners.length, 2, "the account's learner and one new anonymous one");
      assert.equal(learners.filter((l) => l.token_hash === null).length, 1);
      assert.notEqual(learners.find((l) => l.token_hash !== null)?.id, linked.learner.id, "the new anonymous learner is not the account's");
    });

    test("progress and the completed result are exactly preserved, and the account reaches them without any token", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { tokenHash } = await anonymousWithProgress(c);
      const learnerId = await learnerOf(pg, tokenHash);
      const before = await progressOf(pg, learnerId);
      assert.ok(before.length > 0);
      const account = await verified(unique("acct"));

      const outcome = await c.accounts.linkBrowserLearner(account, { tokenHash: tokenHash as never, consent: true });

      assert.ok(outcome.status === "linked");
      assert.equal(outcome.learner.id, learnerId, "the same learner, not a copy");
      assert.equal(await progressOf(pg, learnerId), before, "sessions, attempts and the stored result are byte for byte unchanged");
      const resolved = await c.accounts.findLearnerByAccount(account);
      const session = await c.persistence.store.find({ learnerId: resolved!.id, challengeId: CHALLENGE_ID });
      assert.equal(session?.status, "completed");
      assert.equal(session?.result?.resolutionSummary, RESOLUTION);
      const attempts = await c.persistence.store.list({ learnerId: resolved!.id, sessionId: session!.id });
      assert.deepEqual(attempts.map((a) => a.outcome), ["incorrect", "correct"]);
    });

    test("consent, a verified identity and possession are all required, and without any of them NOTHING changes", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { cookie, tokenHash } = await anonymousWithProgress(c);
      const account = await verified(unique("acct"));
      const snapshot = JSON.stringify((await pg.query("SELECT * FROM learners ORDER BY id")).rows);
      const browser = { cookie: `${LEARNER_COOKIE}=${cookie}` };

      assert.equal((await c.accounts.linkBrowserLearner(account, { tokenHash: tokenHash as never, consent: false })).status, "consent-required");
      assert.equal((await c.accounts.linkBrowserLearner(account, { tokenHash: null, consent: true })).status, "no-browser-learner", "no cookie: no possession");
      assert.deepEqual(await c.linking.linkBrowserLearner(requestAs(null, browser), { consent: true }), { status: "unauthenticated" }, "a cookie alone is not an identity");
      await assert.rejects(c.accounts.linkBrowserLearner({ accountId: "forged" } as never, { tokenHash: tokenHash as never, consent: true }), IdentityError);

      assert.equal(JSON.stringify((await pg.query("SELECT * FROM learners ORDER BY id")).rows), snapshot, "the learner, credential included, is untouched");
      assert.equal(await linkCount(pg), 0);
      assert.equal((await c.services.service.checkLearner(cookie)).state, "active", "and the cookie still works");
    });

    test("authenticated access is established BEFORE the credential is retired: the database itself refuses the reverse order", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { tokenHash } = await anonymousWithProgress(c);

      await withInjection(pg, injections.requireLinkFirst, async () => {
        // Negative control: the witness really does fire when a credential is retired with no link.
        await assert.rejects(pg.query("UPDATE learners SET token_hash = NULL, last_touched_at = NULL, idle_expires_at = NULL, absolute_expires_at = NULL"), /retired before authenticated access existed/);
        // And the real transition satisfies it: the link is already in the transaction when the credential is retired.
        const outcome = await c.accounts.linkBrowserLearner(await verified(unique("acct")), { tokenHash: tokenHash as never, consent: true });
        assert.equal(outcome.status, "linked");
      });
      await assertNoLinkedLearnerHasACredential(pg);
    });

    test("the source orders the steps: link, then proof of access, then retirement, then verification", () => {
      const source = readFileSync(join(fileURLToPath(new URL("../../", import.meta.url)), "src/server/db/postgres-account-links.ts"), "utf8");
      const at = (needle: string) => {
        const index = source.indexOf(needle);
        assert.ok(index > 0, `missing: ${needle}`);
        return index;
      };
      const insert = at("INSERT INTO account_learner_links (account_id, learner_id, linked_at) VALUES ($1, $2, $3::bigint)", );
      const lastInsert = source.lastIndexOf("INSERT INTO account_learner_links (account_id, learner_id, linked_at) VALUES ($1, $2, $3::bigint)");
      const proof = source.indexOf("reachable.id !== learner.id", lastInsert);
      const retire = source.indexOf("WHERE id = $1 AND token_hash = $2", lastInsert);
      const verify = source.indexOf("linked.hasAnonymousCredential", lastInsert);
      assert.ok(insert > 0 && lastInsert < proof && proof < retire && retire < verify, "link < proof < retire < verify");
    });
  });

  describe("failed transactions leave nothing half done", () => {
    async function expectCleanFailure(pg: PgFixture, c: Composition, cookie: string, tokenHash: string, before: { learners: string; progress: string }, learnerId: string) {
      assert.equal(await linkCount(pg), 0, "no link survived");
      assert.equal(JSON.stringify((await pg.query("SELECT * FROM learners ORDER BY id")).rows), before.learners, "the learner row, credential included, is exactly as it was");
      assert.equal(await progressOf(pg, learnerId), before.progress, "progress untouched");
      assert.equal((await c.services.service.checkLearner(cookie)).state, "active", "the cookie still works: nobody was locked out");
      assert.equal((await c.persistence.store.findByTokenHash(tokenHash as never)).state, "active");
    }
    async function prepare() {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { cookie, tokenHash } = await anonymousWithProgress(c);
      const learnerId = await learnerOf(pg, tokenHash);
      const before = { learners: JSON.stringify((await pg.query("SELECT * FROM learners ORDER BY id")).rows), progress: await progressOf(pg, learnerId) };
      return { pg, c, cookie, tokenHash, learnerId, before, account: await verified(unique("acct")) };
    }

    test("an error while retiring the credential rolls the link back too, and a retry afterwards succeeds", async () => {
      const t = await prepare();
      await withInjection(t.pg, injections.retireRaises, async () => {
        await assert.rejects(t.c.accounts.linkBrowserLearner(t.account, { tokenHash: t.tokenHash as never, consent: true }), /injected failure while retiring/);
        await expectCleanFailure(t.pg, t.c, t.cookie, t.tokenHash, t.before, t.learnerId);
      });
      const retry = await t.c.accounts.linkBrowserLearner(t.account, { tokenHash: t.tokenHash as never, consent: true });
      assert.equal(retry.status, "linked", "clean state, so the retry works");
      await assertNoLinkedLearnerHasACredential(t.pg);
    });

    test("a retirement that silently changes nothing is detected and the link is rolled back", async () => {
      const t = await prepare();
      await withInjection(t.pg, injections.retireSwallowed, async () => {
        await assert.rejects(
          t.c.accounts.linkBrowserLearner(t.account, { tokenHash: t.tokenHash as never, consent: true }),
          (error: Error) => error instanceof IdentityError && error.code === "link-failed",
        );
        await expectCleanFailure(t.pg, t.c, t.cookie, t.tokenHash, t.before, t.learnerId);
      });
      assert.equal((await t.c.accounts.linkBrowserLearner(t.account, { tokenHash: t.tokenHash as never, consent: true })).status, "linked");
    });

    test("an error while creating the link leaves the credential alone", async () => {
      const t = await prepare();
      await withInjection(t.pg, injections.linkRaises, async () => {
        await assert.rejects(t.c.accounts.linkBrowserLearner(t.account, { tokenHash: t.tokenHash as never, consent: true }), /injected failure while linking/);
        await expectCleanFailure(t.pg, t.c, t.cookie, t.tokenHash, t.before, t.learnerId);
      });
      assert.equal((await t.c.accounts.linkBrowserLearner(t.account, { tokenHash: t.tokenHash as never, consent: true })).status, "linked");
    });

    test("a connection that dies mid-transaction leaves no link and no retirement, and the store keeps working", async () => {
      const t = await prepare();
      await withInjection(t.pg, injections.connectionKilled, async () => {
        await assert.rejects(t.c.accounts.linkBrowserLearner(t.account, { tokenHash: t.tokenHash as never, consent: true }));
        await expectCleanFailure(t.pg, t.c, t.cookie, t.tokenHash, t.before, t.learnerId);
      });
      const retry = await t.c.accounts.linkBrowserLearner(t.account, { tokenHash: t.tokenHash as never, consent: true });
      assert.equal(retry.status, "linked", "the pool replaced the dead connection");
      await assertNoLinkedLearnerHasACredential(t.pg);
    });

    test("a transaction whose every statement succeeded but whose COMMIT fails leaves neither the link nor the retirement", async () => {
      const t = await prepare();
      await withInjection(t.pg, injections.failsAtCommit, async () => {
        await assert.rejects(t.c.accounts.linkBrowserLearner(t.account, { tokenHash: t.tokenHash as never, consent: true }), /injected failure at commit/);
        await expectCleanFailure(t.pg, t.c, t.cookie, t.tokenHash, t.before, t.learnerId);
      });
      assert.equal((await t.c.accounts.linkBrowserLearner(t.account, { tokenHash: t.tokenHash as never, consent: true })).status, "linked");
    });

    test("through the boundary a failure is an error to the caller, never a `linked` answer, and the old cookie keeps working", async () => {
      const t = await prepare();
      await withInjection(t.pg, injections.retireRaises, async () => {
        await assert.rejects(t.c.linking.linkBrowserLearner(requestAs("whoever", { cookie: `${LEARNER_COOKIE}=${t.cookie}` }), { consent: true }));
        assert.equal(await linkCount(t.pg), 0);
        assert.equal((await t.c.services.service.checkLearner(t.cookie)).state, "active");
      });
    });
  });

  describe("replay", () => {
    test("repeating a successful link changes nothing: `already-linked`, same revision, no second link", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { tokenHash } = await anonymousWithProgress(c);
      const account = await verified(unique("acct"));
      const first = await c.accounts.linkBrowserLearner(account, { tokenHash: tokenHash as never, consent: true });
      assert.ok(first.status === "linked");
      const snapshot = JSON.stringify((await pg.query("SELECT * FROM learners ORDER BY id")).rows);

      for (let i = 0; i < 3; i += 1) {
        const again = await c.accounts.linkBrowserLearner(account, { tokenHash: tokenHash as never, consent: true });
        assert.ok(again.status === "already-linked" && again.learner.id === first.learner.id);
      }
      assert.equal(JSON.stringify((await pg.query("SELECT * FROM learners ORDER BY id")).rows), snapshot, "not even a revision changed");
      assert.equal(await linkCount(pg), 1);
    });

    test("a different account replaying the OLD cookie after the link cannot claim anything, because the credential is gone", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { tokenHash } = await anonymousWithProgress(c);
      const owner = await verified(unique("owner"));
      const thief = await verified(unique("thief"));
      const linked = await c.accounts.linkBrowserLearner(owner, { tokenHash: tokenHash as never, consent: true });
      assert.ok(linked.status === "linked");

      assert.equal((await c.accounts.linkBrowserLearner(thief, { tokenHash: tokenHash as never, consent: true })).status, "no-browser-learner");
      assert.equal(await c.accounts.findLearnerByAccount(thief), null, "the thief gained nothing");
      assert.equal((await c.accounts.findLearnerByAccount(owner))?.id, linked.learner.id);
      assert.equal(await linkCount(pg), 1);
    });

    test("a replay that arrives after a FAILED first attempt is just a normal first attempt", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { tokenHash } = await anonymousWithProgress(c);
      const account = await verified(unique("acct"));
      await withInjection(pg, injections.retireRaises, async () => {
        await assert.rejects(c.accounts.linkBrowserLearner(account, { tokenHash: tokenHash as never, consent: true }));
        await assert.rejects(c.accounts.linkBrowserLearner(account, { tokenHash: tokenHash as never, consent: true }), "the second failure is the same failure, not a partial success");
      });
      assert.equal(await linkCount(pg), 0);
      assert.equal((await c.accounts.linkBrowserLearner(account, { tokenHash: tokenHash as never, consent: true })).status, "linked");
    });
  });

  describe("concurrent linking", () => {
    async function twoInstances(pg: PgFixture) {
      const pools = [pg.newPool(10), pg.newPool(10)];
      await Promise.all(pools.map((p) => warm(p)));
      return { pools, stores: pools.map((pool) => pg.newStore({}, pool)), accounts: pools.map((pool) => new PostgresAccountLinkStore({ pool })) };
    }

    test("twenty simultaneous links of one pair: exactly one `linked`, nineteen `already-linked`, the credential retired once", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { tokenHash } = await anonymousWithProgress(c);
      const learnerId = await learnerOf(pg, tokenHash);
      const revisionBefore = (await pg.query("SELECT revision FROM learners WHERE id = $1", [learnerId])).rows[0].revision;
      const { pools, accounts } = await twoInstances(pg);
      const account = await verified(unique("acct"));

      const settled = await stampede(pools[0], "LOCK TABLE account_learner_links IN EXCLUSIVE MODE", [], () =>
        Array.from({ length: 20 }, (_, i) => accounts[i % 2].linkBrowserLearner(account, { tokenHash: tokenHash as never, consent: true })),
      );

      assert.ok(settled.every((s) => s.status === "fulfilled"), settled.map((s) => (s.status === "rejected" ? String(s.reason) : "")).join(""));
      const statuses = settled.map((s) => (s as PromiseFulfilledResult<LinkOutcome>).value.status);
      assert.equal(statuses.filter((s) => s === "linked").length, 1);
      assert.equal(statuses.filter((s) => s === "already-linked").length, 19);
      assert.equal((await pg.query("SELECT revision FROM learners WHERE id = $1", [learnerId])).rows[0].revision, revisionBefore + 1, "retired exactly once");
      assert.equal(await linkCount(pg), 1);
      await assertNoLinkedLearnerHasACredential(pg);
    });

    test("two accounts racing for one browser's learner: exactly one wins; losers get no-browser-learner", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { cookie, tokenHash } = await anonymousWithProgress(c);
      const learnerId = await learnerOf(pg, tokenHash);
      const learnersBefore = (await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n as number;
      const { pools, accounts } = await twoInstances(pg);
      const [alice, bob] = [await verified(unique("alice")), await verified(unique("bob"))];

      const settled = await stampede(pools[0], "LOCK TABLE account_learner_links IN EXCLUSIVE MODE", [], () =>
        Array.from({ length: 20 }, (_, i) => accounts[i % 2].linkBrowserLearner(i % 2 === 0 ? alice : bob, { tokenHash: tokenHash as never, consent: true })),
      );

      assert.ok(
        settled.every((s) => s.status === "fulfilled"),
        settled.map((s) => (s.status === "rejected" ? String(s.reason) : "")).join("") || "no raw database uniqueness error escapes",
      );
      const outcomes = settled.map((s, i) => ({ who: i % 2 === 0 ? "alice" : "bob", status: (s as PromiseFulfilledResult<LinkOutcome>).value.status }));
      assert.equal(outcomes.filter((o) => o.status === "linked").length, 1, "exactly one account wins");
      const winner = outcomes.find((o) => o.status === "linked")?.who;
      const winnerAccount = winner === "alice" ? alice : bob;
      const loserAccount = winner === "alice" ? bob : alice;
      for (const o of outcomes) {
        if (o.who === winner) assert.ok(o.status === "linked" || o.status === "already-linked", `winner told ${o.status}`);
        // Credential retirement makes the hash miss; public contract is the generic miss, not ownership disclosure.
        else assert.equal(o.status, "no-browser-learner", `loser told ${o.status}`);
      }
      assert.equal(await linkCount(pg), 1);
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n, learnersBefore, "no orphan learner");
      assert.equal((await accounts[0].findLearnerByAccount(winnerAccount))?.id, learnerId);
      assert.equal(await accounts[0].findLearnerByAccount(loserAccount), null, "loser does not obtain the learner");
      assert.equal((await c.services.service.checkLearner(cookie)).state, "none", "old token cannot access anonymously");
      await assertNoLinkedLearnerHasACredential(pg);
    });

    test("one account racing two DIFFERENT browsers keeps exactly one learner, and the other browser's credential is NOT retired", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const [one, two] = [await anonymousWithProgress(c, 1), await anonymousWithProgress(c, 2)];
      // Each browser's learner id, recorded BEFORE the race: afterwards the winner's credential is gone, so it cannot be looked up.
      const learnerIdOf = new Map([
        [one.cookie, await learnerOf(pg, one.tokenHash)],
        [two.cookie, await learnerOf(pg, two.tokenHash)],
      ]);
      const { pools, accounts } = await twoInstances(pg);
      const account = await verified(unique("acct"));

      const settled = await stampede(pools[0], "LOCK TABLE account_learner_links IN EXCLUSIVE MODE", [], () =>
        Array.from({ length: 20 }, (_, i) => accounts[i % 2].linkBrowserLearner(account, { tokenHash: (i % 2 === 0 ? one : two).tokenHash as never, consent: true })),
      );

      assert.ok(settled.every((s) => s.status === "fulfilled"));
      const statuses = settled.map((s) => (s as PromiseFulfilledResult<LinkOutcome>).value.status);
      assert.equal(statuses.filter((s) => s === "linked").length, 1);
      assert.ok(statuses.every((s) => s === "linked" || s === "already-linked"));
      const winnerId = (await pg.query("SELECT l.id FROM learners l JOIN account_learner_links k ON k.learner_id = l.id")).rows[0].id as string;
      const [linkedBrowser, otherBrowser] = learnerIdOf.get(one.cookie) === winnerId ? [one, two] : [two, one];
      assert.equal(learnerIdOf.get(linkedBrowser.cookie), winnerId, "the browser whose learner was linked is the winner");

      // The browser that did NOT win keeps its anonymous credential and keeps working; the winner's is retired.
      assert.ok(otherBrowser.tokenHash && (await learnerOf(pg, otherBrowser.tokenHash)), "the other browser's credential is still in the database");
      assert.equal((await c.services.service.checkLearner(otherBrowser.cookie)).state, "active");
      assert.equal((await c.services.service.checkLearner(linkedBrowser.cookie)).state, "none");
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners WHERE token_hash IS NOT NULL")).rows[0].n, 1);
      await assertNoLinkedLearnerHasACredential(pg);
    });

    test("cookie activity racing the link can never bring the credential back: afterwards it is gone, and every touch was either before or after", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { tokenHash } = await anonymousWithProgress(c);
      const { pools, accounts, stores } = await twoInstances(pg);
      const account = await verified(unique("acct"));

      const settled = await stampede(pools[0], "LOCK TABLE account_learner_links IN EXCLUSIVE MODE", [], () => [
        accounts[0].linkBrowserLearner(account, { tokenHash: tokenHash as never, consent: true }) as Promise<unknown>,
        ...Array.from({ length: 30 }, (_, i) => stores[i % 2].touch(tokenHash as never, "write") as Promise<unknown>),
      ]);

      assert.ok(settled.every((s) => s.status === "fulfilled"), settled.map((s) => (s.status === "rejected" ? String(s.reason) : "")).join(""));
      const touches = settled.slice(1).map((s) => (s as PromiseFulfilledResult<{ state: string }>).value.state);
      assert.ok(touches.every((state) => state === "active" || state === "none"), "never anything else, never an error");
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners WHERE token_hash IS NOT NULL")).rows[0].n, 0);
      assert.equal((await stores[0].touch(tokenHash as never, "write")).state, "none");
      await assertNoLinkedLearnerHasACredential(pg);
    });
  });

  describe("multi-device", () => {
    test("another device, signed in with no cookie, reaches the same learner and progress; the retired cookie reaches nothing anywhere", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const { cookie, tokenHash } = await anonymousWithProgress(c);
      const deviceA = { cookie: `${LEARNER_COOKIE}=${cookie}` };
      assert.deepEqual(await c.linking.linkBrowserLearner(requestAs("alice", deviceA), { consent: true }), { status: "linked", retiredAnonymousCredential: true });

      // Device B: signed in, no anonymous cookie at all.
      const onB = await c.linking.resolveLearner(requestAs("alice"));
      assert.ok(onB.status === "ok");
      assert.equal((await c.persistence.store.find({ learnerId: onB.learnerId, challengeId: CHALLENGE_ID }))?.status, "completed");
      // Device A signed in resolves the same learner.
      const onA = await c.linking.resolveLearner(requestAs("alice", deviceA));
      assert.deepEqual(onA, onB);
      // Device C holds the stolen/old cookie and is NOT signed in: nothing.
      assert.equal((await c.services.service.checkLearner(cookie)).state, "none");
      assert.equal((await c.linking.resolveLearner(requestAs(null, deviceA))).status, "unauthenticated");
      assert.equal((await c.persistence.store.findByTokenHash(tokenHash as never)).state, "none");
    });

    test("a second device with its OWN anonymous learner is not merged and not disturbed: it is told `already-linked`, and keeps working anonymously", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      const first = await anonymousWithProgress(c, 1);
      const second = await anonymousWithProgress(c, 2);
      const secondLearner = await learnerOf(pg, second.tokenHash);
      const secondProgress = await progressOf(pg, secondLearner);
      await c.linking.linkBrowserLearner(requestAs("alice", { cookie: `${LEARNER_COOKIE}=${first.cookie}` }), { consent: true });

      const result = await c.linking.linkBrowserLearner(requestAs("alice", { cookie: `${LEARNER_COOKIE}=${second.cookie}` }), { consent: true });

      assert.deepEqual(result, { status: "already-linked" }, "the account already has its learner: nothing merges");
      assert.equal((await c.services.service.checkLearner(second.cookie)).state, "active", "device two's anonymous learner is untouched");
      assert.equal(await progressOf(pg, secondLearner), secondProgress);
      assert.equal(await linkCount(pg), 1);
      const accountLearner = await c.linking.resolveLearner(requestAs("alice"));
      assert.ok(accountLearner.status === "ok" && accountLearner.learnerId !== secondLearner, "and the two learners stay two");
      await assertNoLinkedLearnerHasACredential(pg);
    });

    test("signing in elsewhere never links anything by itself: the account's learner only ever comes from a deliberate link or an explicit creation", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      await anonymousWithProgress(c);
      assert.deepEqual(await c.linking.resolveLearner(requestAs("alice")), { status: "no-learner" });
      assert.equal(await linkCount(pg), 0);
    });

    test("an account created without a browser learner has an authenticated-only learner that no cookie can ever reach, on any device", async () => {
      const pg = await fixture();
      await pg.reset();
      const c = await composition(pg);
      assert.deepEqual(await c.linking.ensureLearner(requestAs("carol")), { status: "ok", created: true });
      const resolved = await c.linking.resolveLearner(requestAs("carol"));
      assert.ok(resolved.status === "ok");
      assert.equal((await pg.query("SELECT token_hash FROM learners WHERE id = $1", [resolved.learnerId])).rows[0].token_hash, null);
      // A later link attempt with some browser's cookie changes nothing: she already has a learner.
      const { cookie } = await anonymousWithProgress(c);
      assert.deepEqual(await c.linking.linkBrowserLearner(requestAs("carol", { cookie: `${LEARNER_COOKIE}=${cookie}` }), { consent: true }), { status: "already-linked" });
      assert.equal((await c.services.service.checkLearner(cookie)).state, "active");
    });
  });
});

