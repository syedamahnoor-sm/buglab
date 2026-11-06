/*
 * The account-linking expiry purge (`purgeExpiredExcludingLinked`) and linked learners, on a real PostgreSQL.
 *
 * Core `PostgresStore.purgeExpired` has no link awareness (migrations 0001/0002 only). Once migration 0003 is applied and
 * linking is used, linked-learner retention is this helper's job: a learner an account has claimed is NEVER deleted by it,
 * explicitly, not by a foreign-key failure. These tests prove that from several directions.
 *
 * "Linked" below is a row in account_learner_links, written directly where the test is about the purge, so that these tests do
 * not depend on the linking flow. The linking code has its own tests (account-links.test.ts).
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import { issueSessionToken } from "@/server/session/token";
import { PostgresAccountLinkStore, purgeExpiredExcludingLinked } from "@/server/db/postgres-account-links";
import { RESULT } from "../session/attempt-contract";
import { fulfilled, stampede, warm } from "./concurrency";
import { createTestDatabase, SKIP, type TestDatabase } from "./helpers";
import { verified } from "./identity-helpers";
import { pgFixture, type PgFixture } from "./pg-fixture";

const purge = (pg: PgFixture, options: { now?: () => number } = {}) =>
  purgeExpiredExcludingLinked(pg.newPool(5), options);

const fixture = pgFixture();
const WINDOW = { limit: 3, windowMs: 600_000 };
const START = Date.parse("2026-11-01T10:00:00Z");
const extraDatabases: TestDatabase[] = [];
afterEach(async () => {
  await Promise.all(extraDatabases.splice(0).map((db) => db.drop()));
});

type Standing = "live" | "in-grace" | "past-grace";

/** Sets a learner's credential expiry on the database clock: live, expired but inside the purge grace, or long past it. */
async function setStanding(pg: PgFixture, learnerId: string, standing: Standing) {
  const expiredAgo = standing === "past-grace" ? DEFAULT_EXPIRY_POLICY.purgeGraceMs + 3_600_000 : DEFAULT_EXPIRY_POLICY.purgeGraceMs - 3_600_000;
  const now = "(floor(extract(epoch from clock_timestamp()) * 1000))::bigint";
  if (standing === "live") return;
  await pg.query(`UPDATE learners SET idle_expires_at = ${now} - $2::bigint, absolute_expires_at = ${now} - $2::bigint WHERE id = $1`, [learnerId, expiredAgo]);
}

async function link(pg: PgFixture, accountId: string, learnerId: string) {
  await pg.query("INSERT INTO account_learner_links (account_id, learner_id, linked_at) VALUES ($1, $2, 1)", [accountId, learnerId]);
}

/** A learner with a credential, optionally with a completed session (an attempt and a stored result). */
async function learner(pg: PgFixture, options: { progress?: boolean } = {}) {
  const store = pg.newStore();
  const created = await store.create({ tokenHash: issueSessionToken().tokenHash });
  if (options.progress) {
    const { session } = await store.start({ learnerId: created.id, challengeId: "challenge-001", challengeVersion: "v1" });
    await store.record({
      learnerId: created.id,
      sessionId: session.id,
      submissionId: `done-${created.id}`,
      requestHash: "a".repeat(64),
      rootCauseId: "option-a",
      explanation: "x",
      evidence: [{ kind: "log", logId: "log-01" }],
      outcome: "correct",
      result: RESULT,
      window: WINDOW,
    });
  }
  return created;
}

/** Every row that belongs to the given learners, as sorted text, so "nothing changed" is an exact comparison. */
async function dumpOf(pg: PgFixture, learnerIds: string[]) {
  const { rows } = await pg.query<{ dump: string }>(
    `SELECT coalesce(string_agg(x::text, E'\\n' ORDER BY x::text), '') AS dump FROM (
       SELECT to_jsonb(l) AS x FROM learners l WHERE l.id = ANY($1::text[])
       UNION ALL SELECT to_jsonb(s) FROM challenge_sessions s WHERE s.learner_id = ANY($1::text[])
       UNION ALL SELECT to_jsonb(a) FROM diagnosis_attempts a JOIN challenge_sessions s ON s.id = a.session_id WHERE s.learner_id = ANY($1::text[])) t`,
    [learnerIds],
  );
  return rows[0].dump;
}

const survivors = async (pg: PgFixture) => new Set((await pg.query<{ id: string }>("SELECT id FROM learners")).rows.map((row) => row.id));

describe("the expiry purge and linked learners (real PostgreSQL)", { skip: SKIP }, () => {
  describe("which learners are eligible", () => {
    test("only an UNLINKED learner whose credential expired more than the grace period ago is deleted", async () => {
      const pg = await fixture();
      await pg.reset();
      const rows: Record<string, { id: string }> = {};
      const make = async (name: string, standing: Standing, linked: boolean) => {
        const l = await learner(pg);
        await setStanding(pg, l.id, standing);
        if (linked) await link(pg, `account-${name}`, l.id);
        rows[name] = l;
      };
      await make("unlinked-live", "live", false);
      await make("unlinked-in-grace", "in-grace", false);
      await make("unlinked-past-grace", "past-grace", false);
      await make("linked-live", "live", true);
      await make("linked-in-grace", "in-grace", true);
      await make("linked-past-grace", "past-grace", true);
      // An authenticated-only learner (no credential at all) and an unlinked credential-less one: neither has an expiry to pass.
      await pg.query("INSERT INTO learners (id, token_hash, created_at, updated_at) VALUES ('auth-only', NULL, 1, 1), ('orphan', NULL, 1, 1)");
      await link(pg, "account-auth-only", "auth-only");

      const removed = await purge(pg);

      assert.equal(removed, 1);
      const left = await survivors(pg);
      assert.ok(!left.has(rows["unlinked-past-grace"].id), "the one eligible learner is gone");
      for (const name of ["unlinked-live", "unlinked-in-grace", "linked-live", "linked-in-grace", "linked-past-grace"]) {
        assert.ok(left.has(rows[name].id), `${name} is kept`);
      }
      assert.ok(left.has("auth-only") && left.has("orphan"), "a learner with no credential is never purged, linked or not");
    });

    test("a linked learner is not deleted however long ago its credential expired", async () => {
      const pg = await fixture();
      await pg.reset();
      const l = await learner(pg);
      await link(pg, "account-1", l.id);
      await pg.query("UPDATE learners SET idle_expires_at = 2, absolute_expires_at = 3 WHERE id = $1", [l.id]); // decades past grace

      assert.equal(await purge(pg), 0);
      assert.ok((await survivors(pg)).has(l.id));
    });
  });

  describe("progress of a linked learner", () => {
    test("completed progress, attempts, superseded history and the stored result are byte-for-byte unchanged by a purge", async () => {
      const pg = await fixture();
      await pg.reset();
      const store = pg.newStore();
      const linked = await learner(pg, { progress: true });
      // A second session that a restart superseded: history that must also survive.
      const second = await store.start({ learnerId: linked.id, challengeId: "challenge-002", challengeVersion: "v1" });
      await store.restart({ learnerId: linked.id, challengeId: "challenge-002", challengeVersion: "v2", supersedes: second.session.id });
      await link(pg, "account-1", linked.id);
      await setStanding(pg, linked.id, "past-grace");
      // And an unlinked, equally expired learner with progress, to be sure the purge really ran.
      const unlinked = await learner(pg, { progress: true });
      await setStanding(pg, unlinked.id, "past-grace");
      const before = await dumpOf(pg, [linked.id]);

      assert.equal(await purge(pg), 1, "only the unlinked learner was purged");

      assert.equal(await dumpOf(pg, [linked.id]), before);
      const found = await store.find({ learnerId: linked.id, challengeId: "challenge-001" });
      assert.equal(found?.status, "completed");
      assert.deepEqual(found?.result, RESULT);
      assert.equal((await store.list({ learnerId: linked.id, sessionId: found?.id as string })).length, 1);
      assert.equal(await dumpOf(pg, [unlinked.id]), "", "while the unlinked learner and all its progress are gone");
    });
  });

  describe("the exclusion is the purge's own, not the foreign key's", () => {
    test("with the foreign key removed entirely, a linked learner is still not deleted", async () => {
      const db = await createTestDatabase();
      extraDatabases.push(db);
      const pg = await (async () => {
        // A dedicated database, so dropping the constraint cannot affect any other test.
        const { default: pgModule } = await import("pg");
        const pool = new pgModule.Pool({ connectionString: db.url, max: 5 });
        const { PostgresStore } = await import("@/server/db/postgres-store");
        return { pool, store: new PostgresStore({ pool }) };
      })();
      try {
        await pg.pool.query("ALTER TABLE account_learner_links DROP CONSTRAINT account_learner_links_learner_id_fkey");
        const linked = await pg.store.create({ tokenHash: issueSessionToken().tokenHash });
        const unlinked = await pg.store.create({ tokenHash: issueSessionToken().tokenHash });
        await pg.pool.query("INSERT INTO account_learner_links VALUES ('account-1', $1, 1)", [linked.id]);
        await pg.pool.query("UPDATE learners SET idle_expires_at = 2, absolute_expires_at = 3");

        assert.equal(await purgeExpiredExcludingLinked(pg.pool), 1);
        const left = (await pg.pool.query("SELECT id FROM learners")).rows.map((r) => r.id);
        assert.deepEqual(left, [linked.id], "no constraint stood in the way, and the linked learner survived anyway");
        assert.notEqual(unlinked.id, linked.id);
      } finally {
        await pg.pool.end();
      }
    });
  });

  describe("linked learners do not block or starve the purge", () => {
    // A timeout, so that a purge which re-claims the same linked rows forever fails this test quickly instead of hanging the run.
    test("600 linked expired learners (more than a whole batch, sorting first) do not stop 5 unlinked ones being purged", { timeout: 30_000 }, async () => {
      const pg = await fixture();
      await pg.reset();
      const pool = pg;
      await pool.query(
        `INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at)
         SELECT 'a-linked-' || lpad(n::text, 4, '0'), lpad(to_hex(n + 5000000), 64, '0'), 1, 1, 1, 2, 3 FROM generate_series(1, 600) AS n`,
      );
      await pool.query("INSERT INTO account_learner_links SELECT 'acct-' || id, id, 1 FROM learners");
      await pool.query(
        `INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at)
         SELECT 'z-unlinked-' || n, lpad(to_hex(n + 9000000), 64, '0'), 1, 1, 1, 2, 3 FROM generate_series(1, 5) AS n`,
      );

      assert.equal(await purge(pg), 5);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM learners")).rows[0].n, 600);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM learners WHERE id LIKE 'z-%'")).rows[0].n, 0);
    });

    test("a purge that has deleted everything eligible returns 0 and never fails, however many linked learners are expired", async () => {
      const pg = await fixture();
      await pg.reset();
      const l = await learner(pg);
      await link(pg, "account-1", l.id);
      await pg.query("UPDATE learners SET idle_expires_at = 2, absolute_expires_at = 3");
      assert.deepEqual([await purge(pg), await purge(pg), await purge(pg)], [0, 0, 0]);
    });
  });

  describe("concurrent purge workers", () => {
    test("four workers started at the same instant delete exactly the eligible learners, once each, and never a linked or live one", async () => {
      const pg = await fixture();
      await pg.reset();
      const live = await learner(pg, { progress: true });
      const linkedWithProgress = await learner(pg, { progress: true });
      await link(pg, "account-with-progress", linkedWithProgress.id);
      await setStanding(pg, linkedWithProgress.id, "past-grace");
      await pg.query(
        `INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at)
         SELECT 'bulk-' || lpad(n::text, 5, '0'), lpad(to_hex(n + 1000000), 64, '0'), 1, 1, 1, 2, 3 FROM generate_series(1, 3000) AS n`,
      );
      await pg.query(
        `INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at)
         SELECT 'linked-bulk-' || lpad(n::text, 4, '0'), lpad(to_hex(n + 7000000), 64, '0'), 1, 1, 1, 2, 3 FROM generate_series(1, 300) AS n`,
      );
      await pg.query("INSERT INTO account_learner_links SELECT 'acct-' || id, id, 1 FROM learners WHERE id LIKE 'linked-bulk-%'");
      const protectedIds = [live.id, linkedWithProgress.id];
      const before = await dumpOf(pg, protectedIds);

      const pools = [1, 2, 3, 4].map(() => pg.newPool(4));
      await Promise.all(pools.map((pool) => warm(pool, 4)));
      const counts = fulfilled(
        await stampede(pools[0], "LOCK TABLE learners IN EXCLUSIVE MODE", [], () =>
          pools.map((pool) => purgeExpiredExcludingLinked(pool)),
        ),
      );

      assert.equal(counts.reduce((sum, n) => sum + n, 0), 3000, "every eligible learner counted exactly once across the workers");
      const left = await survivors(pg);
      assert.equal(left.size, 2 + 300, "the live learner, the linked learner with progress and 300 linked learners remain");
      assert.equal(await dumpOf(pg, protectedIds), before, "progress untouched");
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners WHERE id LIKE 'bulk-%'")).rows[0].n, 0);
    });
  });

  describe("a purge racing a link", () => {
    test("whatever the interleaving, a learner is either linked and intact or purged and unlinked, never both and never half", async () => {
      const pg = await fixture();
      for (let round = 1; round <= 3; round += 1) {
        await pg.reset();
        // The two sides disagree about the time, which a real deployment cannot arrange (they share the database's clock) but
        // which is the harshest case: the linker sees every learner live while the purger sees every learner long expired.
        const linkerPool = pg.newPool(10);
        const purgerPools = [pg.newPool(4), pg.newPool(4), pg.newPool(4)];
        await Promise.all([warm(linkerPool), ...purgerPools.map((p) => warm(p, 4))]);
        const linker = new PostgresAccountLinkStore({ pool: linkerPool, now: () => START });
        const creator = pg.newStore({ now: () => START });
        const purgeNow = () => START + 100 * 24 * 3_600_000;

        const entries = await Promise.all(
          Array.from({ length: 40 }, async (_, i) => {
            const tokenHash = issueSessionToken().tokenHash;
            const created = await creator.create({ tokenHash });
            await creator.start({ learnerId: created.id, challengeId: "challenge-001", challengeVersion: "v1" });
            return { id: created.id, tokenHash, account: await verified(`race-${round}-${i}`) };
          }),
        );

        const settled = await stampede(linkerPool, "LOCK TABLE learners IN EXCLUSIVE MODE", [], () => [
          ...entries.map((e) => linker.linkBrowserLearner(e.account, { tokenHash: e.tokenHash, consent: true })),
          ...purgerPools.map((pool) => purgeExpiredExcludingLinked(pool, { now: purgeNow })),
        ] as Promise<unknown>[]);

        assert.ok(settled.every((s) => s.status === "fulfilled"), `no operation failed: ${settled.map((s) => (s.status === "rejected" ? String(s.reason) : "")).join("")}`);
        const links = new Set((await pg.query<{ learner_id: string }>("SELECT learner_id FROM account_learner_links")).rows.map((r) => r.learner_id));
        const left = await survivors(pg);
        for (const { id } of entries) {
          const linked = links.has(id);
          const exists = left.has(id);
          assert.ok(linked ? exists : !exists, `learner ${id}: linked=${linked} exists=${exists}`);
          const sessions = (await pg.query("SELECT count(*)::int AS n FROM challenge_sessions WHERE learner_id = $1", [id])).rows[0].n;
          assert.equal(sessions, exists ? 1 : 0, "a surviving learner keeps its session; a purged one leaves none behind");
        }
      }
    });
  });
});
