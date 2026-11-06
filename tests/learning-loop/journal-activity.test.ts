import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeActivityCursor,
  decodeJournalCursor,
  encodeActivityCursor,
  encodeJournalCursor,
} from "@/server/learning-loop/cursors";
import {
  ACTIVITY_PREVIEW_BYTES,
  KIND_RANK,
  KNOWN_RANKS,
  compareActivity,
  compareJournal,
  completionSourceId,
  previewOf,
} from "@/server/learning-loop/derive";
import { listCompletions } from "@/server/learning-loop/completion-read";
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
const C3 = "challenge-003";
const ALL = [C1, C2, C3] as const;

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

async function setup(published: ReadonlySet<string> = new Set(ALL)) {
  let now = START;
  const sessions = new MemoryStore({ now: () => now });
  const loop = new MemoryLearningLoopStore({
    listCompletions: (learnerId) => listCompletions(sessions, learnerId),
  });
  let ids = 0;
  const service = createLearningLoopService({
    learners: sessions,
    sessions,
    store: loop,
    registry: { has: (id: string) => published.has(id) },
    now: () => now,
    newId: () => `refl_${String(++ids).padStart(3, "0")}`,
  });
  const issued = issueSessionToken();
  const learner = await sessions.create({ tokenHash: issued.tokenHash });
  const sessionIds = new Map<string, string>();
  const complete = async (challengeId: string) => {
    const { session } = await sessions.start({ learnerId: learner.id, challengeId, challengeVersion: V1 });
    sessionIds.set(challengeId, session.id);
    await sessions.record(correctAttempt(learner.id, session.id));
  };
  const reflect = async (challengeId: string, body = `notes on ${challengeId}`) => {
    const r = await service.createReflection(issued.token, { challengeId, body });
    assert.equal(r.status, "ok", JSON.stringify(r));
    return (r as Extract<typeof r, { status: "ok" }>).reflection;
  };
  return {
    service,
    sessions,
    loop,
    cookie: issued.token as string,
    learner,
    complete,
    reflect,
    sessionIds,
    tick: (ms: number) => (now += ms),
  };
}

function ok<T extends { status: string }>(result: T): Extract<T, { status: "ok" }> {
  assert.equal(result.status, "ok", JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
}

/* --------------------------------- previews --------------------------------- */

test("previewOf returns short bodies unchanged and never exceeds the byte budget", () => {
  assert.equal(previewOf("short note"), "short note");
  assert.equal(previewOf("a".repeat(120)), "a".repeat(120));
  const long = previewOf("a".repeat(500));
  assert.ok(Buffer.byteLength(long, "utf8") <= ACTIVITY_PREVIEW_BYTES);
  assert.ok(long.endsWith("…"));
  assert.ok(long.startsWith("aaaa"));
});

test("previewOf truncates only on UTF-8 character boundaries (2-, 3- and 4-byte characters)", () => {
  for (const unit of ["é", "日", "😀", "a😀", "ab日", "é😀日a"]) {
    for (let count = 1; count <= 90; count += 1) {
      const body = unit.repeat(count);
      const preview = previewOf(body);
      const bytes = Buffer.byteLength(preview, "utf8");
      assert.ok(bytes <= ACTIVITY_PREVIEW_BYTES, `${unit} x${count}: ${bytes} bytes`);
      assert.ok(!preview.includes("\uFFFD"), `${unit} x${count}: replacement character`);
      assert.equal(Buffer.from(preview, "utf8").toString("utf8"), preview);
      // Lone surrogates would re-encode as U+FFFD; also check none remain.
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(preview));
      const stem = preview.endsWith("…") && preview !== body ? preview.slice(0, -1) : preview;
      assert.ok(body.startsWith(stem));
    }
  }
  const emoji = previewOf("😀".repeat(100));
  assert.equal(emoji, "😀".repeat(29) + "…"); // 29*4 + 3 = 119 bytes, the 30th would cross 120
});

/* ---------------------------------- cursors --------------------------------- */

test("cursors round-trip, are opaque base64url, and reject tampering and cross-use", () => {
  const j = encodeJournalCursor({ updatedAt: START, challengeId: C1, id: "refl_001" });
  assert.match(j, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeJournalCursor(j), { updatedAt: START, challengeId: C1, id: "refl_001" });
  const a = encodeActivityCursor({ occurredAt: START, kindRank: 40, sourceId: "refl_001" });
  assert.deepEqual(decodeActivityCursor(a), { occurredAt: START, kindRank: 40, sourceId: "refl_001" });

  assert.equal(decodeJournalCursor(a), null);
  assert.equal(decodeActivityCursor(j), null);
  for (const bad of ["", "!!!", j + "A", j.slice(0, -2), "e30", Buffer.from("[]").toString("base64url"), "x".repeat(5000)]) {
    assert.equal(decodeJournalCursor(bad), null, bad);
    assert.equal(decodeActivityCursor(bad), null, bad);
  }
  assert.equal(decodeJournalCursor(undefined), null);
  assert.equal(decodeJournalCursor(42), null);
  const forged = Buffer.from(JSON.stringify({ v: 1, k: "a", o: -1, r: 99, s: "" })).toString("base64url");
  assert.equal(decodeActivityCursor(forged), null);
});

test("cursors never contain learner or session identifiers", async () => {
  const { service, cookie, complete, reflect, learner, sessionIds } = await setup();
  await complete(C1);
  await reflect(C1);
  const page = ok(await service.listActivity(cookie, { limit: 1 }));
  assert.ok(page.nextCursor);
  const decoded = Buffer.from(page.nextCursor!, "base64url").toString("utf8");
  assert.ok(!decoded.includes(learner.id));
  assert.ok(!decoded.includes(sessionIds.get(C1)!));
});

/* --------------------------------- ordering --------------------------------- */

test("comparators implement the documented total orders", () => {
  const j = [
    { updatedAt: 1, challengeId: "b", id: "r2" },
    { updatedAt: 2, challengeId: "b", id: "r1" },
    { updatedAt: 1, challengeId: "a", id: "r9" },
    { updatedAt: 1, challengeId: "a", id: "r3" },
  ].sort(compareJournal);
  assert.deepEqual(
    j.map((x) => `${x.updatedAt}${x.challengeId}${x.id}`),
    ["2br1", "1ar3", "1ar9", "1br2"],
  );
  const a = [
    { occurredAt: 5, kindRank: KIND_RANK["reflection.updated"], sourceId: "a" },
    { occurredAt: 5, kindRank: KIND_RANK["challenge.completed"], sourceId: "z" },
    { occurredAt: 5, kindRank: KIND_RANK["challenge.completed"], sourceId: "b" },
    { occurredAt: 9, kindRank: KIND_RANK["reflection.updated"], sourceId: "q" },
  ].sort(compareActivity);
  assert.deepEqual(
    a.map((x) => `${x.occurredAt}/${x.kindRank}/${x.sourceId}`),
    ["9/40/q", "5/10/b", "5/10/z", "5/40/a"],
  );
  assert.equal(KIND_RANK["challenge.completed"], 10);
  assert.equal(KIND_RANK["reflection.updated"], 40);
});

/* ---------------------------------- journal --------------------------------- */

test("journal and activity refuse missing and expired learners", async () => {
  const { service, cookie, tick } = await setup();
  for (const c of [undefined, "", "short", "A".repeat(43)]) {
    assert.deepEqual(await service.listJournal(c), { status: "rejected", code: "learner-missing" });
    assert.deepEqual(await service.listActivity(c), { status: "rejected", code: "learner-missing" });
  }
  tick(31 * 24 * 60 * 60 * 1000);
  assert.deepEqual(await service.listJournal(cookie), { status: "rejected", code: "learner-expired" });
  assert.deepEqual(await service.listActivity(cookie), { status: "rejected", code: "learner-expired" });
});

test("empty journal and activity", async () => {
  const { service, cookie } = await setup();
  const j = ok(await service.listJournal(cookie));
  assert.deepEqual({ entries: j.entries, nextCursor: j.nextCursor }, { entries: [], nextCursor: null });
  const a = ok(await service.listActivity(cookie));
  assert.deepEqual({ items: a.items, nextCursor: a.nextCursor }, { items: [], nextCursor: null });
});

test("journal entries: shape, ordering (updatedAt DESC, challengeId ASC), no leaked ids", async () => {
  const { service, cookie, complete, reflect, tick, learner, sessionIds } = await setup();
  await complete(C1);
  await complete(C2);
  await complete(C3);
  const r2 = await reflect(C2); // t0
  const r3 = await reflect(C3); // t0 (tie with C2 -> challengeId ASC)
  tick(1000);
  const r1 = await reflect(C1); // t0+1s newest

  const page = ok(await service.listJournal(cookie));
  assert.deepEqual(
    page.entries.map((e) => e.reflectionId),
    [r1.id, r2.id, r3.id],
  );
  assert.equal(page.nextCursor, null);
  assert.deepEqual(page.entries[0], {
    kind: "challenge-reflection",
    reflectionId: r1.id,
    challengeId: C1,
    completedAt: r1.completedAt,
    body: r1.body,
    revision: 1,
    createdAt: r1.createdAt,
    updatedAt: r1.updatedAt,
  });
  const json = JSON.stringify(page);
  assert.ok(!json.includes(learner.id));
  for (const sid of sessionIds.values()) assert.ok(!json.includes(sid));
  assert.ok(!/learnerId|challengeSessionId|deletedAt/.test(json));
});

test("an edited reflection moves to the top of the journal", async () => {
  const { service, cookie, complete, reflect, tick } = await setup();
  await complete(C1);
  await complete(C2);
  const r1 = await reflect(C1);
  tick(10);
  const r2 = await reflect(C2);
  tick(10);
  ok(await service.updateReflection(cookie, r1.id, { body: "edited", revision: 1 }));
  const page = ok(await service.listJournal(cookie));
  assert.deepEqual(
    page.entries.map((e) => e.reflectionId),
    [r1.id, r2.id],
  );
  assert.equal(page.entries[0]!.revision, 2);
  assert.equal(page.entries[0]!.body, "edited");
});

test("journal hides soft-deleted reflections but keeps those of since-unpublished challenges", async () => {
  const published = new Set<string>(ALL);
  const { service, cookie, complete, reflect, tick } = await setup(published);
  await complete(C1);
  await complete(C2);
  await complete(C3);
  const r1 = await reflect(C1);
  tick(1);
  const r2 = await reflect(C2);
  tick(1);
  const r3 = await reflect(C3);
  ok(await service.deleteReflection(cookie, r1.id, { revision: 1 }));
  published.delete(C2);
  assert.deepEqual(
    ok(await service.listJournal(cookie)).entries.map((e) => e.reflectionId),
    [r3.id, r2.id],
  );
});

test("the journal pages in the store: it never loads more than one row past the page", async () => {
  const { service, cookie, complete, reflect, tick, loop } = await setup();
  for (const c of ALL) {
    await complete(c);
    await reflect(c);
    tick(10);
  }
  const calls: Array<{ limit?: number; hasAfter: boolean; returned: number }> = [];
  const real = loop.listActiveReflections.bind(loop);
  loop.listActiveReflections = async (learnerId, options) => {
    const rows = await real(learnerId, options);
    calls.push({ ...(options?.limit === undefined ? {} : { limit: options.limit }), hasAfter: Boolean(options?.after), returned: rows.length });
    return rows;
  };
  const first = ok(await service.listJournal(cookie, { limit: 2 }));
  assert.equal(first.entries.length, 2);
  ok(await service.listJournal(cookie, { limit: 2, cursor: first.nextCursor! }));
  assert.deepEqual(calls, [
    { limit: 3, hasAfter: false, returned: 3 },
    { limit: 3, hasAfter: true, returned: 1 },
  ]);
});

test("activity pages in the store: it never asks for more than one row past the page", async () => {
  const { service, cookie, complete, reflect, tick, loop } = await setup();
  assert.ok(loop.listActivity, "store-level activity paging is wired");
  for (const c of ALL) {
    await complete(c);
    await reflect(c);
    tick(10);
  }
  const calls: Array<{ limit?: number; hasAfter: boolean; returned: number; completions: boolean; reflections: boolean }> = [];
  const real = loop.listActivity!.bind(loop);
  loop.listActivity = async (learnerId: string, options?: Parameters<NonNullable<typeof loop.listActivity>>[1]) => {
    const rows = await real(learnerId, options);
    calls.push({
      ...(options?.limit === undefined ? {} : { limit: options.limit }),
      hasAfter: Boolean(options?.after),
      returned: rows.length,
      completions: options?.includeCompletions !== false,
      reflections: options?.includeReflections !== false,
    });
    return rows;
  };
  const first = ok(await service.listActivity(cookie, { limit: 2 }));
  assert.equal(first.items.length, 2);
  ok(await service.listActivity(cookie, { limit: 2, cursor: first.nextCursor! }));
  ok(await service.listActivity(cookie, { limit: 2, kinds: ["reflection.updated"] }));
  assert.deepEqual(calls, [
    { limit: 3, hasAfter: false, returned: 3, completions: true, reflections: true },
    { limit: 3, hasAfter: true, returned: 3, completions: true, reflections: true },
    { limit: 3, hasAfter: false, returned: 3, completions: false, reflections: true },
  ]);
});

test("journal pagination: default 20, max 50, stable cursor across ties", async () => {
  const published = new Set<string>();
  const { service, cookie, complete, reflect, tick } = await setup(published);
  const ids: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    const cid = `challenge-${String(i).padStart(3, "0")}`;
    published.add(cid);
    await complete(cid);
    ids.push(cid);
  }
  // Groups of 3 share an updatedAt so ties straddle page boundaries.
  const created = new Map<string, string>();
  for (let i = 0; i < 60; i += 1) {
    const r = await reflect(ids[i]!);
    created.set(r.id, ids[i]!);
    if (i % 3 === 2) tick(1000);
  }

  const first = ok(await service.listJournal(cookie));
  assert.equal(first.entries.length, 20);
  assert.ok(first.nextCursor);
  assert.equal(ok(await service.listJournal(cookie, { limit: 500 })).entries.length, 50);
  assert.equal(ok(await service.listJournal(cookie, { limit: 1 })).entries.length, 1);

  for (const limit of [1, 7, 20, 50]) {
    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const page = ok(await service.listJournal(cookie, { limit, cursor }));
      assert.ok(page.entries.length <= limit);
      seen.push(...page.entries.map((e) => e.reflectionId));
      cursor = page.nextCursor ?? undefined;
      assert.ok(++guard < 100);
    } while (cursor);
    const all = ok(await service.listJournal(cookie, { limit: 50 }));
    assert.equal(new Set(seen).size, 60, `limit ${limit}: no duplicates, none skipped`);
    if (limit === 50) assert.deepEqual(seen.slice(0, 50), all.entries.map((e) => e.reflectionId));
  }
});

test("journal cursor stays valid when rows change between pages", async () => {
  const { service, cookie, complete, reflect, tick } = await setup();
  await complete(C1);
  await complete(C2);
  await complete(C3);
  const r1 = await reflect(C1);
  tick(10);
  const r2 = await reflect(C2);
  tick(10);
  const r3 = await reflect(C3);
  const page1 = ok(await service.listJournal(cookie, { limit: 1 }));
  assert.deepEqual(page1.entries.map((e) => e.reflectionId), [r3.id]);
  // The row the cursor points at is deleted: the next page still continues strictly after it.
  ok(await service.deleteReflection(cookie, r3.id, { revision: 1 }));
  const page2 = ok(await service.listJournal(cookie, { limit: 5, cursor: page1.nextCursor! }));
  assert.deepEqual(page2.entries.map((e) => e.reflectionId), [r2.id, r1.id]);
});

test("journal rejects bad cursors and bad limits", async () => {
  const { service, cookie } = await setup();
  for (const cursor of ["nope", "", "e30", encodeActivityCursor({ occurredAt: 1, kindRank: 10, sourceId: "x" })]) {
    assert.deepEqual(await service.listJournal(cookie, { cursor }), { status: "rejected", code: "invalid-cursor" });
  }
  for (const limit of [0, -1, 1.5, Number.NaN, "5" as unknown as number]) {
    assert.deepEqual(await service.listJournal(cookie, { limit }), { status: "rejected", code: "validation-failed" });
  }
});

/* ---------------------------------- activity -------------------------------- */

test("activity merges completions and reflections: order, shapes, kindRank tie-break", async () => {
  const { service, cookie, complete, reflect, tick } = await setup();
  await complete(C1); // t0
  tick(1000);
  await complete(C2); // t1
  const r1 = await reflect(C1); // t1: ties with C2 completion; completion (10) first
  tick(1000);
  const r2 = await reflect(C2, "later reflection"); // t2

  const page = ok(await service.listActivity(cookie));
  assert.deepEqual(
    page.items.map((i) => `${i.kind}:${i.challengeId}`),
    [`reflection.updated:${C2}`, `challenge.completed:${C2}`, `reflection.updated:${C1}`, `challenge.completed:${C1}`],
  );
  assert.equal(page.nextCursor, null);

  const [top, comp2, refl1] = page.items;
  assert.deepEqual(top, {
    itemKey: { kind: "reflection", sourceId: r2.id },
    kind: "reflection.updated",
    occurredAt: r2.updatedAt,
    challengeId: C2,
    summary: { challengeId: C2, preview: "later reflection" },
  });
  assert.equal(comp2!.kind, "challenge.completed");
  assert.equal(comp2!.itemKey.kind, "challenge.completed");
  assert.deepEqual(comp2!.summary, { challengeId: C2 });
  assert.equal(comp2!.occurredAt, r1.updatedAt); // the tie: C2 completed at the instant C1's reflection was written
  assert.equal(page.items[3]!.occurredAt, r1.completedAt);
  assert.equal(refl1!.itemKey.sourceId, r1.id);
  assert.equal(refl1!.occurredAt, r1.updatedAt);
});

test("activity never exposes learner or session ids; completion sourceId is opaque and stable", async () => {
  const { service, cookie, complete, reflect, learner, sessionIds } = await setup();
  await complete(C1);
  await reflect(C1);
  const a = ok(await service.listActivity(cookie));
  const b = ok(await service.listActivity(cookie));
  const json = JSON.stringify(a);
  assert.ok(!json.includes(learner.id));
  const sid = sessionIds.get(C1)!;
  assert.ok(!json.includes(sid));
  assert.ok(!/learnerId|challengeSessionId|sessionId|deletedAt/.test(json));
  const completion = a.items.find((i) => i.kind === "challenge.completed")!;
  assert.equal(completion.itemKey.sourceId, completionSourceId(sid));
  assert.equal(completion.itemKey.sourceId, b.items.find((i) => i.kind === "challenge.completed")!.itemKey.sourceId);
  assert.notEqual(completion.itemKey.sourceId, sid);
  assert.ok(!completion.itemKey.sourceId.includes(sid));
});

test("soft-deleting a reflection removes reflection.updated only; completion remains", async () => {
  const { service, cookie, complete, reflect } = await setup();
  await complete(C1);
  const r = await reflect(C1);
  assert.equal(ok(await service.listActivity(cookie)).items.length, 2);
  ok(await service.deleteReflection(cookie, r.id, { revision: 1 }));
  const after = ok(await service.listActivity(cookie));
  assert.deepEqual(after.items.map((i) => i.kind), ["challenge.completed"]);
  // Re-creating restores a reflection item with a new id.
  const again = await reflect(C1);
  const kinds = ok(await service.listActivity(cookie)).items.map((i) => `${i.kind}:${i.itemKey.sourceId === again.id}`);
  assert.deepEqual(kinds.sort(), ["challenge.completed:false", "reflection.updated:true"]);
});

test("a reflection edit refreshes occurredAt and the preview, completion time stays", async () => {
  const { service, cookie, complete, reflect, tick } = await setup();
  await complete(C1);
  const r = await reflect(C1, "first");
  tick(5000);
  ok(await service.updateReflection(cookie, r.id, { body: "second", revision: 1 }));
  const items = ok(await service.listActivity(cookie)).items;
  assert.equal(items.length, 2);
  assert.equal(items[0]!.kind, "reflection.updated");
  assert.equal(items[0]!.occurredAt, new Date(START + 5000).toISOString());
  assert.equal((items[0]!.summary as { preview?: string }).preview, "second");
  assert.equal(items[1]!.occurredAt, new Date(START).toISOString());
});

test("activity previews are UTF-8-safe truncations; the journal keeps the full body", async () => {
  const { service, cookie, complete, reflect } = await setup();
  await complete(C1);
  const body = "日本語のメモ😀".repeat(40);
  await reflect(C1, body);
  const item = ok(await service.listActivity(cookie)).items.find((i) => i.kind === "reflection.updated")!;
  const preview = (item.summary as { preview: string }).preview;
  assert.ok(Buffer.byteLength(preview, "utf8") <= 120);
  assert.ok(preview.endsWith("…"));
  assert.ok(body.startsWith(preview.slice(0, -1)));
  assert.equal(ok(await service.listJournal(cookie)).entries[0]!.body, body);
});

test("activity completions come from current completed sessions, not the published catalog", async () => {
  const published = new Set<string>(ALL);
  const { service, cookie, complete, reflect } = await setup(published);
  await complete(C1);
  await complete(C2);
  await reflect(C1);
  for (const c of ALL) published.delete(c);
  const items = ok(await service.listActivity(cookie)).items;
  assert.deepEqual(items.map((i) => `${i.kind}:${i.challengeId}`).sort(), [
    `challenge.completed:${C1}`,
    `challenge.completed:${C2}`,
    `reflection.updated:${C1}`,
  ]);
  // Even a challenge id the registry has never heard of is listed: the session is the source of truth.
  await complete("challenge-never-published");
  assert.equal(
    ok(await service.listActivity(cookie)).items.filter((i) => i.kind === "challenge.completed").length,
    3,
  );
});

test("activity cursor ranks come from derive.ts: every defined rank (including reserved recall ranks) decodes, nothing else", () => {
  assert.deepEqual([...KNOWN_RANKS].sort((a, b) => a - b), [10, 20, 30, 40]);
  for (const kindRank of KNOWN_RANKS) {
    assert.deepEqual(decodeActivityCursor(encodeActivityCursor({ occurredAt: 1, kindRank, sourceId: "s" })), {
      occurredAt: 1,
      kindRank,
      sourceId: "s",
    });
  }
  for (const kindRank of [0, 15, 41, -10]) {
    assert.equal(decodeActivityCursor(encodeActivityCursor({ occurredAt: 1, kindRank, sourceId: "s" })), null);
  }
});
test("an unfinished session is not a completion", async () => {
  const { service, cookie, sessions, learner } = await setup();
  await sessions.start({ learnerId: learner.id, challengeId: C1, challengeVersion: V1 });
  assert.deepEqual(ok(await service.listActivity(cookie)).items, []);
});

test("activity pagination walks every item exactly once for several page sizes (ties included)", async () => {
  const published = new Set<string>();
  const { service, cookie, complete, reflect, tick } = await setup(published);
  const total: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const cid = `challenge-${String(i).padStart(3, "0")}`;
    published.add(cid);
    await complete(cid);
    await reflect(cid); // same instant as the completion: rank tie-break
    if (i % 2 === 1) tick(1000);
    total.push(cid);
  }
  const full = ok(await service.listActivity(cookie, { limit: 50 }));
  assert.equal(full.items.length, 24);
  assert.equal(full.nextCursor, null);
  const keyOf = (i: { itemKey: { kind: string; sourceId: string } }) => `${i.itemKey.kind}/${i.itemKey.sourceId}`;
  const expected = full.items.map(keyOf);
  assert.equal(new Set(expected).size, 24);

  for (const limit of [1, 2, 5, 7, 24]) {
    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const page = ok(await service.listActivity(cookie, { limit, cursor }));
      seen.push(...page.items.map(keyOf));
      cursor = page.nextCursor ?? undefined;
      assert.ok(++guard < 100);
    } while (cursor);
    assert.deepEqual(seen, expected, `limit ${limit}`);
  }
});

test("activity kinds filter: subsets, recall-only is an empty list, mixed keeps what exists", async () => {
  const { service, cookie, complete, reflect } = await setup();
  await complete(C1);
  await reflect(C1);

  const onlyCompletions = ok(await service.listActivity(cookie, { kinds: ["challenge.completed"] }));
  assert.deepEqual(onlyCompletions.items.map((i) => i.kind), ["challenge.completed"]);
  const onlyReflections = ok(await service.listActivity(cookie, { kinds: ["reflection.updated"] }));
  assert.deepEqual(onlyReflections.items.map((i) => i.kind), ["reflection.updated"]);

  for (const kinds of [["recall.session.started"], ["recall.session.completed"], ["recall.session.started", "recall.session.completed"]]) {
    const r = ok(await service.listActivity(cookie, { kinds }));
    assert.deepEqual({ items: r.items, nextCursor: r.nextCursor }, { items: [], nextCursor: null }, kinds.join());
  }
  const mixed = ok(await service.listActivity(cookie, { kinds: ["recall.session.completed", "reflection.updated"] }));
  assert.deepEqual(mixed.items.map((i) => i.kind), ["reflection.updated"]);
  const dup = ok(await service.listActivity(cookie, { kinds: ["reflection.updated", "reflection.updated"] }));
  assert.equal(dup.items.length, 1);

  for (const kinds of [[], ["nonsense"], ["challenge.completed", 5], "reflection.updated"]) {
    assert.deepEqual(await service.listActivity(cookie, { kinds: kinds as unknown as string[] }), {
      status: "rejected",
      code: "validation-failed",
    });
  }
});

test("activity filtered pagination only returns requested kinds across pages", async () => {
  const { service, cookie, complete, reflect, tick } = await setup();
  for (const c of ALL) {
    await complete(c);
    await reflect(c);
    tick(100);
  }
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = ok(await service.listActivity(cookie, { limit: 1, kinds: ["reflection.updated"], cursor }));
    seen.push(...page.items.map((i) => i.kind));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(seen, ["reflection.updated", "reflection.updated", "reflection.updated"]);
});

test("activity rejects bad cursors and limits, including a journal cursor", async () => {
  const { service, cookie } = await setup();
  const journalCursor = encodeJournalCursor({ updatedAt: 1, challengeId: C1, id: "r" });
  for (const cursor of ["nope", "", journalCursor]) {
    assert.deepEqual(await service.listActivity(cookie, { cursor }), { status: "rejected", code: "invalid-cursor" });
  }
  assert.deepEqual(await service.listActivity(cookie, { limit: 0 }), { status: "rejected", code: "validation-failed" });
  assert.equal(ok(await service.listActivity(cookie, { limit: 9999 })).items.length, 0);
});

test("other learners' data never appears", async () => {
  const { service, cookie, complete, reflect, sessions } = await setup();
  await complete(C1);
  await reflect(C1);
  const other = issueSessionToken();
  const otherLearner = await sessions.create({ tokenHash: other.tokenHash });
  const { session } = await sessions.start({ learnerId: otherLearner.id, challengeId: C2, challengeVersion: V1 });
  await sessions.record(correctAttempt(otherLearner.id, session.id));
  const mine = ok(await service.listActivity(cookie));
  assert.deepEqual(mine.items.map((i) => i.challengeId).sort(), [C1, C1]);
  const theirs = ok(await service.listActivity(other.token as string));
  assert.deepEqual(theirs.items.map((i) => i.kind), ["challenge.completed"]);
  assert.deepEqual(ok(await service.listJournal(other.token as string)).entries, []);
});
