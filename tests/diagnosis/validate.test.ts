import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  EVIDENCE_MAX_ITEMS,
  EXPLANATION_MAX_LENGTH,
  validateDiagnosisSubmission,
} from "@/lib/diagnosis/validate";
import { EXPLANATION, WRONG_IDS, submission, validationContext } from "./fixtures";

function fieldsOf(input: unknown) {
  const result = validateDiagnosisSubmission(input, validationContext);
  return result.ok ? [] : result.errors.map((error) => error.field);
}

describe("validateDiagnosisSubmission", () => {
  test("accepts a complete submission", () => {
    const result = validateDiagnosisSubmission(submission(), validationContext);
    assert.equal(result.ok, true);
  });

  test("rejects non-object bodies", () => {
    for (const input of [null, "text", 42, [], true]) {
      assert.deepEqual(fieldsOf(input), ["body"]);
    }
  });

  test("requires a known root-cause option", () => {
    assert.deepEqual(fieldsOf(submission({ rootCauseId: "made-up-option" })), ["rootCauseId"]);
    assert.deepEqual(fieldsOf({ ...submission(), rootCauseId: 7 }), ["rootCauseId"]);
    assert.deepEqual(fieldsOf({ ...submission(), rootCauseId: undefined }), ["rootCauseId"]);
  });

  test("requires an explanation of reasonable length", () => {
    assert.deepEqual(fieldsOf(submission({ explanation: "too short" })), ["explanation"]);
    assert.deepEqual(fieldsOf(submission({ explanation: "   " })), ["explanation"]);
    assert.deepEqual(
      fieldsOf(submission({ explanation: "x".repeat(EXPLANATION_MAX_LENGTH + 1) })),
      ["explanation"],
    );
    assert.deepEqual(fieldsOf({ ...submission(), explanation: ["not", "a", "string"] }), [
      "explanation",
    ]);
  });

  test("strips control characters and normalises line endings", () => {
    const result = validateDiagnosisSubmission(
      submission({ explanation: `\u0000${EXPLANATION}\r\nSecond line\u0007` }),
      validationContext,
    );
    assert.ok(result.ok);
    assert.equal(result.value.explanation, `${EXPLANATION}\nSecond line`);
  });

  test("does not count control characters toward the minimum length", () => {
    const padded = `${"\u0001".repeat(60)}short`;
    assert.deepEqual(fieldsOf(submission({ explanation: padded })), ["explanation"]);
  });

  test("requires at least one evidence item", () => {
    assert.deepEqual(fieldsOf(submission({ evidence: [] })), ["evidence"]);
    assert.deepEqual(fieldsOf({ ...submission(), evidence: "req-04" }), ["evidence"]);
  });

  test("rejects unknown or malformed evidence references", () => {
    const bad = [
      { kind: "network", requestId: "req-99" },
      { kind: "log", logId: "log-99" },
      { kind: "file", path: "src/server.ts" },
      { kind: "log", logId: 6 },
      "log-06",
      null,
    ];
    for (const item of bad) {
      assert.deepEqual(fieldsOf(submission({ evidence: [item as never] })), ["evidence"], JSON.stringify(item));
    }
  });

  test("rejects too many evidence items", () => {
    const evidence = Array.from({ length: EVIDENCE_MAX_ITEMS + 1 }, () => ({
      kind: "log" as const,
      logId: "log-06",
    }));
    assert.deepEqual(fieldsOf(submission({ evidence })), ["evidence"]);
  });

  test("de-duplicates evidence and drops extra properties", () => {
    const result = validateDiagnosisSubmission(
      submission({
        evidence: [
          { kind: "log", logId: "log-06" },
          { kind: "log", logId: "log-06", extra: "ignored" } as never,
          { kind: "network", requestId: "req-04" },
        ],
      }),
      validationContext,
    );
    assert.ok(result.ok);
    assert.deepEqual(result.value.evidence, [
      { kind: "log", logId: "log-06" },
      { kind: "network", requestId: "req-04" },
    ]);
  });

  test("ignores unknown top-level fields such as a forged correctness flag", () => {
    const result = validateDiagnosisSubmission(
      { ...submission({ rootCauseId: WRONG_IDS[1] }), correct: true, score: 100 },
      validationContext,
    );
    assert.ok(result.ok);
    assert.deepEqual(Object.keys(result.value).sort(), ["evidence", "explanation", "rootCauseId"]);
  });

  test("reports every invalid field at once", () => {
    assert.deepEqual(fieldsOf({ rootCauseId: "", explanation: "", evidence: [] }), [
      "rootCauseId",
      "explanation",
      "evidence",
    ]);
  });
});
