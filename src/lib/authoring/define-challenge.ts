/*
 * The authoring format for challenges after Challenge 001. Public: everything
 * written with it is learner-visible, so it imports nothing from src/server and
 * is never given an answer. Answer keys are written separately with
 * src/server/content/define-answer-key.ts.
 *
 * It expands a compact spec into the same WorkspaceScenario and listing that
 * Challenge 001 spells out by hand, and keeps the derived parts consistent:
 *
 * - log IDs are numbered in order (log-01, log-02, ...) and the log lines are
 *   also written into a log file in the File Explorer, so the two always agree;
 * - a request tied to an `[http]` log line takes its time, method, path and
 *   status from that line, and its browser duration is never shorter than the
 *   server's;
 * - request IDs are numbered in order (req-01, ...), and the URL, status text
 *   and the usual headers are filled in.
 *
 * See docs/authoring/challenges.md.
 */
import type { CatalogEntry, CategoryId, PublicationStatus } from "@/types/catalog";
import type { RootCauseOption } from "@/types/diagnosis";
import type { HttpHeader, NetworkRequest, NetworkRequestType } from "@/types/investigation";
import type { Difficulty, LogEntry, LogLevel, ScenarioFile, WorkspaceScenario } from "@/types/workspace";

/** [time of day (HH:mm:ss.SSS, UTC), level, source, message] */
export type LogLine = readonly [timestamp: string, level: LogLevel, source: string, message: string];

export interface RequestSpec {
  /** 1-based position of this request's server log line in `logs`. */
  log?: number;
  /** Required when there is no `[http]` log line to take them from. */
  at?: string;
  method?: "GET" | "POST";
  path?: string;
  status?: number;
  /** Browser time. Defaults to the server-logged time plus a network round trip. */
  ms?: number;
  type?: NetworkRequestType;
  initiator?: string;
  requestHeaders?: Record<string, string>;
  body?: string;
  responseHeaders?: Record<string, string>;
  response?: string;
}

export interface ChallengeSpec {
  /** Three or more digits; the challenge ID is `challenge-<number>`. */
  number: string;
  title: string;
  incident: string;
  difficulty: Difficulty;
  tags: string[];
  estimatedMinutes: number;
  /** Listing: one or two sentences describing the situation, never the cause. */
  description: string;
  category: CategoryId;
  technologies: string[];
  status?: PublicationStatus;
  featured?: boolean;
  publishedAt?: string;
  /** UTC date (YYYY-MM-DD) of the incident. */
  incidentDate: string;
  /** Scheme and host the captured requests were made to. */
  origin: string;
  /** Learner-visible files, in File Explorer order. */
  files: Record<string, string>;
  logs: readonly LogLine[];
  /** Where the log lines are also shown as a file. Default "logs/app.log"; null for none. */
  logFile?: string | null;
  network?: readonly RequestSpec[];
  /** [id, label, description], in the order the learner sees them. Nothing marks the correct one. */
  options: readonly (readonly [id: string, label: string, description: string])[];
  entryFilePath?: string;
}

const HTTP_LINE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+) (\d{3}) (\d+)ms$/;

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Payload Too Large",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const pad = (n: number) => String(n).padStart(2, "0");
export const logId = (n: number) => `log-${pad(n)}`;
export const requestId = (n: number) => `req-${pad(n)}`;
export const challengeId = (number: string) => `challenge-${number}`;

const byteLength = (text: string) => new TextEncoder().encode(text).length;
const headers = (record: Record<string, string>): HttpHeader[] =>
  Object.entries(record).map(([name, value]) => ({ name, value }));

/** Formats log lines the way the scenarios' loggers write them. */
export function formatLogFile(incidentDate: string, logs: readonly LogEntry[]): string {
  return logs
    .map((entry) => `${incidentDate}T${entry.timestamp}Z ${entry.level.padEnd(5)} [${entry.source}] ${entry.message}`)
    .join("\n")
    .concat("\n");
}

function contentTypeOf(body: string): string {
  const start = body.trimStart()[0];
  if (start === "{" || start === "[") return "application/json; charset=utf-8";
  if (start === "<") return "text/html; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function buildRequest(spec: RequestSpec, index: number, logs: readonly LogEntry[], challenge: ChallengeSpec): NetworkRequest {
  const id = requestId(index + 1);
  const line = spec.log === undefined ? undefined : logs[spec.log - 1];
  if (spec.log !== undefined && !line) throw new Error(`${challenge.number} ${id}: log ${spec.log} does not exist`);
  const http = line?.message.match(HTTP_LINE);

  const method = spec.method ?? (http?.[1] as "GET" | "POST" | undefined);
  const path = spec.path ?? http?.[2];
  const status = spec.status ?? (http ? Number(http[3]) : undefined);
  const timestamp = spec.at ?? line?.timestamp;
  if (!method || !path || status === undefined || !timestamp) {
    throw new Error(`${challenge.number} ${id}: method, path, status and time are required without an [http] log line`);
  }
  if (method !== "GET" && method !== "POST") throw new Error(`${challenge.number} ${id}: only GET and POST are captured`);
  const serverMs = http ? Number(http[4]) : 0;
  const durationMs = spec.ms ?? serverMs + 24;
  if (durationMs < serverMs) throw new Error(`${challenge.number} ${id}: browser time is shorter than the server's`);

  const type = spec.type ?? "fetch";
  const requestHeaders: Record<string, string> = {
    accept: type === "document" ? "text/html,application/xhtml+xml" : type === "script" ? "*/*" : "application/json",
    ...(spec.body !== undefined ? { "content-type": "application/json" } : {}),
    "user-agent": USER_AGENT,
    ...spec.requestHeaders,
  };
  const responseHeaders: Record<string, string> = {
    date: new Date(`${challenge.incidentDate}T${timestamp}Z`).toUTCString(),
    ...(spec.response !== undefined
      ? { "content-type": contentTypeOf(spec.response), "content-length": String(byteLength(spec.response)) }
      : {}),
    ...spec.responseHeaders,
  };

  return {
    id,
    timestamp,
    method,
    url: `${challenge.origin}${path}`,
    path,
    status,
    statusText: STATUS_TEXT[status] ?? "",
    type,
    durationMs,
    ...(spec.initiator !== undefined ? { initiator: spec.initiator } : {}),
    ...(line ? { serverLogId: line.id } : {}),
    requestHeaders: headers(requestHeaders),
    ...(spec.body !== undefined ? { requestBody: spec.body } : {}),
    responseHeaders: headers(responseHeaders),
    ...(spec.response !== undefined ? { responseBody: spec.response } : {}),
  };
}

/** Expands a spec into the scenario and listing the catalog registers. */
export function defineChallenge(spec: ChallengeSpec): CatalogEntry {
  const id = challengeId(spec.number);
  const logs: LogEntry[] = spec.logs.map(([timestamp, level, source, message], index) => ({
    id: logId(index + 1),
    timestamp,
    level,
    source,
    message,
  }));
  const logFile = spec.logFile === undefined ? "logs/app.log" : spec.logFile;
  const files: ScenarioFile[] = Object.entries(spec.files).map(([path, content]) => ({ path, content }));
  if (logFile) files.push({ path: logFile, content: formatLogFile(spec.incidentDate, logs) });
  const rootCauseOptions: RootCauseOption[] = spec.options.map(([optionId, label, description]) => ({
    id: optionId,
    label,
    description,
  }));

  const scenario: WorkspaceScenario = {
    contractVersion: 1,
    challenge: {
      id,
      number: spec.number,
      title: spec.title,
      incident: spec.incident,
      difficulty: spec.difficulty,
      completion: "diagnosis",
      tags: spec.tags,
      estimatedMinutes: spec.estimatedMinutes,
    },
    files,
    incidentDate: spec.incidentDate,
    logs,
    network: (spec.network ?? []).map((request, index) => buildRequest(request, index, logs, spec)),
    rootCauseOptions,
    entryFilePath: spec.entryFilePath ?? "INCIDENT.md",
  };

  return {
    scenario,
    listing: {
      slug: id,
      description: spec.description,
      category: spec.category,
      technologies: spec.technologies,
      status: spec.status ?? "published",
      ...(spec.featured ? { featured: true } : {}),
      ...(spec.publishedAt !== undefined ? { publishedAt: spec.publishedAt } : {}),
    },
  };
}
