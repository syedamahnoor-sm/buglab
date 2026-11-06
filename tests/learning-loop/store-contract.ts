/*
 * The LearningLoopStore contract, run unchanged against every implementation (MemoryLearningLoopStore in
 * tests/learning-loop/memory-store.test.ts, PostgresLearningLoopStore in tests/postgres/learning-loop-store.test.ts).
 * Not a test file itself (no `.test.ts` suffix), so the runner does not execute it.
 *
 * A harness supplies the store plus the way to obtain a learner and a (completed) session for it. The memory
 * store needs only opaque ids; PostgreSQL needs real rows because of the ownership foreign key.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LearningLoopStoreError, type LearningLoopStore } from "../../src/server/learning-loop/types";

export interface LearningLoopHarness {
  store: LearningLoopStore;
  /** A new learner id that the store accepts. */
  learner(): Promise<string>;
  /** The completed session of `challengeId` that belongs to `learnerId`. Stable: a learner has one per challenge. */
  session(learnerId: string, challengeId: string): Promise<string>;
}

export function ids(prefix = "r") {
  let n = 0;
  return () => `${prefix}${++n}`;
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof LearningLoopStoreError && e.code === code);
}

export function runLearningLoopStoreContract(name: string, make: () => Promise<LearningLoopHarness>): void {
  /** Builds create input for `learnerId`/`challengeId` with its own completed session. */
  async function input(
    h: LearningLoopHarness,
    newId: () => string,
    learnerId: string,
    challengeId: string,
    over: Record<string, unknown> = {},
  ) {
    return {
      learnerId,
      challengeId,
      challengeSessionId: await h.session(learnerId, challengeId),
      body: "  first thoughts  ",
      completedAt: 500,
      now: 1000,
      newId,
      ...over,
    };
  }

  describe(`LearningLoopStore contract: ${name}`, () => {
    test("create succeeds with normalized body; second active create conflicts", async () => {
      const h = await make();
      const { store } = h;
      const newId = ids();
      const [L1, L2] = [await h.learner(), await h.learner()];
      const created = await store.createReflection(await input(h, newId, L1, "C1"));
      assert.equal(created.id, "r1");
      assert.equal(created.learnerId, L1);
      assert.equal(created.challengeId, "C1");
      assert.equal(created.body, "first thoughts");
      assert.equal(created.revision, 1);
      assert.equal(created.createdAt, 1000);
      assert.equal(created.updatedAt, 1000);
      assert.equal(created.deletedAt, null);
      assert.equal(created.completedAt, 500);

      await assert.rejects(
        store.createReflection(await input(h, newId, L1, "C1", { now: 2000 })),
        (e: unknown) =>
          e instanceof LearningLoopStoreError &&
          e.code === "reflection-already-exists" &&
          e.existingReflectionId === "r1",
      );
      // Different challenge / learner are independent.
      await store.createReflection(await input(h, newId, L1, "C2"));
      await store.createReflection(await input(h, newId, L2, "C1"));
    });

    test("create rejects invalid body", async () => {
      const h = await make();
      const L1 = await h.learner();
      await rejectsWith(h.store.createReflection(await input(h, ids(), L1, "C1", { body: "   " })), "validation-failed");
      await rejectsWith(
        h.store.createReflection(await input(h, ids(), L1, "C1", { body: "x".repeat(16385) })),
        "validation-failed",
      );
      assert.deepEqual(await h.store.listActiveReflections(L1), []);
    });

    test("body at the 16 KiB limit round-trips; inner newlines are preserved", async () => {
      const h = await make();
      const L1 = await h.learner();
      const big = await h.store.createReflection(await input(h, ids(), L1, "C1", { body: "x".repeat(16384) }));
      assert.equal(big.body.length, 16384);
      const multi = await h.store.createReflection(await input(h, ids("m"), L1, "C2", { body: "\n a\n\nb \n" }));
      assert.equal(multi.body, "a\n\nb");
      assert.equal((await h.store.getActiveReflection(L1, multi.id))?.body, "a\n\nb");
    });

    test("soft-delete then recreate yields new id and revision 1", async () => {
      const h = await make();
      const { store } = h;
      const newId = ids();
      const L1 = await h.learner();
      const first = await store.createReflection(await input(h, newId, L1, "C1"));
      await store.softDeleteReflection({ learnerId: L1, reflectionId: first.id, revision: 1, now: 2000 });
      const second = await store.createReflection(await input(h, newId, L1, "C1", { now: 3000, body: "again" }));
      assert.notEqual(second.id, first.id);
      assert.equal(second.revision, 1);
      assert.equal(second.body, "again");
      assert.equal((await store.listActiveReflections(L1)).length, 1);
    });

    test("PATCH with stale revision conflicts and does not mutate", async () => {
      const h = await make();
      const { store } = h;
      const L1 = await h.learner();
      const created = await store.createReflection(await input(h, ids(), L1, "C1"));
      const updated = await store.updateReflection({
        learnerId: L1, reflectionId: created.id, body: " v2 ", revision: 1, now: 2000,
      });
      assert.equal(updated.revision, 2);
      assert.equal(updated.body, "v2");
      assert.equal(updated.updatedAt, 2000);
      assert.equal(updated.createdAt, 1000);
      assert.equal(updated.completedAt, 500);
      assert.equal(updated.challengeSessionId, created.challengeSessionId);

      await assert.rejects(
        store.updateReflection({ learnerId: L1, reflectionId: created.id, body: "stale", revision: 1, now: 3000 }),
        (e: unknown) =>
          e instanceof LearningLoopStoreError && e.code === "revision-conflict" && e.currentRevision === 2,
      );
      const after = await store.getActiveReflection(L1, created.id);
      assert.equal(after?.body, "v2");
      assert.equal(after?.revision, 2);
      assert.equal(after?.updatedAt, 2000);
    });

    test("PATCH validates body, ownership and existence", async () => {
      const h = await make();
      const { store } = h;
      const [L1, L2] = [await h.learner(), await h.learner()];
      const created = await store.createReflection(await input(h, ids(), L1, "C1"));
      await rejectsWith(
        store.updateReflection({ learnerId: L1, reflectionId: created.id, body: " ", revision: 1, now: 2 }),
        "validation-failed",
      );
      await rejectsWith(
        store.updateReflection({ learnerId: L2, reflectionId: created.id, body: "x", revision: 1, now: 2 }),
        "not-found",
      );
      await rejectsWith(
        store.updateReflection({ learnerId: L1, reflectionId: "nope", body: "x", revision: 1, now: 2 }),
        "not-found",
      );
      const stored = await store.getActiveReflection(L1, created.id);
      assert.equal(stored?.revision, 1);
      assert.equal(stored?.body, "first thoughts");
    });

    test("PATCH on a soft-deleted reflection is not-found, even with the right revision", async () => {
      const h = await make();
      const L1 = await h.learner();
      const created = await h.store.createReflection(await input(h, ids(), L1, "C1"));
      await h.store.softDeleteReflection({ learnerId: L1, reflectionId: created.id, revision: 1, now: 2000 });
      await rejectsWith(
        h.store.updateReflection({ learnerId: L1, reflectionId: created.id, body: "x", revision: 1, now: 3000 }),
        "not-found",
      );
    });

    test("DELETE with matching revision soft-deletes; revision and updatedAt unchanged", async () => {
      const h = await make();
      const { store } = h;
      const L1 = await h.learner();
      const created = await store.createReflection(await input(h, ids(), L1, "C1"));
      const deleted = await store.softDeleteReflection({
        learnerId: L1, reflectionId: created.id, revision: 1, now: 5000,
      });
      assert.equal(deleted.revision, 1);
      assert.equal(deleted.updatedAt, 1000);
      assert.equal(deleted.deletedAt, 5000);

      // Second delete -> not-found, not 200.
      await rejectsWith(
        store.softDeleteReflection({ learnerId: L1, reflectionId: created.id, revision: 1, now: 6000 }),
        "not-found",
      );
    });

    test("DELETE with stale revision conflicts and does not delete; foreign learner is not-found", async () => {
      const h = await make();
      const { store } = h;
      const [L1, L2] = [await h.learner(), await h.learner()];
      const created = await store.createReflection(await input(h, ids(), L1, "C1"));
      await assert.rejects(
        store.softDeleteReflection({ learnerId: L1, reflectionId: created.id, revision: 9, now: 5000 }),
        (e: unknown) =>
          e instanceof LearningLoopStoreError && e.code === "revision-conflict" && e.currentRevision === 1,
      );
      await rejectsWith(
        store.softDeleteReflection({ learnerId: L2, reflectionId: created.id, revision: 1, now: 5000 }),
        "not-found",
      );
      assert.equal((await store.getActiveReflection(L1, created.id))?.deletedAt, null);
    });

    test("GET and list exclude soft-deleted and other learners", async () => {
      const h = await make();
      const { store } = h;
      const newId = ids();
      const [L1, L2] = [await h.learner(), await h.learner()];
      const a = await store.createReflection(await input(h, newId, L1, "C1"));
      const b = await store.createReflection(await input(h, newId, L1, "C2", { now: 1100 }));
      await store.createReflection(await input(h, newId, L2, "C1"));

      assert.deepEqual((await store.listActiveReflections(L1)).map((r) => r.id).sort(), [a.id, b.id].sort());
      assert.deepEqual((await store.listActiveReflections(L1, { challengeId: "C2" })).map((r) => r.id), [b.id]);
      assert.equal(await store.getActiveReflection(L2, a.id), null);

      await store.softDeleteReflection({ learnerId: L1, reflectionId: a.id, revision: 1, now: 2000 });
      assert.equal(await store.getActiveReflection(L1, a.id), null);
      assert.deepEqual((await store.listActiveReflections(L1)).map((r) => r.id), [b.id]);
      assert.deepEqual(await store.listActiveReflections(L1, { challengeId: "C1" }), []);
    });

    test("list is in journal order and pages by keyset: updatedAt DESC, challengeId ASC, id ASC", async () => {
      const h = await make();
      const { store } = h;
      const L1 = await h.learner();
      const L2 = await h.learner();
      const made: Record<string, string> = {};
      // Ties on updatedAt are broken by challengeId (code-unit order: "B1" < "a1"), then by id.
      const plan: Array<[string, number]> = [["a1", 1000], ["B1", 1000], ["c1", 3000], ["d1", 2000], ["e1", 2000], ["f1", 2000]];
      for (const [challengeId, now] of plan) {
        made[challengeId] = (await store.createReflection(await input(h, ids(`r-${challengeId}-`), L1, challengeId, { now }))).id;
      }
      await store.createReflection(await input(h, ids("other"), L2, "c1", { now: 9999 }));
      const order = ["c1", "d1", "e1", "f1", "B1", "a1"];
      const all = await store.listActiveReflections(L1);
      assert.deepEqual(all.map((r) => r.challengeId), order);

      // Limit alone.
      assert.deepEqual((await store.listActiveReflections(L1, { limit: 2 })).map((r) => r.challengeId), order.slice(0, 2));
      // Walk by every page size: each row exactly once, in order, never another learner's.
      for (const limit of [1, 2, 4, 6, 9]) {
        const seen: string[] = [];
        let after: { updatedAt: number; challengeId: string; id: string } | undefined;
        for (let guard = 0; guard < 20; guard += 1) {
          const page = await store.listActiveReflections(L1, after ? { limit, after } : { limit });
          assert.ok(page.length <= limit);
          if (page.length === 0) break;
          seen.push(...page.map((r) => r.challengeId));
          const last = page[page.length - 1]!;
          after = { updatedAt: last.updatedAt, challengeId: last.challengeId, id: last.id };
        }
        assert.deepEqual(seen, order, `limit ${limit}`);
      }
      // A cursor on a row that has since been deleted still continues strictly after its position.
      const c1 = all[0]!;
      await store.softDeleteReflection({ learnerId: L1, reflectionId: c1.id, revision: 1, now: 4000 });
      const rest = await store.listActiveReflections(L1, {
        after: { updatedAt: c1.updatedAt, challengeId: c1.challengeId, id: c1.id },
      });
      assert.deepEqual(rest.map((r) => r.challengeId), order.slice(1));
      // The challenge filter composes with the page.
      assert.deepEqual(
        await store.listActiveReflections(L1, { challengeId: "d1", after: { updatedAt: 1000, challengeId: "a", id: "a" } }),
        [],
        "d1 (updatedAt 2000) sorts before any position at updatedAt 1000",
      );
      assert.deepEqual((await store.listActiveReflections(L1, { challengeId: "d1", limit: 5 })).map((r) => r.id), [made["d1"]]);
    });

    test("list rejects a limit that is not a positive integer", async () => {
      const h = await make();
      const L1 = await h.learner();
      for (const limit of [0, -1, 1.5, Number.NaN]) {
        await rejectsWith(h.store.listActiveReflections(L1, { limit }), "invalid-input");
      }
    });

    test("soft delete never records a time before the row's own creation (deletedAt = max(now, createdAt))", async () => {
      const h = await make();
      const L1 = await h.learner();
      const created = await h.store.createReflection(await input(h, ids(), L1, "C1", { now: 5000 }));
      const deleted = await h.store.softDeleteReflection({ learnerId: L1, reflectionId: created.id, revision: 1, now: 4000 });
      assert.equal(deleted.deletedAt, 5000);
      const later = await h.store.createReflection(await input(h, ids("x"), L1, "C2", { now: 5000 }));
      assert.equal((await h.store.softDeleteReflection({ learnerId: L1, reflectionId: later.id, revision: 1, now: 7000 })).deletedAt, 7000);
    });

    test("returned records are copies; callers cannot mutate store state", async () => {
      const h = await make();
      const L1 = await h.learner();
      const created = await h.store.createReflection(await input(h, ids(), L1, "C1"));
      created.body = "tampered";
      const fetched = await h.store.getActiveReflection(L1, created.id);
      assert.equal(fetched?.body, "first thoughts");
    });

    test("racing creates for one learner and challenge: exactly one wins", async () => {
      const h = await make();
      const L1 = await h.learner();
      const newId = ids();
      const inputs = [];
      for (let i = 0; i < 5; i += 1) inputs.push(await input(h, newId, L1, "C1"));
      const results = await Promise.allSettled(inputs.map((i) => h.store.createReflection(i)));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) {
        if (r.status === "rejected") {
          assert.ok(r.reason instanceof LearningLoopStoreError && r.reason.code === "reflection-already-exists");
          assert.ok(r.reason.existingReflectionId);
        }
      }
      assert.equal((await h.store.listActiveReflections(L1, { challengeId: "C1" })).length, 1);
    });

    test("racing updates with one revision: exactly one wins, the rest conflict", async () => {
      const h = await make();
      const L1 = await h.learner();
      const created = await h.store.createReflection(await input(h, ids(), L1, "C1"));
      const results = await Promise.allSettled(
        [1, 2, 3, 4].map((n) =>
          h.store.updateReflection({ learnerId: L1, reflectionId: created.id, body: `v${n}`, revision: 1, now: 2000 + n }),
        ),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) {
        if (r.status === "rejected") {
          assert.ok(r.reason instanceof LearningLoopStoreError && r.reason.code === "revision-conflict");
          assert.equal(r.reason.currentRevision, 2);
        }
      }
      assert.equal((await h.store.getActiveReflection(L1, created.id))?.revision, 2);
    });

    test("racing update and delete on one revision: exactly one wins", async () => {
      const h = await make();
      const L1 = await h.learner();
      const created = await h.store.createReflection(await input(h, ids(), L1, "C1"));
      const results = await Promise.allSettled([
        h.store.updateReflection({ learnerId: L1, reflectionId: created.id, body: "edit", revision: 1, now: 2000 }),
        h.store.softDeleteReflection({ learnerId: L1, reflectionId: created.id, revision: 1, now: 2000 }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.ok(loser.reason instanceof LearningLoopStoreError);
      assert.ok(["revision-conflict", "not-found"].includes(loser.reason.code));
    });
  });
}
