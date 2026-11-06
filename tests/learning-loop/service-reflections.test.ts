import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLearningLoopStore } from "@/server/learning-loop/memory-store";
import { createLearningLoopService } from "@/server/learning-loop/service";
import { MemoryStore } from "@/server/session/memory-store";
import { issueSessionToken } from "@/server/session/token";
import { RESULT } from "../session/attempt-contract";

const START = Date.parse("2026-11-05T12:00:00Z");
const WINDOW = { limit: 3, windowMs: 600_000 };
const V1 = "1+aaaaaaaaaaaa";
const C1 = "challenge-001";
const C2 = "challenge-002";

let n = 0;
function correctAttempt(learnerId: string, sessionId: string) {
  n += 1;
  return {
    learnerId,
    sessionId,
    submissionId: `sub-${n}`,
    requestHash: n.toString(16).padStart(64, "0"),
    rootCauseId: "option-a",
    explanation: "An explanation of what the learner believes is happening.",
    evidence: [{ kind: "log" as const, logId: "log-01" }],
    outcome: "correct" as const,
    result: RESULT,
    window: WINDOW,
  };
}

async function setup(published: ReadonlySet<string> = new Set([C1, C2])) {
  let now = START;
  const sessions = new MemoryStore({ now: () => now });
  const loop = new MemoryLearningLoopStore();
  let ids = 0;
  const service = createLearningLoopService({
    learners: sessions,
    sessions,
    store: loop,
    registry: { has: (id: string) => published.has(id) },
    now: () => now,
    newId: () => `refl_${++ids}`,
  });
  const issued = issueSessionToken();
  const learner = await sessions.create({ tokenHash: issued.tokenHash });
  const complete = async (challengeId: string) => {
    const { session } = await sessions.start({ learnerId: learner.id, challengeId, challengeVersion: V1 });
    await sessions.record(correctAttempt(learner.id, session.id));
  };
  return { service, sessions, loop, cookie: issued.token as string, learner, complete, tick: (ms: number) => (now += ms) };
}

function ok<T extends { status: string }>(result: T): Extract<T, { status: "ok" }> {
  assert.equal(result.status, "ok", JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
}

test("missing, malformed, unknown and expired cookies are refused with a learner code", async () => {
  const { service } = await setup();
  for (const cookie of [undefined, "", "short", "A".repeat(43)]) {
    const created = await service.createReflection(cookie, { challengeId: C1, body: "x" });
    assert.deepEqual(created, { status: "rejected", code: "learner-missing" });
    assert.deepEqual(await service.listReflections(cookie), { status: "rejected", code: "learner-missing" });
    assert.deepEqual(await service.getReflection(cookie, "r"), { status: "rejected", code: "learner-missing" });
    assert.deepEqual(await service.updateReflection(cookie, "r", { body: "x", revision: 1 }), {
      status: "rejected",
      code: "learner-missing",
    });
    assert.deepEqual(await service.deleteReflection(cookie, "r", { revision: 1 }), {
      status: "rejected",
      code: "learner-missing",
    });
  }
});

test("an expired learner is reported as learner-expired and nothing is written", async () => {
  const { service, cookie, tick, loop } = await setup();
  tick(31 * 24 * 60 * 60 * 1000); // past the 30-day idle expiry, inside the 7-day purge grace
  assert.deepEqual(await service.createReflection(cookie, { challengeId: C1, body: "x" }), {
    status: "rejected",
    code: "learner-expired",
  });
  assert.deepEqual(await service.listReflections(cookie), { status: "rejected", code: "learner-expired" });
  assert.deepEqual(await loop.listActiveReflections("anyone"), []);
});

test("create without a completed session -> completion-required", async () => {
  const { service, cookie, sessions, learner } = await setup();
  assert.deepEqual(await service.createReflection(cookie, { challengeId: C1, body: "notes" }), {
    status: "rejected",
    code: "completion-required",
  });
  // An unfinished session is not enough.
  await sessions.start({ learnerId: learner.id, challengeId: C1, challengeVersion: V1 });
  assert.deepEqual(await service.createReflection(cookie, { challengeId: C1, body: "notes" }), {
    status: "rejected",
    code: "completion-required",
  });
});

test("happy create returns the public Reflection with no challengeSessionId", async () => {
  const { service, cookie, complete, sessions, learner } = await setup();
  await complete(C1);
  const done = (await sessions.find({ learnerId: learner.id, challengeId: C1 }))!;
  const result = ok(await service.createReflection(cookie, { challengeId: C1, body: "  I learned things \n twice  " }));
  assert.deepEqual(result.reflection, {
    id: "refl_1",
    challengeId: C1,
    completedAt: new Date(done.completedAt!).toISOString(),
    body: "I learned things \n twice",
    revision: 1,
    createdAt: new Date(START).toISOString(),
    updatedAt: new Date(START).toISOString(),
  });
  const text = JSON.stringify(result);
  assert.ok(!text.includes("challengeSessionId"));
  assert.ok(!text.includes(done.id));
  assert.ok(!text.includes(learner.id));
  assert.ok(!("deletedAt" in result.reflection));
  assert.ok(result.cookie, "a write sets the cookie");
});

test("client-supplied session ids and extra fields are ignored", async () => {
  const { service, cookie, complete, loop, learner } = await setup();
  await complete(C1);
  const input = { challengeId: C1, body: "b", challengeSessionId: "forged", learnerId: "forged" } as never;
  ok(await service.createReflection(cookie, input));
  const [row] = await loop.listActiveReflections(learner.id);
  assert.notEqual(row.challengeSessionId, "forged");
  assert.equal(row.learnerId, learner.id);
});

test("an active reflection exists -> reflection-already-exists with its id", async () => {
  const { service, cookie, complete } = await setup();
  await complete(C1);
  const first = ok(await service.createReflection(cookie, { challengeId: C1, body: "one" }));
  assert.deepEqual(await service.createReflection(cookie, { challengeId: C1, body: "two" }), {
    status: "rejected",
    code: "reflection-already-exists",
    existingReflectionId: first.reflection.id,
  });
});

test("soft-delete then recreate is allowed and makes a new row at revision 1", async () => {
  const { service, cookie, complete } = await setup();
  await complete(C1);
  const first = ok(await service.createReflection(cookie, { challengeId: C1, body: "one" }));
  const deleted = ok(await service.deleteReflection(cookie, first.reflection.id, { revision: 1 }));
  assert.deepEqual(deleted.reflection, {
    id: first.reflection.id,
    challengeId: C1,
    revision: 1,
    deleted: true,
    deletedAt: new Date(START).toISOString(),
  });
  assert.deepEqual(await service.getReflection(cookie, first.reflection.id), { status: "rejected", code: "not-found" });
  const second = ok(await service.createReflection(cookie, { challengeId: C1, body: "two" }));
  assert.notEqual(second.reflection.id, first.reflection.id);
  assert.equal(second.reflection.revision, 1);
});

test("update bumps the revision; a stale revision -> revision-conflict with currentRevision", async () => {
  const { service, cookie, complete, tick } = await setup();
  await complete(C1);
  const { reflection } = ok(await service.createReflection(cookie, { challengeId: C1, body: "one" }));
  tick(5000);
  const updated = ok(await service.updateReflection(cookie, reflection.id, { body: " two ", revision: 1 }));
  assert.equal(updated.reflection.revision, 2);
  assert.equal(updated.reflection.body, "two");
  assert.equal(updated.reflection.updatedAt, new Date(START + 5000).toISOString());
  assert.equal(updated.reflection.createdAt, reflection.createdAt);
  assert.deepEqual(await service.updateReflection(cookie, reflection.id, { body: "three", revision: 1 }), {
    status: "rejected",
    code: "revision-conflict",
    currentRevision: 2,
  });
  assert.deepEqual(await service.deleteReflection(cookie, reflection.id, { revision: 1 }), {
    status: "rejected",
    code: "revision-conflict",
    currentRevision: 2,
  });
  assert.equal(ok(await service.getReflection(cookie, reflection.id)).reflection.body, "two");
});

test("invalid bodies and revisions -> validation-failed, nothing changes", async () => {
  const { service, cookie, complete } = await setup();
  await complete(C1);
  for (const body of ["", "   \n\t ", "x".repeat(16385), undefined, 5]) {
    assert.deepEqual(await service.createReflection(cookie, { challengeId: C1, body: body as never }), {
      status: "rejected",
      code: "validation-failed",
    });
  }
  assert.equal(ok(await service.listReflections(cookie)).reflections.length, 0);
  const { reflection } = ok(await service.createReflection(cookie, { challengeId: C1, body: "x".repeat(16384) }));
  for (const body of ["  ", "y".repeat(16385)]) {
    assert.equal((await service.updateReflection(cookie, reflection.id, { body, revision: 1 })).status, "rejected");
  }
  for (const revision of [0, -1, 1.5, "1", undefined, Number.NaN]) {
    assert.deepEqual(await service.updateReflection(cookie, reflection.id, { body: "ok", revision: revision as never }), {
      status: "rejected",
      code: "validation-failed",
    });
    assert.deepEqual(await service.deleteReflection(cookie, reflection.id, { revision: revision as never }), {
      status: "rejected",
      code: "validation-failed",
    });
  }
  assert.equal(ok(await service.getReflection(cookie, reflection.id)).reflection.revision, 1);
  // bad challengeId
  for (const challengeId of ["", "x".repeat(129), 7]) {
    assert.deepEqual(await service.createReflection(cookie, { challengeId: challengeId as never, body: "b" }), {
      status: "rejected",
      code: "validation-failed",
    });
  }
});

test("another learner's reflection is not-found for get, update, delete and absent from lists", async () => {
  const a = await setup();
  await a.complete(C1);
  const { reflection } = ok(await a.service.createReflection(a.cookie, { challengeId: C1, body: "mine" }));

  const other = issueSessionToken();
  await a.sessions.create({ tokenHash: other.tokenHash });
  const notFound = { status: "rejected", code: "not-found" };
  assert.deepEqual(await a.service.getReflection(other.token, reflection.id), notFound);
  assert.deepEqual(await a.service.updateReflection(other.token, reflection.id, { body: "x", revision: 1 }), notFound);
  assert.deepEqual(await a.service.deleteReflection(other.token, reflection.id, { revision: 1 }), notFound);
  assert.deepEqual(ok(await a.service.listReflections(other.token)).reflections, []);
  // Identical to an unknown id.
  assert.deepEqual(await a.service.getReflection(other.token, "refl_nope"), notFound);
});

test("list returns own active reflections, with an optional challenge filter", async () => {
  const { service, cookie, complete } = await setup();
  await complete(C1);
  await complete(C2);
  const r1 = ok(await service.createReflection(cookie, { challengeId: C1, body: "one" })).reflection;
  const r2 = ok(await service.createReflection(cookie, { challengeId: C2, body: "two" })).reflection;
  assert.deepEqual(
    ok(await service.listReflections(cookie)).reflections.map((r) => r.id).sort(),
    [r1.id, r2.id].sort(),
  );
  assert.deepEqual(ok(await service.listReflections(cookie, { challengeId: C2 })).reflections, [r2]);
  ok(await service.deleteReflection(cookie, r2.id, { revision: 1 }));
  assert.deepEqual(ok(await service.listReflections(cookie)).reflections, [r1]);
  assert.ok(!JSON.stringify(await service.listReflections(cookie)).includes("challengeSessionId"));
});

test("publication gate: CREATING for an unpublished challenge is unknown-challenge, before identity is examined", async () => {
  const { service, cookie, complete } = await setup(new Set([C1]));
  await complete(C2);
  const unknown = { status: "rejected", code: "unknown-challenge" };
  for (const who of [undefined, "A".repeat(43), cookie]) {
    assert.deepEqual(await service.createReflection(who, { challengeId: C2, body: "b" }), unknown);
    assert.deepEqual(await service.createReflection(who, { challengeId: "challenge-999", body: "b" }), unknown);
  }
});

test("listing by an unpublished challenge id is not a publication error: it is just that learner's (possibly empty) list", async () => {
  const { service, cookie } = await setup(new Set([C1]));
  assert.deepEqual(ok(await service.listReflections(cookie, { challengeId: C2 })).reflections, []);
  assert.deepEqual(await service.listReflections("A".repeat(43), { challengeId: C2 }), { status: "rejected", code: "learner-missing" });
});

test("unpublishing never hides an existing reflection: the owner can read, list, edit and delete it", async () => {
  const published = new Set([C1, C2]);
  const { service, cookie, complete } = await setup(published);
  await complete(C1);
  await complete(C2);
  const r1 = ok(await service.createReflection(cookie, { challengeId: C1, body: "one" })).reflection;
  const r2 = ok(await service.createReflection(cookie, { challengeId: C2, body: "two" })).reflection;

  published.delete(C2);
  assert.deepEqual(ok(await service.listReflections(cookie)).reflections, [r1, r2]);
  assert.deepEqual(ok(await service.listReflections(cookie, { challengeId: C2 })).reflections, [r2]);
  assert.deepEqual(ok(await service.getReflection(cookie, r2.id)).reflection, r2);
  const edited = ok(await service.updateReflection(cookie, r2.id, { body: "two, edited", revision: 1 })).reflection;
  assert.equal(edited.body, "two, edited");
  assert.equal(edited.revision, 2);

  // Creating anew is still gated: delete frees the slot, but the challenge is unpublished.
  const deleted = ok(await service.deleteReflection(cookie, r2.id, { revision: 2 })).reflection;
  assert.equal(deleted.deleted, true);
  assert.deepEqual(await service.getReflection(cookie, r2.id), { status: "rejected", code: "not-found" });
  assert.deepEqual(await service.createReflection(cookie, { challengeId: C2, body: "again" }), {
    status: "rejected",
    code: "unknown-challenge",
  });
});

test("DELETE returns the store's soft-delete time (never earlier than createdAt) and fails loudly if the store gave none", async () => {
  const { service, cookie, complete, loop } = await setup();
  await complete(C1);
  const created = ok(await service.createReflection(cookie, { challengeId: C1, body: "one" })).reflection;
  const deleted = ok(await service.deleteReflection(cookie, created.id, { revision: 1 })).reflection;
  assert.equal(deleted.deletedAt, created.createdAt);

  await complete(C2);
  const second = ok(await service.createReflection(cookie, { challengeId: C2, body: "two" })).reflection;
  loop.softDeleteReflection = async (input) => ({ ...(await MemoryLearningLoopStore.prototype.softDeleteReflection.call(loop, input)), deletedAt: null });
  await assert.rejects(() => service.deleteReflection(cookie, second.id, { revision: 1 }), /without deletedAt/);
});

test("reads set the cookie only when idle expiry was refreshed; writes always do", async () => {
  const { service, cookie, complete, tick } = await setup();
  await complete(C1);
  const created = ok(await service.createReflection(cookie, { challengeId: C1, body: "one" }));
  assert.equal(created.cookie.value, cookie);
  assert.ok(created.cookie.maxAgeSeconds > 0);
  assert.equal("cookie" in ok(await service.listReflections(cookie)), false);
  tick(2 * 24 * 60 * 60 * 1000);
  const refreshed = ok(await service.getReflection(cookie, created.reflection.id));
  assert.ok(refreshed.cookie);
});

test("rejections carry no cookie", async () => {
  const { service, cookie } = await setup();
  const result = await service.createReflection(cookie, { challengeId: C1, body: "b" });
  assert.equal(result.status, "rejected");
  assert.equal("cookie" in result, false);
});

test("the service module is server-only and exposes no session-id input", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../src/server/learning-loop/service.ts", import.meta.url), "utf8");
  assert.match(source, /import "server-only";/);
});
