/*
 * Learner completions on a throwaway PostgreSQL. The handler stays unmounted.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createDefaultRegistry } from "@/server/diagnosis/registry";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { createLearnerCompletionsHandler } from "@/server/session/handlers";
import { LearnerSessionService } from "@/server/session/service";
import { issueSessionToken } from "@/server/session/token";
import { RESULT } from "../session/attempt-contract";
import { SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const fixture = pgFixture();
const WINDOW = { limit: 5, windowMs: 60_000 };
const START = Date.parse("2026-11-01T00:00:00.000Z");

describe("learner completions on PostgreSQL", { skip: SKIP }, () => {
  test("verified completions are isolated, paged, and exclude incorrect and superseded sessions", async () => {
    const pg = await fixture();
    await pg.reset();
    let now = START;
    const store = pg.newStore({ now: () => now });
    const service = new LearnerSessionService({
      learners: store,
      sessions: store,
      attempts: store,
      registry: createDefaultRegistry(),
      challengeVersion: () => "1+test",
      now: () => now,
    });
    const handler = createLearnerCompletionsHandler({ service });

    const issued = issueSessionToken();
    const learner = await store.create({ tokenHash: issued.tokenHash });
    const otherIssued = issueSessionToken();
    const other = await store.create({ tokenHash: otherIssued.tokenHash });

    const wrong = await store.start({ learnerId: learner.id, challengeId: "challenge-wrong", challengeVersion: "1+wrong" });
    await store.record({
      learnerId: learner.id,
      sessionId: wrong.session.id,
      submissionId: "submission-wrong",
      requestHash: "1".padStart(64, "0"),
      rootCauseId: "option-a",
      explanation: "An explanation of what the learner believes is happening.",
      evidence: [{ kind: "log", logId: "log-01" }],
      outcome: "incorrect",
      window: WINDOW,
    });

    const stale = await store.start({ learnerId: learner.id, challengeId: "challenge-stale", challengeVersion: "1+old" });
    now += 1000;
    const replaced = await store.restart({
      learnerId: learner.id,
      challengeId: "challenge-stale",
      challengeVersion: "2+current",
      supersedes: stale.session.id,
    });
    assert.equal(replaced.restarted, true);
    await store.record({
      learnerId: learner.id,
      sessionId: replaced.session.id,
      submissionId: "submission-current",
      requestHash: "2".padStart(64, "0"),
      rootCauseId: "option-a",
      explanation: "An explanation of what the learner believes is happening.",
      evidence: [{ kind: "log", logId: "log-01" }],
      outcome: "correct",
      result: RESULT,
      window: WINDOW,
    });
    now += 1000;
    const newer = await store.start({ learnerId: learner.id, challengeId: "challenge-newer", challengeVersion: "1+newer" });
    await store.record({
      learnerId: learner.id,
      sessionId: newer.session.id,
      submissionId: "submission-newer",
      requestHash: "3".padStart(64, "0"),
      rootCauseId: "option-a",
      explanation: "An explanation of what the learner believes is happening.",
      evidence: [{ kind: "log", logId: "log-01" }],
      outcome: "correct",
      result: RESULT,
      window: WINDOW,
    });
    await store.start({ learnerId: other.id, challengeId: "challenge-other", challengeVersion: "1+other" });
    const otherSession = await store.find({ learnerId: other.id, challengeId: "challenge-other" });
    assert.ok(otherSession);
    await store.record({
      learnerId: other.id,
      sessionId: otherSession.id,
      submissionId: "submission-other",
      requestHash: "5".padStart(64, "0"),
      rootCauseId: "option-a",
      explanation: "An explanation of what the learner believes is happening.",
      evidence: [{ kind: "log", logId: "log-01" }],
      outcome: "correct",
      result: RESULT,
      window: WINDOW,
    });

    const read = (query = "") =>
      handler.GET(
        new Request(`http://localhost:3000/api/learner/completions${query}`, {
          headers: { cookie: `${LEARNER_COOKIE}=${issued.token}` },
        }),
      );

    const page = await read("?limit=1&learnerId=" + encodeURIComponent(other.id));
    assert.equal(page.status, 200);
    const first = await page.json();
    assert.deepEqual(
      first.completions.map((completion: { challengeId: string }) => completion.challengeId),
      ["challenge-newer"],
    );
    const second = await (await read(`?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
    assert.deepEqual(
      second.completions.map((completion: { challengeId: string; contentVersion: string }) => ({
        challengeId: completion.challengeId,
        contentVersion: completion.contentVersion,
      })),
      [{ challengeId: "challenge-stale", contentVersion: "2+current" }],
    );
    assert.equal(second.nextCursor, null);

    const bad = await read("?cursor=%%%");
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, "invalid-cursor");
  });
});
