export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface WorkspaceFile {
  path: string;
  contents: string;
  readOnly: boolean;
}

export interface ScoringRules {
  diagnosisPoints: number;
  wrongDiagnosisPenalty: number;
  visibleFixPoints: number;
  hiddenFixPoints: number;
  // Cost of each hint, in reveal order. Its length is the number of hints.
  hintCosts: readonly number[];
}

export interface ChallengeSummary {
  id: string;
  title: string;
  summary: string;
  difficulty: Difficulty;
  tags: readonly string[];
  estMinutes: number;
}

// The only challenge shape the workspace UI ever receives. Answer keys, hint
// text, hidden tests and the reference solution are deliberately absent.
export interface ChallengePublic extends ChallengeSummary {
  language: "javascript";
  symptom: string;
  files: readonly WorkspaceFile[];
  causeOptions: readonly { id: string; label: string }[];
  scoring: ScoringRules;
  runTimeoutMs: number;
}

export type TestVisibility = "visible" | "hidden";
export type TestStatus = "pass" | "fail" | "error" | "timeout";

// For hidden tests the engine reports a generic name and message, so a failing
// hidden test never leaks what it checks.
export interface TestResult {
  id: string;
  name: string;
  visibility: TestVisibility;
  status: TestStatus;
  message?: string;
  durationMs: number;
}

export interface ConsoleLine {
  level: "log" | "warn" | "error";
  text: string;
}

export type RunScope = "visible" | "all";
export type RunOutcome = "passed" | "failed" | "timeout" | "crashed";

export interface RunReport {
  scope: RunScope;
  outcome: RunOutcome;
  results: readonly TestResult[];
  console: readonly ConsoleLine[];
  durationMs: number;
  error?: string;
}

export type SessionStatus = "in_progress" | "solved" | "revealed";

export interface SessionState {
  version: 1;
  challengeId: string;
  // Current contents of the editable files only.
  files: Readonly<Record<string, string>>;
  hintLimit: number;
  hintsUsed: number;
  wrongDiagnoses: number;
  diagnosed: boolean;
  runs: number;
  lastRun: RunReport | null;
  editedSinceRun: boolean;
  passedVisible: boolean;
  passedAll: boolean;
  status: SessionStatus;
}

export type SessionEvent =
  | { type: "FILE_EDITED"; path: string; contents: string }
  | { type: "RUN_COMPLETED"; report: RunReport }
  | { type: "HINT_REVEALED" }
  | { type: "DIAGNOSIS_CHECKED"; correct: boolean }
  | { type: "REVEALED" };

export interface ScoreBreakdown {
  diagnosis: number;
  visibleFix: number;
  hiddenFix: number;
  hintPenalty: number;
}

export interface Score {
  total: number;
  max: number;
  breakdown: ScoreBreakdown;
}
