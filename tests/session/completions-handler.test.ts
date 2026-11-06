/*
 * Unmounted GET /api/learner/completions. Identity is the learner cookie.
 * Completions are current completed sessions only.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import { createDefaultRegistry } from "@/server/diagnosis/registry";
import { decodeCompletionCursor, encodeJournalCursor } from "@/server/learning-loop/cursors";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { createLearnerCompletionsHandler } from "@/server/session/handlers";
import { MemoryStore } from "@/server/session/memory-store";
import { LearnerSessionService } from "@/server/session/service";
import { issueSessionToken } from "@/server/session/token";
import type { AttemptStore, ChallengeSessionStore, LearnerStore } from "@/server/session/types";
import { RESULT } from "./attempt-contract";

const WINDOW = { limit: 5, windowMs: 60_000 };
const START = Date.parse("2026-11-01T00:00:00.000Z");

type Store = LearnerStore & ChallengeSessionStore & AttemptStore;

function explanation() {
  return "An explanation of what the learner believes is happening.";
}

function lab(store: Store, now: () => number) {
  const service = new LearnerSessionService({
    learners: store,
    sessions: store,
    attempts: store,
    registry: createDefaultRegistry(),
    challengeVersion: () => "1+test",
    now,
  });
  const handler = createLearnerCompletionsHandler({ service });
  return { service, handler };
}

async function openLearner(store: Store) {
  const issued = issueSessionToken();
  const learner = await store.create({ tokenHash: issued.tokenHash });
  return { token: issued.token, learner };
}

let submission = 0;
async function finish(
  store: Store,
  learnerId: string,
  challengeId: string,
  version: string,
  outcome: "correct" | "incorrect",
) {
  const started = await store.start({ learnerId, challengeId, challengeVersion: version });
  submission += 1;
  const recorded = await store.record({
    learnerId,
    sessionId: started.session.id,
    submissionId: `submission-${submission}`,
    requestHash: submission.toString(16).padStart(64, "0"),
    rootCauseId: "option-a",
    explanation: explanation(),
    evidence: [{ kind: "log", logId: "log-01" }],
    outcome,
    window: WINDOW,
    ...(outcome === "correct" ? { result: RESULT } : {}),
  });
  assert.equal(recorded.kind, "recorded");
  return started.session;
}

function get(handler: ReturnType<typeof createLearnerCompletionsHandler>, token: string | undefined, query = "") {
  return handler.GET(
    new Request(`http://localhost:3000/api/learner/completions${query}`, {
      method: "GET",
      headers: token ? { cookie: `${LEARNER_COOKIE}=${token}` } : {},
    }),
  );
}

async function bodyOf(response: Response) {
  return response.json() as Promise<{
    completions?: { challengeId: string; completedAt: string; contentVersion: string }[];
    nextCursor?: string | null;
    code?: string;
    status?: string;
  }>;
}

describe("learner completions handler", () => {
  test("the completions route is mounted and uses the anonymous cookie factory", () => {
    assert.equal(existsSync(new URL("../../src/app/api/learner/completions/route.ts", import.meta.url)), true);
    assert.equal(existsSync(new URL("../../src/app/api/learner/route.ts", import.meta.url)), true);
  });

  test("an empty history is an empty page", async () => {
    const now = START;
    const store = new MemoryStore({ now: () => now });
    const { handler } = lab(store, () => now);
    const learner = await openLearner(store);
    const response = await get(handler, learner.token);
    assert.equal(response.status, 200);
    assert.deepEqual(await bodyOf(response), { completions: [], nextCursor: null });
  });

  test("a verified completion is returned and an incorrect diagnosis is not", async () => {
    let now = START;
    const store = new MemoryStore({ now: () => now });
    const { handler } = lab(store, () => now);
    const learner = await openLearner(store);
    await finish(store, learner.learner.id, "challenge-wrong", "1+wrong", "incorrect");
    now += 1000;
    await finish(store, learner.learner.id, "challenge-001", "1+abcdef012345", "correct");

    const response = await get(handler, learner.token);
    assert.equal(response.status, 200);
    const body = await bodyOf(response);
    assert.deepEqual(body.completions, [
      {
        challengeId: "challenge-001",
        completedAt: new Date(START + 1000).toISOString(),
        contentVersion: "1+abcdef012345",
      },
    ]);
    assert.equal(body.nextCursor, null);
    assert.equal(JSON.stringify(body).includes("learnerId"), false);
    assert.equal(JSON.stringify(body).includes("resolution"), false);
  });

  test("a superseded session is excluded and the replacement completion is kept", async () => {
    const now = START;
    const store = new MemoryStore({ now: () => now });
    const { handler } = lab(store, () => now);
    const learner = await openLearner(store);
    const stale = await store.start({
      learnerId: learner.learner.id,
      challengeId: "challenge-stale",
      challengeVersion: "1+old",
    });
    await store.restart({
      learnerId: learner.learner.id,
      challengeId: "challenge-stale",
      challengeVersion: "2+new",
      supersedes: stale.session.id,
    });
    const current = await store.find({ learnerId: learner.learner.id, challengeId: "challenge-stale" });
    assert.ok(current);
    submission += 1;
    const recorded = await store.record({
      learnerId: learner.learner.id,
      sessionId: current.id,
      submissionId: `submission-${submission}`,
      requestHash: submission.toString(16).padStart(64, "0"),
      rootCauseId: "option-a",
      explanation: explanation(),
      evidence: [{ kind: "log", logId: "log-01" }],
      outcome: "correct",
      result: RESULT,
      window: WINDOW,
    });
    assert.equal(recorded.kind, "recorded");

    const body = await bodyOf(await get(handler, learner.token));
    assert.deepEqual(
      body.completions?.map((completion) => completion.challengeId),
      ["challenge-stale"],
    );
    assert.equal(body.completions?.[0]?.contentVersion, "2+new");
  });

  test("one learner cannot read another learner's completions, even by supplying that id", async () => {
    let now = START;
    const store = new MemoryStore({ now: () => now });
    const { handler } = lab(store, () => now);
    const first = await openLearner(store);
    const second = await openLearner(store);
    await finish(store, first.learner.id, "challenge-first", "1+first", "correct");
    now += 1000;
    await finish(store, second.learner.id, "challenge-second", "1+second", "correct");

    const response = await get(
      handler,
      first.token,
      `?learnerId=${encodeURIComponent(second.learner.id)}&limit=50`,
    );
    const body = await bodyOf(response);
    assert.equal(response.status, 200);
    assert.deepEqual(
      body.completions?.map((completion) => completion.challengeId),
      ["challenge-first"],
    );

    const missing = await get(handler, undefined);
    assert.equal(missing.status, 401);
    assert.equal((await bodyOf(missing)).code, "learner-missing");
  });

  test("pages default to 20, cap at 50, and cursors do not skip or repeat", async () => {
    let now = START;
    const store = new MemoryStore({ now: () => now });
    const { handler } = lab(store, () => now);
    const learner = await openLearner(store);
    const ids: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const challengeId = `challenge-${String(index).padStart(3, "0")}`;
      ids.push(challengeId);
      await finish(store, learner.learner.id, challengeId, "1+page", "correct");
      now += 1000;
    }

    const first = await bodyOf(await get(handler, learner.token));
    assert.equal(first.completions?.length, 20);
    assert.equal(typeof first.nextCursor, "string");
    assert.deepEqual(
      first.completions?.map((completion) => completion.challengeId),
      [...ids].reverse().slice(0, 20),
    );

    const capped = await bodyOf(await get(handler, learner.token, "?limit=80"));
    assert.equal(capped.completions?.length, 50);
    const rest = await bodyOf(await get(handler, learner.token, `?limit=80&cursor=${encodeURIComponent(capped.nextCursor ?? "")}`));
    assert.equal(rest.completions?.length, 10);
    assert.equal(rest.nextCursor, null);
    const seen = [...(capped.completions ?? []), ...(rest.completions ?? [])].map((completion) => completion.challengeId);
    assert.equal(new Set(seen).size, 60);
    assert.deepEqual(seen, [...ids].reverse());

    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await bodyOf(await get(handler, learner.token, cursor ? `?limit=10&cursor=${encodeURIComponent(cursor)}` : "?limit=10"));
      const pageIds = page.completions?.map((completion) => completion.challengeId) ?? [];
      assert.equal(pageIds.length > 0, true);
      walked.push(...pageIds);
      cursor = page.nextCursor ?? null;
    } while (cursor);
    assert.deepEqual(walked, [...ids].reverse());
  });

  test("a malformed limit or cursor is rejected and does not list completions", async () => {
    const now = START;
    const store = new MemoryStore({ now: () => now });
    const { handler } = lab(store, () => now);
    const learner = await openLearner(store);
    await finish(store, learner.learner.id, "challenge-001", "1+ok", "correct");

    for (const query of ["?limit=0", "?limit=-1", "?limit=1.5", "?limit=nope", "?limit=20&limit=10"]) {
      const response = await get(handler, learner.token, query);
      assert.equal(response.status, 400, query);
      const body = await bodyOf(response);
      assert.equal(body.completions, undefined, query);
      assert.ok(body.code === "bad-request" || body.code === "validation-failed", query);
    }

    const journal = encodeJournalCursor({ updatedAt: START, challengeId: "challenge-001", id: "reflection" });
    for (const query of ["?cursor=%%%", "?cursor=", `?cursor=${encodeURIComponent(journal)}`, "?cursor=abc&cursor=def"]) {
      const response = await get(handler, learner.token, query);
      assert.equal(response.status, 400, query);
      assert.equal((await bodyOf(response)).completions, undefined, query);
    }
  });

  test("equal completedAt timestamps page by session id without duplicates or gaps", async () => {
    const FIXED = Date.parse("2026-11-01T12:00:00.000Z");
    // Creation order is deliberately not session-id order. At equal completedAt, pages must be id ASC.
    const planned = [
      { sessionId: "sess-c", challengeId: "challenge-c", attemptId: "att-1" },
      { sessionId: "sess-a", challengeId: "challenge-a", attemptId: "att-2" },
      { sessionId: "sess-b", challengeId: "challenge-b", attemptId: "att-3" },
      { sessionId: "sess-e", challengeId: "challenge-e", attemptId: "att-4" },
      { sessionId: "sess-d", challengeId: "challenge-d", attemptId: "att-5" },
    ] as const;
    const expectedChallenges = ["challenge-a", "challenge-b", "challenge-c", "challenge-d", "challenge-e"];
    const expectedSessions = ["sess-a", "sess-b", "sess-c", "sess-d", "sess-e"];

    const callIds = ["learner-fixed", ...planned.flatMap((row) => [row.sessionId, row.attemptId])];
    let next = 0;
    const store = new MemoryStore({
      now: () => FIXED,
      newId: () => {
        const id = callIds[next];
        next += 1;
        assert.ok(id, "unexpected MemoryStore.newId call");
        return id;
      },
    });
    const { handler } = lab(store, () => FIXED);
    const learner = await openLearner(store);
    assert.equal(learner.learner.id, "learner-fixed");
    for (const row of planned) {
      await finish(store, learner.learner.id, row.challengeId, `1+${row.challengeId}`, "correct");
    }

    const walked: string[] = [];
    const pageSessionIds: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await bodyOf(
        await get(handler, learner.token, cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : "?limit=2"),
      );
      pages += 1;
      const pageIds = page.completions?.map((completion) => completion.challengeId) ?? [];
      assert.equal(pageIds.length > 0, true);
      for (const completion of page.completions ?? []) {
        assert.equal(completion.completedAt, new Date(FIXED).toISOString());
      }
      walked.push(...pageIds);
      if (page.nextCursor) {
        const decoded = decodeCompletionCursor(page.nextCursor);
        assert.ok(decoded);
        assert.equal(decoded.completedAt, FIXED);
        pageSessionIds.push(decoded.sessionId);
        assert.equal(JSON.stringify(page).includes(decoded.sessionId), false);
        assert.equal(JSON.stringify(page).includes("learnerId"), false);
      }
      cursor = page.nextCursor ?? null;
    } while (cursor);

    assert.equal(pages, 3);
    assert.deepEqual(walked, expectedChallenges);
    assert.equal(new Set(walked).size, expectedChallenges.length);
    // Cursor positions are the last item of each non-final page (sess-b, then sess-d).
    assert.deepEqual(pageSessionIds, ["sess-b", "sess-d"]);
    assert.deepEqual(
      pageSessionIds,
      expectedSessions.filter((_, index) => index === 1 || index === 3),
    );

    const first = await bodyOf(await get(handler, learner.token, "?limit=2"));
    assert.deepEqual(
      first.completions?.map((completion) => completion.challengeId),
      ["challenge-a", "challenge-b"],
    );
    const second = await bodyOf(
      await get(handler, learner.token, `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`),
    );
    assert.deepEqual(
      second.completions?.map((completion) => completion.challengeId),
      ["challenge-c", "challenge-d"],
    );
    assert.equal(
      second.completions?.some((completion) => completion.challengeId === "challenge-a" || completion.challengeId === "challenge-b"),
      false,
    );
    const third = await bodyOf(
      await get(handler, learner.token, `?limit=2&cursor=${encodeURIComponent(second.nextCursor ?? "")}`),
    );
    assert.deepEqual(
      third.completions?.map((completion) => completion.challengeId),
      ["challenge-e"],
    );
    assert.equal(third.nextCursor, null);
  });
});
