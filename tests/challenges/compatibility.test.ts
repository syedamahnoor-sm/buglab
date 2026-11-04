/*
 * The registry must be a drop-in for the diagnosis registry that exists today: the
 * handler, the evaluator and the learner-session service are given it unchanged and
 * must behave exactly as they do with createDefaultRegistry().
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { challenge001 } from "@/data/challenge-001";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { evaluateDiagnosis } from "@/server/diagnosis/evaluate";
import { createDiagnosisHandler } from "@/server/diagnosis/handler";
import { createDefaultRegistry, validationContextFor, type DiagnosisRegistry } from "@/server/diagnosis/registry";
import { MemoryStore } from "@/server/session/memory-store";
import { createLearnerSessionService } from "@/server/session/service";
import { validateDiagnosisSubmission } from "@/lib/diagnosis/validate";
import type { DiagnosisSubmission } from "@/types/diagnosis";
import { attemptCookieFrom, CHALLENGE_ID, CORRECT_ID, RESOLUTION, WRONG_IDS, post, submission } from "../diagnosis/fixtures";
import { assertContentVersion, toPlain } from "./helpers";
import { challenge001Definition } from "@/server/challenges/challenge-001";

const registry = createDefaultChallengeRegistry();

describe("compatibility with DiagnosisRegistry", () => {
  test("diagnosisRegistry is a ReadonlyMap<string, DiagnosisChallenge> and answers has() and get()", () => {
    const map: DiagnosisRegistry = registry.diagnosisRegistry;

    assert.equal(map.size, 1);
    assert.deepEqual([...map.keys()], [CHALLENGE_ID]);
    assert.equal(map.has(CHALLENGE_ID), true);
    assert.equal(map.get(CHALLENGE_ID), registry.getDiagnosis(CHALLENGE_ID));
  });

  test("it is deeply equal to the registry the diagnosis route builds today", () => {
    // The loader's registry holds read-only views and the existing one real Maps and Sets, so compare the data.
    const loaded = toPlain(registry.diagnosisRegistry) as { __map: unknown[] };
    assert.equal(loaded.__map.length, 1);
    assert.deepStrictEqual(loaded, toPlain(createDefaultRegistry()));
  });

  test("getDiagnosis returns the existing DiagnosisChallenge shape", () => {
    const diagnosis = registry.getDiagnosis(CHALLENGE_ID)!;

    assert.deepEqual(Object.keys(diagnosis).sort(), ["answerKey", "challengeId", "validation"]);
    assert.deepEqual(Object.keys(diagnosis.answerKey).sort(), ["correctRootCauseId", "keyObservations", "resolutionSummary"]);
    assert.deepStrictEqual(toPlain(diagnosis.validation), toPlain(validationContextFor(challenge001)));
    assert.equal(diagnosis.answerKey.correctRootCauseId, CORRECT_ID);
    assert.equal(diagnosis.answerKey.resolutionSummary, RESOLUTION);
    assert.equal(diagnosis.answerKey.keyObservations.length, 4);
  });

  test("the existing validator and evaluator give the same results with either registry", () => {
    const fromLoader = registry.getDiagnosis(CHALLENGE_ID)!;
    const fromDefault = createDefaultRegistry().get(CHALLENGE_ID)!;
    const inputs = [
      submission({ rootCauseId: CORRECT_ID, evidence: [{ kind: "network", requestId: "req-01" }, { kind: "log", logId: "log-06" }] }),
      submission({ rootCauseId: WRONG_IDS[0] }),
      submission({ rootCauseId: CORRECT_ID, evidence: [{ kind: "log", logId: "log-99" }] }),
      submission({ explanation: "too short" }),
    ];

    for (const input of inputs) {
      const a = validateDiagnosisSubmission(input, fromLoader.validation);
      const b = validateDiagnosisSubmission(input, fromDefault.validation);
      assert.deepStrictEqual(a, b);
      if (a.ok && b.ok) assert.deepStrictEqual(evaluateDiagnosis(a.value, fromLoader.answerKey), evaluateDiagnosis(b.value, fromDefault.answerKey));
    }
  });

  test("the existing diagnosis handler gives identical responses with the loader's registry", async () => {
    const clock = () => Date.parse("2026-11-02T10:00:00Z");
    const handlerWith = (diagnosisRegistry: DiagnosisRegistry) =>
      createDiagnosisHandler({
        registry: diagnosisRegistry,
        wrongAttempts: new FixedWindowLimiter({ limit: 3, windowMs: 10 * 60_000, now: clock }),
        ipSubmissions: new FixedWindowLimiter({ limit: 10, windowMs: 10 * 60_000, now: clock }),
        trustedProxyHops: 0,
        appOrigin: null, // development behaviour: these requests send no Origin, and the test is about the registry, not Origin
      });
    const cookieA = "buglab_attempt=11111111-1111-4111-8111-111111111111";
    const steps: { body: DiagnosisSubmission; headers: Record<string, string> }[] = [
      { body: submission({ rootCauseId: WRONG_IDS[0] }), headers: { cookie: cookieA } },
      { body: submission({ rootCauseId: WRONG_IDS[1] }), headers: { cookie: cookieA } },
      { body: submission({ explanation: "too short" }), headers: { cookie: cookieA } },
      { body: submission({ rootCauseId: WRONG_IDS[2] }), headers: { cookie: cookieA } },
      { body: submission({ rootCauseId: CORRECT_ID }), headers: { cookie: cookieA } },
      { body: submission({ rootCauseId: CORRECT_ID }), headers: {} },
    ];

    const viaLoader = handlerWith(registry.diagnosisRegistry);
    const viaDefault = handlerWith(createDefaultRegistry());
    const statuses: unknown[] = [];
    for (const step of steps) {
      const a = await post(viaLoader, step);
      const b = await post(viaDefault, step);
      assert.equal(a.response.status, b.response.status);
      assert.deepEqual(a.json, b.json);
      statuses.push(a.json.status);
    }
    assert.deepEqual(statuses, ["incorrect", "incorrect", "invalid", "incorrect", "rate-limited", "correct"]);

    const unknown = await post(viaLoader, { challengeId: "challenge-999" });
    assert.equal(unknown.response.status, 404);
  });

  test("the existing handler still issues its own attempt cookie when given the loader's registry", async () => {
    const handler = createDiagnosisHandler({
      registry: registry.diagnosisRegistry,
      wrongAttempts: new FixedWindowLimiter({ limit: 3, windowMs: 60_000 }),
      ipSubmissions: new FixedWindowLimiter({ limit: 10, windowMs: 60_000 }),
      trustedProxyHops: 0,
      appOrigin: null, // development behaviour: the cookie's Secure attribute follows the request URL, as it did before
    });
    const { response } = await post(handler);
    assert.match(attemptCookieFrom(response), /^buglab_attempt=[0-9a-f-]{36}$/);
  });
});

describe("compatibility with LearnerSessionService", () => {
  function setup() {
    const store = new MemoryStore();
    return createLearnerSessionService({
      learners: store,
      sessions: store,
      attempts: store,
      registry: registry.diagnosisRegistry,
      challengeVersion: (id: string) => registry.contentVersion(id) ?? "unknown",
    });
  }

  test("consumes the registry unchanged: start, a wrong answer, then the right one completes the session", async () => {
    const service = setup();
    const { cookie } = await service.startLearner(undefined);

    const started = await service.startChallenge(cookie.value, CHALLENGE_ID);
    assert.ok(started.status === "ok");
    assert.equal(started.created, true);

    const wrong = await service.submitDiagnosis(cookie.value, CHALLENGE_ID, submission({ rootCauseId: WRONG_IDS[0] }));
    assert.ok(wrong.status === "ok" && wrong.response.status === "incorrect");

    const right = await service.submitDiagnosis(cookie.value, CHALLENGE_ID, submission({ rootCauseId: CORRECT_ID }));
    assert.ok(right.status === "ok" && right.response.status === "correct");
    assert.equal(right.response.resolution.summary, RESOLUTION);

    const session = await service.getChallengeSession(cookie.value, CHALLENGE_ID);
    assert.ok(session.status === "ok" && session.session?.status === "completed");
  });

  test("the session records the registry's content version", async () => {
    const service = setup();
    const { cookie } = await service.startLearner(undefined);

    const started = await service.startChallenge(cookie.value, CHALLENGE_ID);

    assert.ok(started.status === "ok");
    assert.equal(started.session.contentVersion, registry.contentVersion(CHALLENGE_ID));
    assertContentVersion(started.session.contentVersion, challenge001Definition.revision);
  });

  test("the version source is required: a service cannot be built that gives every challenge the same version", () => {
    const store = new MemoryStore();
    // @ts-expect-error challengeVersion is required. tsc fails this line if it ever becomes optional again.
    createLearnerSessionService({ learners: store, sessions: store, attempts: store, registry: registry.diagnosisRegistry });
  });

  test("a challenge the registry does not know is refused", async () => {
    const service = setup();
    const { cookie } = await service.startLearner(undefined);

    const result = await service.startChallenge(cookie.value, "challenge-999");

    assert.ok(result.status === "rejected" && result.code === "unknown-challenge");
  });
});
