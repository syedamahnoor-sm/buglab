import type { CompletionMode } from "@/types/workspace";

export interface ScoringRules {
  diagnosisPoints: number;
  wrongDiagnosisPenalty: number;
  visibleFixPoints: number;
  hiddenFixPoints: number;
  // Cost of each hint, in reveal order. Its length is the number of hints.
  hintCosts: readonly number[];
}

// Challenge data (metadata, files, root-cause options) lives in @/types/workspace.
// A session needs only the challenge's identity and how it is completed.
export type SessionConfig = { challengeId: string } & (
  | { completion: "diagnosis" }
  // Fix Mode is reserved: no challenge, runner or UI uses it yet.
  | {
      completion: "fix";
      editableFiles: Readonly<Record<string, string>>;
      hintLimit?: number;
    }
);

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
  completion: CompletionMode;
  // Current contents of the editable files only (empty in diagnosis mode).
  files: Readonly<Record<string, string>>;
  hintLimit: number;
  hintsUsed: number;
  // True once the server has accepted a diagnosis. The engine never counts
  // wrong attempts: the diagnosis API owns attempts and rate limits.
  diagnosed: boolean;
  runs: number;
  lastRun: RunReport | null;
  editedSinceRun: boolean;
  passedVisible: boolean;
  passedAll: boolean;
  status: SessionStatus;
}

export type SessionEvent =
  // The server confirmed a correct diagnosis. The only diagnosis event: other
  // outcomes (incorrect, invalid, rate-limited, error) leave the session as is.
  | { type: "DIAGNOSIS_ACCEPTED" }
  | { type: "FILE_EDITED"; path: string; contents: string }
  | { type: "RUN_COMPLETED"; report: RunReport }
  | { type: "HINT_REVEALED" }
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
