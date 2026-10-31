import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateDiagnosis } from "@/server/diagnosis/evaluate";
import { createDefaultRegistry } from "@/server/diagnosis/registry";
import {
  CHALLENGE_ID,
  CORRECT_ID,
  CORRECT_LABEL,
  RESOLUTION,
  WRONG_IDS,
  submission,
} from "./fixtures";

const answerKey = createDefaultRegistry().get(CHALLENGE_ID)!.answerKey;

describe("evaluateDiagnosis", () => {
  test("a correct root cause is a correct diagnosis and includes the resolution", () => {
    const result = evaluateDiagnosis(submission({ rootCauseId: CORRECT_ID }), answerKey);
    assert.equal(result.status, "correct");
    assert.ok(result.status === "correct");
    assert.equal(result.resolution.summary, RESOLUTION);
  });

  test("correct even when none of the evidence is key evidence", () => {
    const result = evaluateDiagnosis(
      submission({ rootCauseId: CORRECT_ID, evidence: [{ kind: "log", logId: "log-01" }] }),
      answerKey,
    );
    assert.equal(result.status, "correct");
    assert.equal(result.feedback.hints[0], "Your evidence covered 0 of 4 key observations for this incident.");
  });

  test("every wrong option is incorrect, with no resolution", () => {
    for (const rootCauseId of WRONG_IDS) {
      const result = evaluateDiagnosis(submission({ rootCauseId }), answerKey);
      assert.equal(result.status, "incorrect", rootCauseId);
      assert.equal("resolution" in result, false);
    }
  });

  test("incorrect feedback is identical for every wrong option", () => {
    const feedback = WRONG_IDS.map((rootCauseId) =>
      JSON.stringify(evaluateDiagnosis(submission({ rootCauseId }), answerKey).feedback),
    );
    assert.equal(new Set(feedback).size, 1);
  });

  test("incorrect feedback never reveals the answer", () => {
    for (const rootCauseId of WRONG_IDS) {
      for (const evidence of [
        [{ kind: "log" as const, logId: "log-06" }],
        [{ kind: "network" as const, requestId: "req-01" }],
      ]) {
        const text = JSON.stringify(evaluateDiagnosis(submission({ rootCauseId, evidence }), answerKey));
        assert.equal(text.includes(CORRECT_ID), false);
        assert.equal(text.includes(CORRECT_LABEL), false);
        assert.equal(text.includes(RESOLUTION), false);
        assert.equal(/signed/i.test(text), false);
        assert.equal(/key observation/i.test(text), false);
      }
    }
  });

  test("evidence advice depends only on the learner's own evidence mix", () => {
    const logsOnly = evaluateDiagnosis(
      submission({ evidence: [{ kind: "log", logId: "log-06" }] }),
      answerKey,
    );
    assert.ok(logsOnly.feedback.hints.some((hint) => hint.includes("Network tab")));
    assert.deepEqual(logsOnly.feedback.evidenceSummary, { total: 1, logs: 1, network: 0 });

    const mixed = evaluateDiagnosis(
      submission({
        evidence: [
          { kind: "log", logId: "log-06" },
          { kind: "network", requestId: "req-04" },
        ],
      }),
      answerKey,
    );
    assert.equal(mixed.feedback.hints.length, 2);
  });
});
