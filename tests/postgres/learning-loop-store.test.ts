/*
 * PostgresLearningLoopStore against the SAME contract MemoryLearningLoopStore passes (tests/learning-loop/store-contract.ts),
 * plus what only a real database can show: ownership foreign keys, durability across store instances and pools,
 * and atomic revision checks under real concurrency.
 *
 * Schema: core 0001 + 0002, then 0004 applied with exclude: [0003_account_links] (never 0003), in a throwaway database per test file.
 * Nothing touches a shared database and nothing here is wired into getAppServices().
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, describe, test } from "node:test";
import pg from "pg";
import { completionSourceId, KIND_RANK } from "../../src/server/learning-loop/derive";
import {
  createPostgresLearningLoopStore,
  PostgresLearningLoopStore,
} from "../../src/server/learning-loop/postgres-store";
import { LearningLoopStoreError, type CreateReflectionInput } from "../../src/server/learning-loop/types";
import { ids, runLearningLoopStoreContract, type LearningLoopHarness } from "../learning-loop/store-contract";
import { createTestDatabase, ensureTestPgcrypto, SKIP, type TestDatabase } from "./helpers";

const REFLECTIONS = "0004_learning_reflections";
let pending: Promise<{ db: TestDatabase; pool: pg.Pool }> | undefined;
const extraPools: pg.Pool[] = [];

after(async () => {
  if (!pending) return;
  const { db, pool } = await pending;
  await Promise.all([pool, ...extraPools].filter((p) => !p.ended).map((p) => p.end()));
  await db.drop();
});

/** One database per file: 0001, 0002, then 0004 (never 0003), plus test-only pgcrypto provisioning. */
function fixture() {
  pending ??= (async () => {
    const db = await createTestDatabase({ through: REFLECTIONS, exclude: ["0003_account_links"] });
    const pool = new pg.Pool({ connectionString: db.url, max: 20 });
    pool.on("error", () => {});
    await ensureTestPgcrypto(pool);
    return { db, pool };
  })();
  return pending;
}

/** Same SQL expression as PostgresLearningLoopStore.listActivity uses for completion source ids. */
async function pgCompletionSourceId(pool: pg.Pool, sessionId: string): Promise<string> {
  const { rows } = await pool.query<{ source_id: string }>(
    `SELECT 'cmp_' || substr(rtrim(translate(encode(digest('learning-loop:challenge.completed:' || s.id, 'sha256'), 'base64'), '+/', '-_'), '='), 1, 32) AS source_id
       FROM (SELECT $1::text AS id) AS s`,
    [sessionId],
  );
  return rows[0]!.source_id;
}
const rand = () => randomBytes(6).toString("hex");

async function seedLearner(pool: pg.Pool): Promise<string> {
  const id = `lrn-${rand()}`;
  await pool.query(
    `INSERT INTO learners (id, token_hash, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, 1, 1, 1, 10, 10)`,
    [id, randomBytes(32).toString("hex")],
  );
  return id;
}

async function seedSession(
  pool: pg.Pool,
  learnerId: string,
  challengeId: string,
  status: "active" | "completed" = "completed",
): Promise<string> {
  const id = `ses-${rand()}`;
  if (status === "completed") {
    await pool.query(
      `INSERT INTO challenge_sessions
         (id, learner_id, challenge_id, challenge_version, status, created_at, updated_at, completed_at, result)
       VALUES ($1, $2, $3, 'v1', 'completed', 1, 2, 2, '{"ok":true}'::jsonb)`,
      [id, learnerId, challengeId],
    );
  } else {
    await pool.query(
      `INSERT INTO challenge_sessions (id, learner_id, challenge_id, challenge_version, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'v1', 'active', 1, 1)`,
      [id, learnerId, challengeId],
    );
  }
  return id;
}

async function harness(): Promise<LearningLoopHarness & { pool: pg.Pool; store: PostgresLearningLoopStore }> {
  const { pool } = await fixture();
  await pool.query("TRUNCATE learners CASCADE");
  // A completed session is permanent and current (never superseded), so a learner has exactly one per challenge.
  const sessions = new Map<string, Promise<string>>();
  return {
    pool,
    store: await createPostgresLearningLoopStore({ pool }),
    learner: () => seedLearner(pool),
    session(learnerId, challengeId) {
      const key = `${learnerId}/${challengeId}`;
      if (!sessions.has(key)) sessions.set(key, seedSession(pool, learnerId, challengeId));
      return sessions.get(key)!;
    },
  };
}

async function seedCompletedAt(
  pool: pg.Pool,
  learnerId: string,
  challengeId: string,
  completedAt: number,
): Promise<string> {
  const id = `ses-${rand()}`;
  await pool.query(
    `INSERT INTO challenge_sessions
       (id, learner_id, challenge_id, challenge_version, status, created_at, updated_at, completed_at, result)
     VALUES ($1, $2, $3, 'v1', 'completed', $4, $4, $4, '{"ok":true}'::jsonb)`,
    [id, learnerId, challengeId, completedAt],
  );
  return id;
}

const base = (over: Partial<CreateReflectionInput> & Pick<CreateReflectionInput, "learnerId" | "challengeId" | "challengeSessionId">): CreateReflectionInput => ({
  body: "thoughts",
  completedAt: 500,
  now: 1000,
  newId: ids("pg"),
  ...over,
});

if (SKIP) {
  describe("PostgresLearningLoopStore (real PostgreSQL)", { skip: SKIP }, () => {
    test("skipped: no database", () => {});
  });
} else {
  runLearningLoopStoreContract("PostgresLearningLoopStore", harness);

  describe("PostgresLearningLoopStore: database-only behavior", () => {
    test("create rejects a session of another learner, another challenge, a missing session or an unfinished session", async () => {
      const h = await harness();
      const [owner, other] = [await h.learner(), await h.learner()];
      const owned = await h.session(owner, "C1");
      const unfinished = await seedSession(h.pool, owner, "C2", "active");

      const attempts: Array<[string, Pick<CreateReflectionInput, "learnerId" | "challengeId" | "challengeSessionId">]> = [
        ["foreign learner", { learnerId: other, challengeId: "C1", challengeSessionId: owned }],
        ["wrong challenge", { learnerId: owner, challengeId: "C9", challengeSessionId: owned }],
        ["missing session", { learnerId: owner, challengeId: "C1", challengeSessionId: "no-such-session" }],
        ["not completed", { learnerId: owner, challengeId: "C2", challengeSessionId: unfinished }],
        ["unknown learner", { learnerId: "no-such-learner", challengeId: "C1", challengeSessionId: owned }],
      ];
      for (const [label, over] of attempts) {
        await assert.rejects(
          h.store.createReflection(base(over)),
          (e: unknown) => e instanceof LearningLoopStoreError && e.code === "invalid-input",
          label,
        );
      }
      assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM learning_reflections")).rows[0].n, 0);
      // The failures did not consume or poison anything: the legitimate link still works.
      await h.store.createReflection(base({ learnerId: owner, challengeId: "C1", challengeSessionId: owned }));
    });

    test("the database foreign key itself rejects a non-owned link, whatever the adapter does", async () => {
      const h = await harness();
      const [owner, other] = [await h.learner(), await h.learner()];
      const owned = await h.session(owner, "C1");
      await assert.rejects(
        h.pool.query(
          `INSERT INTO learning_reflections (id, learner_id, challenge_id, challenge_session_id, body, created_at, updated_at, completed_at)
           VALUES ('raw-1', $1, 'C1', $2, 'x', 1, 1, 2)`,
          [other, owned],
        ),
        (e: unknown) => (e as { code?: string }).code === "23503",
      );
    });

    test("a generated id collision is an invalid-input, not a reflection-already-exists", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      const first = await h.store.createReflection(
        base({ learnerId, challengeId: "C1", challengeSessionId: await h.session(learnerId, "C1"), newId: () => "dup-id" }),
      );
      await assert.rejects(
        h.store.createReflection(
          base({ learnerId, challengeId: "C2", challengeSessionId: await h.session(learnerId, "C2"), newId: () => first.id }),
        ),
        (e: unknown) => e instanceof LearningLoopStoreError && e.code === "invalid-input",
      );
    });

    test("a body with a NUL character (which PostgreSQL text cannot hold) is validation-failed", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      await assert.rejects(
        h.store.createReflection(
          base({ learnerId, challengeId: "C1", challengeSessionId: await h.session(learnerId, "C1"), body: "a\u0000b" }),
        ),
        (e: unknown) => e instanceof LearningLoopStoreError && e.code === "validation-failed",
      );
    });

    test("multi-byte text round-trips, and the stored columns hold milliseconds as numbers", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      const created = await h.store.createReflection(
        base({
          learnerId,
          challengeId: "C1",
          challengeSessionId: await h.session(learnerId, "C1"),
          body: " 日本語 — é ",
          now: 1_800_000_000_123,
          completedAt: 1_799_999_999_000,
        }),
      );
      assert.equal(created.body, "日本語 — é");
      assert.equal(created.createdAt, 1_800_000_000_123);
      assert.equal(created.completedAt, 1_799_999_999_000);
      assert.equal(typeof created.createdAt, "number");
      const fetched = await h.store.getActiveReflection(learnerId, created.id);
      assert.deepEqual(fetched, created);
    });

    test("state is durable and shared: a second store on a different pool sees and edits the same rows", async () => {
      const h = await harness();
      const { db } = await fixture();
      const pool2 = new pg.Pool({ connectionString: db.url, max: 5 });
      pool2.on("error", () => {});
      extraPools.push(pool2);
      const second = new PostgresLearningLoopStore({ pool: pool2 });

      const learnerId = await h.learner();
      const created = await h.store.createReflection(
        base({ learnerId, challengeId: "C1", challengeSessionId: await h.session(learnerId, "C1") }),
      );
      assert.deepEqual(await second.getActiveReflection(learnerId, created.id), created);
      const updated = await second.updateReflection({ learnerId, reflectionId: created.id, body: "from b", revision: 1, now: 2000 });
      assert.equal((await h.store.getActiveReflection(learnerId, created.id))?.revision, updated.revision);
      await assert.rejects(
        h.store.updateReflection({ learnerId, reflectionId: created.id, body: "from a", revision: 1, now: 2001 }),
        (e: unknown) => e instanceof LearningLoopStoreError && e.code === "revision-conflict" && e.currentRevision === 2,
      );
      await pool2.end();
    });

    test("racing creates across two stores on separate pools: still exactly one winner", async () => {
      const h = await harness();
      const { db } = await fixture();
      const pool2 = new pg.Pool({ connectionString: db.url, max: 5 });
      pool2.on("error", () => {});
      extraPools.push(pool2);
      const stores = [h.store, new PostgresLearningLoopStore({ pool: pool2 })];
      const learnerId = await h.learner();
      const challengeSessionId = await h.session(learnerId, "C1");
      const results = await Promise.allSettled(
        [0, 1, 2, 3, 4, 5].map((i) =>
          stores[i % 2].createReflection(base({ learnerId, challengeId: "C1", challengeSessionId, newId: () => `race-${i}` })),
        ),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM learning_reflections WHERE deleted_at IS NULL")).rows[0].n, 1);
      await pool2.end();
    });

    test("a revision above INTEGER range is revision-conflict with currentRevision, not a raw driver error", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      const created = await h.store.createReflection(
        base({ learnerId, challengeId: "C1", challengeSessionId: await h.session(learnerId, "C1") }),
      );
      const huge = 3_000_000_000;
      await assert.rejects(
        h.store.updateReflection({ learnerId, reflectionId: created.id, body: "x", revision: huge, now: 2000 }),
        (e: unknown) =>
          e instanceof LearningLoopStoreError && e.code === "revision-conflict" && e.currentRevision === created.revision,
      );
      assert.equal((await h.store.getActiveReflection(learnerId, created.id))?.revision, 1);
    });

    test("revision conflicts report the current revision after several edits", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      const created = await h.store.createReflection(
        base({ learnerId, challengeId: "C1", challengeSessionId: await h.session(learnerId, "C1") }),
      );
      let revision = created.revision;
      for (let i = 0; i < 3; i += 1) {
        revision = (await h.store.updateReflection({ learnerId, reflectionId: created.id, body: `e${i}`, revision, now: 2000 + i })).revision;
      }
      assert.equal(revision, 4);
      await assert.rejects(
        h.store.softDeleteReflection({ learnerId, reflectionId: created.id, revision: 1, now: 9000 }),
        (e: unknown) => e instanceof LearningLoopStoreError && e.code === "revision-conflict" && e.currentRevision === 4,
      );
    });

    test("soft delete keeps the row (and its session link) for the database; deleting the learner removes it", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      const created = await h.store.createReflection(
        base({ learnerId, challengeId: "C1", challengeSessionId: await h.session(learnerId, "C1") }),
      );
      await h.store.softDeleteReflection({ learnerId, reflectionId: created.id, revision: 1, now: 3000 });
      const row = (await h.pool.query("SELECT deleted_at, revision, body FROM learning_reflections WHERE id = $1", [created.id])).rows[0];
      assert.equal(row.deleted_at, "3000");
      assert.equal(row.revision, 1);
      await h.pool.query("DELETE FROM learners WHERE id = $1", [learnerId]);
      assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM learning_reflections")).rows[0].n, 0);
    });

    test("soft delete clamps deleted_at to created_at when server clock is behind create time", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      const created = await h.store.createReflection(
        base({ learnerId, challengeId: "C1", challengeSessionId: await h.session(learnerId, "C1"), now: 5000 }),
      );
      const deleted = await h.store.softDeleteReflection({ learnerId, reflectionId: created.id, revision: 1, now: 4000 });
      assert.equal(deleted.deletedAt, 5000);
      assert.equal(await h.store.getActiveReflection(learnerId, created.id), null);
    });
  });

  describe("PostgresLearningLoopStore: store-level activity pagination", () => {
    test("merges completions and reflections with occurredAt DESC, kindRank ASC, sourceId ASC", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      const s1 = await seedCompletedAt(h.pool, learnerId, "C1", 1000);
      const s2 = await seedCompletedAt(h.pool, learnerId, "C2", 2000);
      const r1 = await h.store.createReflection(
        base({ learnerId, challengeId: "C1", challengeSessionId: s1, now: 2000, completedAt: 1000, newId: () => "refl-a" }),
      );
      const r2 = await h.store.createReflection(
        base({ learnerId, challengeId: "C2", challengeSessionId: s2, now: 3000, completedAt: 2000, body: "later", newId: () => "refl-b" }),
      );

      const rows = await h.store.listActivity!(learnerId);
      assert.deepEqual(
        rows.map((row) => `${row.kind}:${row.challengeId}:${row.sourceId}`),
        [
          `reflection.updated:C2:${r2.id}`,
          `challenge.completed:C2:${completionSourceId(s2)}`,
          `reflection.updated:C1:${r1.id}`,
          `challenge.completed:C1:${completionSourceId(s1)}`,
        ],
      );
      assert.equal(rows[0]!.body, "later");
      assert.equal(rows[1]!.body, undefined);
    });

    test("tied timestamps use kindRank then sourceId; pages have no duplicates or skips", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      const sessionIds: string[] = [];
      const reflectionIds: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const challengeId = `C${i}`;
        const sessionId = await seedCompletedAt(h.pool, learnerId, challengeId, 5000);
        sessionIds.push(sessionId);
        const reflection = await h.store.createReflection(
          base({
            learnerId,
            challengeId,
            challengeSessionId: sessionId,
            now: 5000,
            completedAt: 5000,
            newId: () => `refl-${String(i).padStart(2, "0")}`,
          }),
        );
        reflectionIds.push(reflection.id);
      }

      const full = await h.store.listActivity!(learnerId);
      assert.equal(full.length, 12);
      // At one timestamp: all completions (rank 10) before all reflections (rank 40), each group by sourceId ASC.
      const completionSources = sessionIds.map(completionSourceId).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const reflectionSources = [...reflectionIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      assert.deepEqual(
        full.map((row) => row.sourceId),
        [...completionSources, ...reflectionSources],
      );
      assert.ok(full.every((row) => row.occurredAt === 5000));
      assert.equal(full[0]!.kind, "challenge.completed");
      assert.equal(KIND_RANK[full[0]!.kind], 10);

      const keyOf = (row: { kind: string; sourceId: string }) => `${row.kind}/${row.sourceId}`;
      const expected = full.map(keyOf);
      for (const limit of [1, 2, 5, 7, 12]) {
        const seen: string[] = [];
        let after: { occurredAt: number; kindRank: number; sourceId: string } | undefined;
        let guard = 0;
        for (;;) {
          const page = await h.store.listActivity!(learnerId, {
            limit,
            ...(after ? { after } : {}),
          });
          assert.ok(page.length <= limit);
          seen.push(...page.map(keyOf));
          if (page.length < limit) break;
          const last = page[page.length - 1]!;
          after = {
            occurredAt: last.occurredAt,
            kindRank: KIND_RANK[last.kind],
            sourceId: last.sourceId,
          };
          assert.ok(++guard < 50);
        }
        assert.deepEqual(seen, expected, `limit ${limit}: no duplicates, none skipped`);
      }
    });

    test("kind filters, empty results, and soft-deleted reflections stay out of the feed", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      const sessionId = await seedCompletedAt(h.pool, learnerId, "C1", 100);
      const reflection = await h.store.createReflection(
        base({ learnerId, challengeId: "C1", challengeSessionId: sessionId, now: 200, completedAt: 100 }),
      );

      assert.deepEqual(
        (await h.store.listActivity!(learnerId, { includeCompletions: true, includeReflections: false })).map((r) => r.kind),
        ["challenge.completed"],
      );
      assert.deepEqual(
        (await h.store.listActivity!(learnerId, { includeCompletions: false, includeReflections: true })).map((r) => r.kind),
        ["reflection.updated"],
      );
      assert.deepEqual(await h.store.listActivity!(learnerId, { includeCompletions: false, includeReflections: false }), []);

      await h.store.softDeleteReflection({ learnerId, reflectionId: reflection.id, revision: 1, now: 300 });
      assert.deepEqual(
        (await h.store.listActivity!(learnerId)).map((r) => r.kind),
        ["challenge.completed"],
      );

      const other = await h.learner();
      assert.deepEqual(await h.store.listActivity!(other), []);
    });

    test("unfinished and superseded sessions never appear; completion source ids match Node digests", async () => {
      const h = await harness();
      const learnerId = await h.learner();
      const live = await seedCompletedAt(h.pool, learnerId, "C1", 10);
      await seedSession(h.pool, learnerId, "C2", "active");
      // Completed sessions cannot be superseded (0001 check). A superseded row is an unfinished restart leftover.
      const old = await seedSession(h.pool, learnerId, "C3", "active");
      await h.pool.query("UPDATE challenge_sessions SET superseded_at = 9 WHERE id = $1", [old]);
      await seedCompletedAt(h.pool, learnerId, "C3", 8);

      const rows = await h.store.listActivity!(learnerId, { includeReflections: false });
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((row) => row.challengeId).sort(),
        ["C1", "C3"],
      );
      assert.equal(rows.find((row) => row.challengeId === "C1")!.sourceId, completionSourceId(live));
      assert.ok(!rows.some((row) => row.sourceId === completionSourceId(old)));
    });

    test("completion source ids: Node completionSourceId matches PostgreSQL activity digest expression", async () => {
      const { pool } = await fixture();
      // Empty session ids are rejected by challenge_sessions CHECK (length BETWEEN 1 AND 128);
      // still compare the shared SQL expression to Node for the empty string.
      assert.equal(await pgCompletionSourceId(pool, ""), completionSourceId(""));

      const cases = [
        { label: "ASCII", id: "ses-ascii-01" },
        { label: "Japanese", id: "ses-日本語メモ" },
        { label: "emoji", id: "ses-😀🚀" },
        { label: "128-char boundary", id: `ses-${"b".repeat(124)}` },
      ];
      assert.equal(cases[3]!.id.length, 128);

      const h = await harness();
      const learnerId = await h.learner();
      for (const [i, c] of cases.entries()) {
        assert.equal(await pgCompletionSourceId(pool, c.id), completionSourceId(c.id), `${c.label}: expression`);
        await pool.query(
          `INSERT INTO challenge_sessions
             (id, learner_id, challenge_id, challenge_version, status, created_at, updated_at, completed_at, result)
           VALUES ($1, $2, $3, 'v1', 'completed', 1, 2, $4, '{"ok":true}'::jsonb)`,
          [c.id, learnerId, `chal-${i}`, 1000 + i],
        );
      }

      const rows = await h.store.listActivity!(learnerId, { includeReflections: false });
      assert.equal(rows.length, cases.length);
      for (const c of cases) {
        const row = rows.find((r) => r.sourceId === completionSourceId(c.id));
        assert.ok(row, `${c.label}: present in listActivity`);
        assert.equal(row.sourceId, await pgCompletionSourceId(pool, c.id), `${c.label}: listActivity`);
      }
    });
  });
}
