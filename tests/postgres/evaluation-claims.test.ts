/*
 * The session service on PostgreSQL: one evaluation for a stampeded submission, and a
 * finalization that fails in the database leaves neither an attempt nor a completion.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deterministicDiagnosisEvaluator, type DiagnosisEvaluator } from "@/server/diagnosis/evaluator";
import { createDefaultRegistry } from "@/server/diagnosis/registry";
import { createLearnerSessionService } from "@/server/session/service";
import { issueSessionToken } from "@/server/session/token";
import { CHALLENGE_ID, WRONG_IDS, submission } from "../diagnosis/fixtures";
import { SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const fixture = pgFixture();
const uuid = "0a0b0c0d-2222-4000-8000-000000000001";

function counting(): { evaluator: DiagnosisEvaluator; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    evaluator: {
      evaluate(request) {
        calls += 1;
        return deterministicDiagnosisEvaluator.evaluate(request);
      },
    },
  };
}

describe("PostgreSQL submission claims through the session service", { skip: SKIP }, () => {
  test("twenty concurrent identical submissions evaluate once", async () => {
    const pg = await fixture();
    await pg.reset();
    const store = pg.newStore();
    const counted = counting();
    const service = createLearnerSessionService({
      learners: store,
      sessions: store,
      attempts: store,
      registry: createDefaultRegistry(),
      challengeVersion: () => "1",
      evaluator: counted.evaluator,
    });
    const cookie = (await service.startLearner(undefined)).cookie.value;
    assert.equal((await service.startChallenge(cookie, CHALLENGE_ID)).status, "ok");
    const body = submission({ rootCauseId: WRONG_IDS[0] });
    const results = await Promise.all(Array.from({ length: 20 }, () => service.submitDiagnosis(cookie, CHALLENGE_ID, body, { submissionId: uuid })));
    assert.equal(counted.calls(), 1);
    assert.equal(results.filter((result) => result.status === "ok" && !result.replayed).length, 1);
    const rows = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM diagnosis_attempts");
    assert.equal(rows.rows[0].n, 1);
    const claims = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM diagnosis_submission_claims");
    assert.equal(claims.rows[0].n, 0);
  });

  test("a database lock during finalization writes nothing and keeps the claim", async () => {
    const pg = await fixture();
    await pg.reset();
    const store = pg.newStore();
    const owner = await store.create({ tokenHash: issueSessionToken().tokenHash });
    const { session } = await store.start({ learnerId: owner.id, challengeId: CHALLENGE_ID, challengeVersion: "1" });
    const input = {
      learnerId: owner.id,
      sessionId: session.id,
      submissionId: "finalize-fail",
      requestHash: "cd".repeat(32),
      rootCauseId: "option-a",
      explanation: "because",
      evidence: [{ kind: "log" as const, logId: "log-01" }],
      window: { limit: 3, windowMs: 600_000 },
    };
    const claimed = await store.reserve(input);
    assert.ok(claimed.kind === "claimed");

    const locker = await pg.newPool(1).connect();
    try {
      await locker.query("BEGIN");
      await locker.query("LOCK TABLE diagnosis_attempts IN SHARE ROW EXCLUSIVE MODE");
      await assert.rejects(store.finalize({ ...input, claimToken: claimed.claim.token, outcome: "incorrect" }));
      await locker.query("ROLLBACK");
    } finally {
      locker.release();
    }

    const attempts = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM diagnosis_attempts");
    const claims = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM diagnosis_submission_claims");
    assert.equal(attempts.rows[0].n, 0);
    assert.equal(claims.rows[0].n, 1);
    const sessionRow = await pg.query<{ status: string }>("SELECT status FROM challenge_sessions WHERE id = $1", [session.id]);
    assert.equal(sessionRow.rows[0].status, "active");
  });
});
