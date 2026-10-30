import type {
  ChallengePublic,
  RunOutcome,
  RunReport,
  RunScope,
  TestResult,
} from "./types";

export function makeChallenge(
  overrides: Partial<ChallengePublic> = {},
): ChallengePublic {
  return {
    id: "000-fixture",
    title: "Fixture",
    summary: "A challenge used only by tests.",
    difficulty: 1,
    tags: ["fixture"],
    estMinutes: 5,
    language: "javascript",
    symptom: "Something is broken.",
    files: [
      { path: "src/main.js", contents: "export const x = 1;\n", readOnly: false },
      { path: "src/util.js", contents: "export const y = 2;\n", readOnly: false },
      { path: "tests/visible.js", contents: "// tests\n", readOnly: true },
    ],
    causeOptions: [
      { id: "a", label: "Option A" },
      { id: "b", label: "Option B" },
    ],
    scoring: {
      diagnosisPoints: 30,
      wrongDiagnosisPenalty: 5,
      visibleFixPoints: 25,
      hiddenFixPoints: 45,
      hintCosts: [5, 10, 20],
    },
    runTimeoutMs: 2000,
    ...overrides,
  };
}

export function makeResult(
  overrides: Partial<TestResult> = {},
): TestResult {
  return {
    id: "t1",
    name: "a test",
    visibility: "visible",
    status: "pass",
    durationMs: 1,
    ...overrides,
  };
}

export function makeReport(
  scope: RunScope,
  outcome: RunOutcome,
  results: TestResult[],
): RunReport {
  return { scope, outcome, results, console: [], durationMs: 5 };
}

export function passingVisibleReport(): RunReport {
  return makeReport("visible", "passed", [makeResult()]);
}

export function failingVisibleReport(): RunReport {
  return makeReport("visible", "failed", [makeResult({ status: "fail" })]);
}

// Visible tests pass but a hidden test fails: the typical "naive fix" outcome.
export function visibleOnlyPassReport(): RunReport {
  return makeReport("all", "failed", [
    makeResult({ id: "v1" }),
    makeResult({ id: "h1", name: "Hidden test 1", visibility: "hidden", status: "fail" }),
  ]);
}

export function passingAllReport(): RunReport {
  return makeReport("all", "passed", [
    makeResult({ id: "v1" }),
    makeResult({ id: "h1", name: "Hidden test 1", visibility: "hidden" }),
  ]);
}
