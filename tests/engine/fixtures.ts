import type {
  RunOutcome,
  RunReport,
  RunScope,
  ScoringRules,
  SessionConfig,
  TestResult,
} from "@/engine/types";
import type {
  AttemptStatus,
  DiagnosisFeedback,
  DiagnosisResponse,
  DiagnosisResponseStatus,
} from "@/types/diagnosis";

type FixConfig = Extract<SessionConfig, { completion: "fix" }>;

export function makeDiagnosisConfig(): SessionConfig {
  return { challengeId: "000-fixture", completion: "diagnosis" };
}

export function makeFixConfig(overrides: Partial<FixConfig> = {}): FixConfig {
  return {
    challengeId: "000-fixture",
    completion: "fix",
    editableFiles: {
      "src/main.js": "export const x = 1;\n",
      "src/util.js": "export const y = 2;\n",
    },
    hintLimit: 3,
    ...overrides,
  };
}

export function makeScoringRules(): ScoringRules {
  return {
    diagnosisPoints: 30,
    wrongDiagnosisPenalty: 5,
    visibleFixPoints: 25,
    hiddenFixPoints: 45,
    hintCosts: [5, 10, 20],
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

const attempts: AttemptStatus = { used: 1, limit: 3, remaining: 2 };
const feedback: DiagnosisFeedback = {
  headline: "headline",
  hints: ["hint"],
  evidenceSummary: { total: 1, logs: 1, network: 0 },
};

// Typed per status: adding a status to DiagnosisResponse fails to compile here
// until this table (and therefore the adapter's coverage) is updated.
export const diagnosisResponses: { [S in DiagnosisResponseStatus]: Extract<DiagnosisResponse, { status: S }> } = {
  correct: { status: "correct", feedback, resolution: { summary: "fixed" }, attempts },
  incorrect: { status: "incorrect", feedback, attempts },
  invalid: { status: "invalid", errors: [{ field: "rootCauseId", message: "required" }] },
  "rate-limited": { status: "rate-limited", retryAfterSeconds: 60, attempts },
  error: { status: "error", message: "Couldn't reach the server." },
};
