export type Difficulty = "beginner" | "intermediate" | "advanced";

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

export interface OpenFile {
  path: string;
  name: string;
  language: string;
  lines: string[];
}

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}
