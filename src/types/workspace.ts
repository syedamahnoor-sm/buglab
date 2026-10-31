import type { NetworkRequest } from "./investigation";

export type Difficulty ="beginner" | "intermediate" | "advanced";

export type InvestigationStatus =
  | "not-started"
  | "in-progress"
  | "submitted"
  | "resolved";

export interface ChallengeSummary {
  id: string;
  number: string;
  title: string;
  incident: string;
  difficulty: Difficulty;
  status: InvestigationStatus;
  tags: string[];
  estimatedMinutes: number;
}

export type FileNode =
  | { kind: "folder"; name: string; path: string; children: FileNode[] }
  | { kind: "file"; name: string; path: string };

export type EditorLanguage =
  | "typescript"
  | "javascript"
  | "markdown"
  | "json"
  | "log"
  | "plaintext";

/** A learner-visible file in a challenge scenario. */
export interface ScenarioFile {
  path: string;
  content: string;
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
  challenge: ChallengeSummary;
  files: ScenarioFile[];
  /** UTC date (YYYY-MM-DD) that log and network timestamps belong to. */
  incidentDate: string;
  logs: LogEntry[];
  network: NetworkRequest[];
  entryFilePath: string;
}
