/*
 * Field-level validation of a challenge definition. Server-only.
 *
 * structure.ts checks that the shapes the code dereferences are there. This module checks the
 * VALUES of fields that already have an established type and meaning in the existing contract
 * (WorkspaceScenario, ChallengeSummary, LogEntry, NetworkRequest, RootCauseOption): the right
 * primitive type, not blank, a member of the closed set the type names, in a numeric range the
 * type implies. The rules in THIS file restate the existing types, so they do not change the
 * public contract. The closed sets below are typed `Record<Union, true>`, so the compiler
 * fails if a union gains a member and this file is not updated with it.
 *
 * It runs on a SNAPSHOT (plain-data.ts), so every value it reads is plain data and was read
 * once. It is written defensively anyway: a field it cannot check because its parent is the
 * wrong shape is left to structure.ts to report, and it never throws.
 *
 * The rules Syeda agreed on top of the existing contract (strict paths, ISO 8601 UTC timestamps,
 * conservative limits) live in their own modules and are called from findFieldIssues() so that one
 * pass reports everything: paths.ts (the strict path policy and collisions), timestamps.ts (UTC time of
 * day) and limits.ts (size and count limits). A request's optional link to a log is validate.ts.
 *
 * Also decided by Syeda and enforced here: at least two root-cause options, option labels unique
 * after trimming and lower-casing, and tags unique ignoring case. (Zero key observations stay valid,
 * and challenge numbers are unique across the registry: that one is validate.ts.)
 *
 * DELIBERATELY NOT CHECKED, each by Syeda's decision (docs/architecture/learner-session-foundation.md,
 * section 8.7):
 *   - URL and path formats of a network request (they may be simulated debugging evidence);
 *   - unexpected properties: ignored, never published or graded (a stricter schema is for external
 *     definitions, later);
 *   - an extension allow-list or a per-file language (languages are not narrowed), and Windows
 *     reserved names, which are allowed for these virtual files;
 *   - that logs are in time order, and that a request's duration covers the duration in its log line.
 *
 * Messages carry paths and, for a closed set, the expected values. A value an author typed is
 * quoted through text.ts. They never carry answer text.
 */
import "server-only";
import type { NetworkRequest, NetworkRequestType } from "@/types/investigation";
import type { Difficulty, LogLevel } from "@/types/workspace";
import { findLimitIssues } from "./limits";
import { findPathCollisions, pathProblem } from "./paths";
import { entriesOf, isRecord } from "./structure";
import { timestampProblem } from "./timestamps";
import { shown } from "./text";

export { pathProblem };

type Issues = string[];
type Record_ = Record<string, unknown>;

const DIFFICULTIES: Record<Difficulty, true> = { beginner: true, intermediate: true, advanced: true };
const LOG_LEVELS: Record<LogLevel, true> = { DEBUG: true, INFO: true, WARN: true, ERROR: true };
const METHODS: Record<NetworkRequest["method"], true> = { GET: true, POST: true };
const REQUEST_TYPES: Record<NetworkRequestType, true> = { document: true, script: true, fetch: true, ping: true };

const MIN_STATUS = 100;
const MAX_STATUS = 599;
/** Approved: a diagnosis needs something to choose between. */
const MIN_ROOT_CAUSE_OPTIONS = 2;

/** Whitespace only, or nothing. */
const isBlank = (value: string) => value.trim().length === 0;

/** A required string that must also have visible content. For a field no other pass requires. */
function requireText(owner: Record_, key: string, at: string, issues: Issues): void {
  const value = owner[key];
  if (typeof value !== "string" || isBlank(value)) issues.push(`${at}.${key} must be a non-blank string`);
}

/** For a field structure.ts already requires to be a string: only the blank case is new here. */
function refuseBlank(owner: Record_, key: string, at: string, issues: Issues): void {
  const value = owner[key];
  if (typeof value === "string" && isBlank(value)) issues.push(`${at}.${key} must not be blank`);
}

/** A string that may be empty (a status text, a header value, a log message, a file's content). */
function requireString(owner: Record_, key: string, at: string, issues: Issues): void {
  if (typeof owner[key] !== "string") issues.push(`${at}.${key} must be a string`);
}

/** Absent is fine; present must be a string. */
function optionalString(owner: Record_, key: string, at: string, issues: Issues): void {
  if (owner[key] !== undefined && typeof owner[key] !== "string") issues.push(`${at}.${key} must be a string when present`);
}

function requireOneOf(owner: Record_, key: string, at: string, allowed: Record<string, true>, issues: Issues): void {
  const value = owner[key];
  if (typeof value === "string" && Object.hasOwn(allowed, value)) return;
  const expected = Object.keys(allowed).map((name) => shown(name)).join(", ");
  issues.push(`${at}.${key} must be one of ${expected}, not ${shown(value)}`);
}

function checkPath(owner: Record_, key: string, at: string, issues: Issues): void {
  const value = owner[key];
  if (typeof value !== "string") return; // structure.ts reports it
  const problem = pathProblem(value);
  if (problem) issues.push(`${at}.${key} ${shown(value)} ${problem}`);
}

/** A real calendar date written YYYY-MM-DD: month 1-12, a day the month has, leap years honoured. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function checkManifest(challenge: Record_, issues: Issues): void {
  const at = "scenario.challenge";
  refuseBlank(challenge, "id", at, issues);
  requireText(challenge, "number", at, issues);
  requireText(challenge, "title", at, issues);
  requireText(challenge, "incident", at, issues);
  requireOneOf(challenge, "difficulty", at, DIFFICULTIES, issues);

  const minutes = challenge.estimatedMinutes;
  if (typeof minutes !== "number" || !Number.isSafeInteger(minutes) || minutes < 1) {
    issues.push(`${at}.estimatedMinutes must be a positive whole number, not ${shown(minutes)}`);
  }

  if (Array.isArray(challenge.tags)) {
    // Unique ignoring case (approved): "Auth" and "auth" are one tag. Nothing else is normalised here.
    const seen = new Map<string, { index: number; tag: string }>();
    challenge.tags.forEach((tag: unknown, index: number) => {
      if (typeof tag !== "string" || isBlank(tag)) {
        issues.push(`${at}.tags[${index}] must be a non-blank string, not ${shown(tag)}`);
        return;
      }
      const first = seen.get(tag.toLowerCase());
      if (!first) {
        seen.set(tag.toLowerCase(), { index, tag });
      } else if (first.tag === tag) {
        issues.push(`${at}.tags[${index}] ${shown(tag)} is listed more than once`);
      } else {
        issues.push(`${at}.tags[${index}] ${shown(tag)} is the same tag as ${at}.tags[${first.index}] ${shown(first.tag)}, ignoring case`);
      }
    });
  }
}

function checkTimestamp(owner: Record_, at: string, issues: Issues): void {
  const problem = timestampProblem(owner, at);
  if (problem) issues.push(problem);
}

function checkNetworkRequest(request: Record_, at: string, issues: Issues): void {
  refuseBlank(request, "id", at, issues);
  checkTimestamp(request, at, issues);
  requireOneOf(request, "method", at, METHODS, issues);
  requireText(request, "url", at, issues);
  requireText(request, "path", at, issues);

  const status = request.status;
  if (typeof status !== "number" || !Number.isInteger(status) || status < MIN_STATUS || status > MAX_STATUS) {
    issues.push(`${at}.status must be an HTTP status code, a whole number from ${MIN_STATUS} to ${MAX_STATUS}, not ${shown(status)}`);
  }
  requireString(request, "statusText", at, issues);
  requireOneOf(request, "type", at, REQUEST_TYPES, issues);

  const duration = request.durationMs;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
    issues.push(`${at}.durationMs must be a finite number of milliseconds, 0 or more, not ${shown(duration)}`);
  }

  if (request.initiator !== undefined && (typeof request.initiator !== "string" || isBlank(request.initiator))) {
    issues.push(`${at}.initiator must be a non-blank string when present`);
  }
  refuseBlank(request, "serverLogId", at, issues);

  for (const key of ["requestHeaders", "responseHeaders"]) {
    entriesOf(request[key]).forEach(({ item, index }) => refuseBlank(item, "name", `${at}.${key}[${index}]`, issues));
  }
  optionalString(request, "requestBody", at, issues);
  optionalString(request, "responseBody", at, issues);
}

function checkScenario(scenario: Record_, issues: Issues): void {
  if (isRecord(scenario.challenge)) checkManifest(scenario.challenge, issues);

  if (!isCalendarDate(scenario.incidentDate)) {
    issues.push(
      `scenario.incidentDate must be a real calendar date written YYYY-MM-DD, not ${shown(scenario.incidentDate)}`,
    );
  }

  refuseBlank(scenario, "entryFilePath", "scenario", issues);
  checkPath(scenario, "entryFilePath", "scenario", issues);

  entriesOf(scenario.files).forEach(({ item: file, index }) => {
    const at = `scenario.files[${index}]`;
    checkPath(file, "path", at, issues);
    requireString(file, "content", at, issues);
  });
  issues.push(
    ...findPathCollisions(
      entriesOf(scenario.files).flatMap(({ item, index }) =>
        typeof item.path === "string" ? [{ path: item.path, at: `scenario.files[${index}]` }] : [],
      ),
    ),
  );

  entriesOf(scenario.logs).forEach(({ item: entry, index }) => {
    const at = `scenario.logs[${index}]`;
    refuseBlank(entry, "id", at, issues);
    checkTimestamp(entry, at, issues);
    requireOneOf(entry, "level", at, LOG_LEVELS, issues);
    requireText(entry, "source", at, issues);
    requireString(entry, "message", at, issues);
  });

  entriesOf(scenario.network).forEach(({ item, index }) => checkNetworkRequest(item, `scenario.network[${index}]`, issues));

  // A choice of one is no choice (approved: at least two). Zero key observations stay valid.
  if (Array.isArray(scenario.rootCauseOptions) && scenario.rootCauseOptions.length < MIN_ROOT_CAUSE_OPTIONS) {
    issues.push(`scenario.rootCauseOptions must have at least ${MIN_ROOT_CAUSE_OPTIONS} options, not ${scenario.rootCauseOptions.length}`);
  }
  // Labels are unique after trimming and lower-casing (approved), so two options cannot read the same to a learner.
  const labels = new Map<string, { index: number; label: string }>();
  entriesOf(scenario.rootCauseOptions).forEach(({ item: option, index }) => {
    const at = `scenario.rootCauseOptions[${index}]`;
    refuseBlank(option, "id", at, issues);
    requireText(option, "label", at, issues);
    requireText(option, "description", at, issues);
    if (typeof option.label === "string" && !isBlank(option.label)) {
      const key = option.label.trim().toLowerCase();
      const first = labels.get(key);
      if (first) {
        issues.push(`${at}.label ${shown(option.label)} is the same as scenario.rootCauseOptions[${first.index}].label ${shown(first.label)}, ignoring case and surrounding whitespace`);
      } else {
        labels.set(key, { index, label: option.label });
      }
    }
  });
}

function checkEvaluation(evaluation: Record_, issues: Issues): void {
  refuseBlank(evaluation, "correctRootCauseId", "evaluation", issues);
  refuseBlank(evaluation, "resolutionSummary", "evaluation", issues);

  entriesOf(evaluation.keyObservations).forEach(({ item: observation, index }) => {
    const at = `evaluation.keyObservations[${index}]`;
    refuseBlank(observation, "id", at, issues);
    entriesOf(observation.refs).forEach(({ item: ref, index: refIndex }) => {
      const refAt = `${at}.refs[${refIndex}]`;
      refuseBlank(ref, "logId", refAt, issues);
      refuseBlank(ref, "requestId", refAt, issues);
    });
  });
}

/** Problems with the values of a definition's fields. `definition` is a snapshot, but is not assumed well formed. */
export function findFieldIssues(definition: unknown): string[] {
  const issues: Issues = [];
  if (!isRecord(definition)) return issues;
  if (isRecord(definition.scenario)) checkScenario(definition.scenario, issues);
  if (isRecord(definition.evaluation)) checkEvaluation(definition.evaluation, issues);
  issues.push(...findLimitIssues(definition));
  return issues;
}
