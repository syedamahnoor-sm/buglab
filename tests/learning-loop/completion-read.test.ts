import assert from "node:assert/strict";
import test from "node:test";
import { findReflectionEligibleSession, listCompletions } from "@/server/learning-loop/completion-read";
import { MemoryStore } from "@/server/session/memory-store";
import { issueSessionToken } from "@/server/session/token";
import type { ChallengeSessionRecord, ChallengeSessionStore } from "@/server/session/types";
import { RESULT } from "../session/attempt-contract";

const WINDOW = { limit: 3, windowMs: 600_000 };
const V1 = "1+aaaaaaaaaaaa";
const V2 = "1+bbbbbbbbbbbb";

async function setup() {
  const store = new MemoryStore();
  const { tokenHash } = issueSessionToken();
  const learner = await store.create({ tokenHash });
  const { session } = await store.start({ learnerId: learner.id, challengeId: "C1", challengeVersion: V1 });
  return { store, learner, session };
}

let n = 0;
function attempt(learnerId: string, sessionId: string, outcome: "correct" | "incorrect") {
  n += 1;
  return {
    learnerId,
    sessionId,
    submissionId: `s-${n}`,
    requestHash: n.toString(16).padStart(64, "0"),
    rootCauseId: "option-a",
    explanation: "An explanation of what the learner believes is happening.",
    evidence: [{ kind: "log" as const, logId: "log-01" }],
    outcome,
    ...(outcome === "correct" ? { result: RESULT } : {}),
    window: WINDOW,
  };
}

function fakeSessions(record: ChallengeSessionRecord | null): Pick<ChallengeSessionStore, "find"> {
  return { find: async () => record };
}

function record(over: Partial<ChallengeSessionRecord> = {}): ChallengeSessionRecord {
  return {
    id: "S1",
    learnerId: "L1",
    challengeId: "C1",
    challengeVersion: V1,
    status: "completed",
    revision: 1,
    attemptCount: 1,
    wrongAttempts: 0,
    createdAt: 1,
    updatedAt: 2,
    completedAt: 500,
    ...over,
  } as ChallengeSessionRecord;
}

test("no session -> null", async () => {
  const { store, learner } = await setup();
  assert.equal(await findReflectionEligibleSession(store, learner.id, "other-challenge"), null);
});

test("unfinished current session -> null", async () => {
  const { store, learner } = await setup();
  assert.equal(await findReflectionEligibleSession(store, learner.id, "C1"), null);
  await store.record(attempt(learner.id, (await store.find({ learnerId: learner.id, challengeId: "C1" }))!.id, "incorrect"));
  assert.equal(await findReflectionEligibleSession(store, learner.id, "C1"), null);
});

test("completed current session -> eligible row", async () => {
  const { store, learner, session } = await setup();
  await store.record(attempt(learner.id, session.id, "correct"));
  const done = (await store.find({ learnerId: learner.id, challengeId: "C1" }))!;
  assert.deepEqual(await findReflectionEligibleSession(store, learner.id, "C1"), {
    sessionId: session.id,
    learnerId: learner.id,
    challengeId: "C1",
    completedAt: done.completedAt,
  });
});

test("another learner's completion is never returned", async () => {
  const { store, learner, session } = await setup();
  await store.record(attempt(learner.id, session.id, "correct"));
  const other = await store.create({ tokenHash: issueSessionToken().tokenHash });
  assert.equal(await findReflectionEligibleSession(store, other.id, "C1"), null);
});

test("superseded unfinished history never makes a learner eligible; replacement is unfinished -> null", async () => {
  const { store, learner, session } = await setup();
  await store.restart({ learnerId: learner.id, challengeId: "C1", challengeVersion: V2, supersedes: session.id });
  assert.equal(await findReflectionEligibleSession(store, learner.id, "C1"), null);
});

test("a superseded completed record is rejected even if a store returned it", async () => {
  const sessions = fakeSessions(record({ supersededAt: 900 }));
  assert.equal(await findReflectionEligibleSession(sessions as ChallengeSessionStore, "L1", "C1"), null);
});

test("completed record without completedAt is not eligible", async () => {
  const incomplete = { ...record() } as ChallengeSessionRecord;
  Reflect.deleteProperty(incomplete, "completedAt");
  assert.equal(await findReflectionEligibleSession(fakeSessions(incomplete) as ChallengeSessionStore, "L1", "C1"), null);
});

test("record for a different learner or challenge is rejected", async () => {
  assert.equal(await findReflectionEligibleSession(fakeSessions(record({ learnerId: "L2" })) as ChallengeSessionStore, "L1", "C1"), null);
  assert.equal(await findReflectionEligibleSession(fakeSessions(record({ challengeId: "C2" })) as ChallengeSessionStore, "L1", "C1"), null);
});

function listing(records: ChallengeSessionRecord[]): Pick<ChallengeSessionStore, "listCurrentCompleted"> {
  return { listCurrentCompleted: async () => records };
}

test("listCompletions orders completedAt DESC, id ASC and re-checks every record (superseded, unfinished, foreign)", async () => {
  const rows = [
    record({ id: "b", challengeId: "C2", completedAt: 100 }),
    record({ id: "z", challengeId: "C3", completedAt: 300 }),
    record({ id: "m", challengeId: "C4", completedAt: 300 }),
    record({ id: "x", challengeId: "C5", supersededAt: 1, completedAt: 999 }),
    record({ id: "u", challengeId: "C6", status: "active", completedAt: undefined }),
    record({ id: "f", challengeId: "C7", learnerId: "L2", completedAt: 998 }),
  ];
  const done = await listCompletions(listing(rows), "L1");
  assert.deepEqual(done.map((d) => d.sessionId), ["m", "z", "b"]);
  assert.deepEqual(done[0], { sessionId: "m", learnerId: "L1", challengeId: "C4", completedAt: 300 });
  assert.deepEqual(await listCompletions(listing([]), "L1"), []);
});

test("listCompletions over the real store: completed challenges only, whatever is published", async () => {
  const { store, learner, session } = await setup();
  await store.record(attempt(learner.id, session.id, "correct"));
  await store.start({ learnerId: learner.id, challengeId: "C2", challengeVersion: V1 });
  const done = await listCompletions(store, learner.id);
  assert.deepEqual(done.map((d) => d.challengeId), ["C1"]);
});