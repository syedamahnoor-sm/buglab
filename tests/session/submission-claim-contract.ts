/*
 * Reservation and finalization, shared by MemoryStore and PostgresStore.
 * A claim is not an attempt: list() and the rate-limit window stay empty until finalize.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { issueSessionToken } from "@/server/session/token";
import { StoreError, type RecordAttemptInput, type ReserveSubmissionInput } from "@/server/session/types";
import type { StoreHarness } from "./store-contract";

const CHALLENGE = "challenge-001";
const WINDOW = { limit: 3, windowMs: 600_000 };
const RESULT = {
  resolutionSummary: "The challenge is resolved: here is what happened.",
  feedback: { headline: "Diagnosis confirmed.", hints: ["A hint."], evidenceSummary: { total: 1, logs: 1, network: 0 } },
};

let counter = 0;
const hashOf = (n: number) => n.toString(16).padStart(64, "0");

async function session(store: StoreHarness["store"]) {
  const { tokenHash } = issueSessionToken();
  const learner = await store.create({ tokenHash });
  const started = await store.start({ learnerId: learner.id, challengeId: CHALLENGE, challengeVersion: "1" });
  return { learner, session: started.session };
}

function reserveInput(
  owner: { learner: { id: string }; session: { id: string } },
  overrides: Partial<ReserveSubmissionInput> = {},
): ReserveSubmissionInput {
  const n = ++counter;
  return {
    learnerId: owner.learner.id,
    sessionId: owner.session.id,
    submissionId: `submission-${n}`,
    requestHash: hashOf(n),
    rootCauseId: "option-a",
    explanation: "because the logs say so",
    evidence: [{ kind: "log", logId: "log-01" }],
    window: WINDOW,
    ...overrides,
  };
}

function finish(input: ReserveSubmissionInput, token: string, outcome: "correct" | "incorrect" = "incorrect"): RecordAttemptInput & { claimToken: string } {
  return {
    ...input,
    claimToken: token,
    outcome,
    ...(outcome === "correct" ? { result: RESULT } : {}),
  };
}

export function runSubmissionClaimContract(label: string, harness: () => Promise<StoreHarness> | StoreHarness, skip?: string | false) {
  describe(`submission claims: ${label}`, { skip: skip || false }, () => {
    test("a claim is not an attempt until it is finalized", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const input = reserveInput(owner);
      const claimed = await h.store.reserve(input);
      assert.equal(claimed.kind, "claimed");
      assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 0);
      assert.ok(claimed.kind === "claimed");
      const recorded = await h.store.finalize(finish(input, claimed.claim.token));
      assert.equal(recorded.kind, "recorded");
      assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 1);
      const again = await h.store.reserve(input);
      assert.equal(again.kind, "duplicate");
    });

    test("the same live claim is in progress, and different content is a conflict, with no second claim", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const input = reserveInput(owner);
      const claimed = await h.store.reserve(input);
      assert.equal(claimed.kind, "claimed");
      assert.equal((await h.store.reserve(input)).kind, "in-progress");
      const other = await h.store.reserve({ ...input, requestHash: hashOf(9_001), rootCauseId: "option-z" });
      assert.equal(other.kind, "conflict");
    });

    test("a completed session and a full window are refused before a claim exists", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const correct = reserveInput(owner);
      const claimed = await h.store.reserve(correct);
      assert.ok(claimed.kind === "claimed");
      assert.equal((await h.store.finalize(finish(correct, claimed.claim.token, "correct"))).kind, "recorded");
      const later = await h.store.reserve(reserveInput(owner));
      assert.equal(later.kind, "already-completed");

      const limited = await session(h.store);
      for (let i = 0; i < WINDOW.limit; i += 1) {
        const input = reserveInput(limited);
        const gate = await h.store.reserve(input);
        assert.ok(gate.kind === "claimed");
        assert.equal((await h.store.finalize(finish(input, gate.claim.token))).kind, "recorded");
      }
      assert.equal((await h.store.reserve(reserveInput(limited))).kind, "rate-limited");
    });

    test("an expired claim can be taken, and the old token finalizes nothing", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const input = reserveInput(owner);
      const first = await h.store.reserve(input);
      assert.ok(first.kind === "claimed");
      await h.advance(30_000 + 1);
      const second = await h.store.reserve(input);
      assert.ok(second.kind === "claimed");
      assert.notEqual(second.claim.token, first.claim.token);
      assert.equal((await h.store.finalize(finish(input, first.claim.token))).kind, "claim-lost");
      assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 0);
      assert.equal((await h.store.finalize(finish(input, second.claim.token))).kind, "recorded");
      assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 1);
    });

    test("twenty concurrent identical reserves produce one claim", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const input = reserveInput(owner);
      const results = await Promise.all(Array.from({ length: 20 }, () => h.store.reserve(input)));
      assert.equal(results.filter((result) => result.kind === "claimed").length, 1);
      assert.equal(results.filter((result) => result.kind === "in-progress").length, 19);
    });

    test("concurrent different content under one id has one claimant", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const left = reserveInput(owner);
      const right = { ...left, requestHash: hashOf(8_888), rootCauseId: "option-z" };
      const results = await Promise.all([h.store.reserve(left), h.store.reserve(right)]);
      assert.equal(results.filter((result) => result.kind === "claimed").length, 1);
      assert.equal(results.filter((result) => result.kind === "conflict").length, 1);
    });

    test("releasing a claim lets the same submission be claimed again", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const input = reserveInput(owner);
      const claimed = await h.store.reserve(input);
      assert.ok(claimed.kind === "claimed");
      await h.store.releaseClaim({ sessionId: owner.session.id, claimToken: claimed.claim.token });
      const again = await h.store.reserve(input);
      assert.equal(again.kind, "claimed");
    });

    test("releasing a different token leaves the live claim in place", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const input = reserveInput(owner);
      const claimed = await h.store.reserve(input);
      assert.ok(claimed.kind === "claimed");
      await h.store.releaseClaim({ sessionId: owner.session.id, claimToken: "not-the-claim-token" });
      assert.equal((await h.store.reserve(input)).kind, "in-progress");
      assert.equal((await h.store.finalize(finish(input, claimed.claim.token))).kind, "recorded");
      assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 1);
    });

    test("a second finalize of the same claim records nothing more", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const input = reserveInput(owner);
      const claimed = await h.store.reserve(input);
      assert.ok(claimed.kind === "claimed");
      const done = finish(input, claimed.claim.token, "correct");
      const results = await Promise.all([h.store.finalize(done), h.store.finalize(done)]);
      assert.equal(results.filter((result) => result.kind === "recorded").length, 1);
      assert.equal(results.filter((result) => result.kind === "claim-lost").length, 1);
      assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 1);
      const current = await h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE });
      assert.equal(current?.status, "completed");
      assert.equal((await h.store.listCurrentCompleted(owner.learner.id)).length, 1);
    });

    test("finalizing with another learner's id is refused and records nothing", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const intruder = await session(h.store);
      const input = reserveInput(owner);
      const claimed = await h.store.reserve(input);
      assert.ok(claimed.kind === "claimed");
      await assert.rejects(
        h.store.finalize({ ...finish(input, claimed.claim.token, "correct"), learnerId: intruder.learner.id }),
        (error: unknown) => error instanceof StoreError && error.code === "not-owner",
      );
      assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 0);
      assert.equal((await h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE }))?.status, "active");
      assert.equal((await h.store.listCurrentCompleted(owner.learner.id)).length, 0);
    });

    test("a live claim cannot complete a session a restart has superseded", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const input = reserveInput(owner);
      const claimed = await h.store.reserve(input);
      assert.ok(claimed.kind === "claimed");
      const restarted = await h.store.restart({
        learnerId: owner.learner.id,
        challengeId: CHALLENGE,
        challengeVersion: "2",
        supersedes: owner.session.id,
      });
      assert.equal(restarted.restarted, true);
      await assert.rejects(
        h.store.finalize(finish(input, claimed.claim.token, "correct")),
        (error: unknown) => error instanceof StoreError && error.code === "superseded",
      );
      assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 0);
      const current = await h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE });
      assert.equal(current?.id, restarted.session.id);
      assert.equal(current?.status, "active");
      assert.notEqual(current?.id, owner.session.id);
      assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: current!.id })).length, 0);
      assert.equal((await h.store.listCurrentCompleted(owner.learner.id)).length, 0);
    });

    test("finalizing with the right token and a different request hash loses the claim and records nothing", async () => {
      const h = await harness();
      const owner = await session(h.store);
      const input = reserveInput(owner);
      const claimed = await h.store.reserve(input);
      assert.ok(claimed.kind === "claimed");
      const mismatched = finish({ ...input, requestHash: hashOf(9_999) }, claimed.claim.token, "correct");
      assert.equal((await h.store.finalize(mismatched)).kind, "claim-lost");
      assert.equal((await h.store.list({ learnerId: owner.learner.id, sessionId: owner.session.id })).length, 0);
      assert.equal((await h.store.find({ learnerId: owner.learner.id, challengeId: CHALLENGE }))?.status, "active");
      // The original claim is still held: the same payload is in progress, not a second claim.
      assert.equal((await h.store.reserve(input)).kind, "in-progress");
    });
  });
}
