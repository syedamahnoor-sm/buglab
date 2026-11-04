import type { RootCauseOption } from "./diagnosis";
import type { NetworkRequest } from "./investigation";

export type Difficulty ="beginner" | "intermediate" | "advanced";

/**
 * How a challenge is completed. "diagnosis": an accepted diagnosis solves it.
 * "fix": reserved for Fix Mode, which no challenge, runner or UI implements yet.
 */
export type CompletionMode = "diagnosis" | "fix";

/**
 * A learner's progress through one challenge. Learner state, not challenge
 * metadata: it is derived at runtime and never stored on a ChallengeSummary.
 */
export type InvestigationStatus =
  | "not-started"
  | "in-progress"
  | "submitted"
  | "resolved";

/** Static, learner-independent challenge metadata. */
export interface ChallengeSummary {
  id: string;
  number: string;
  title: string;
  incident: string;
  difficulty: Difficulty;
  completion: CompletionMode;
  tags: string[];
  estimatedMinutes: number;
}

export type FileNode =
  | { kind: "folder"; name: string; path: string; children: FileNode[] }
  | { kind: "file"; name: string; path: string };

/** Monaco language IDs the workspace can display. */
export type EditorLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "java"
  | "sql"
  | "mysql"
  | "pgsql"
  | "json"
  | "yaml"
  | "xml"
  | "ini"
  | "shell"
  | "dockerfile"
  | "markdown"
  | "log"
  | "plaintext";

/** A learner-visible file in a challenge scenario. */
export interface ScenarioFile {
  path: string;
  content: string;
  /**
   * Overrides the language detected from the file name, for files whose
   * extension is ambiguous, such as a `.sql` file written for PostgreSQL.
   */
  language?: EditorLanguage;
}

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

/** Everything the workspace needs to render one challenge. */
export interface WorkspaceScenario {
  /** Shape version of this contract; bump it when the shape changes. */
  contractVersion: 1;
  challenge: ChallengeSummary;
  files: ScenarioFile[];
  /** UTC date (YYYY-MM-DD) that log and network timestamps belong to. */
  incidentDate: string;
  logs: LogEntry[];
  network: NetworkRequest[];
  rootCauseOptions: RootCauseOption[];
  entryFilePath: string;
}
