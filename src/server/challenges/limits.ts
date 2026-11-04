/*
 * Size and count limits for a challenge definition. Server-only.
 *
 * Every number below is grounded in Challenge 001, the one challenge that exists, with generous
 * headroom, so a real challenge of the same kind fits easily and a runaway or malformed one does
 * not. The measured value and the headroom are in docs/architecture/learner-session-foundation.md
 * (section 8.7), and tests/challenges/limits.test.ts fails if Challenge 001 ever uses more than
 * half of any limit, so a limit cannot drift into being the thing that rejects real content.
 *
 * The limits are deliberately about SIZE, never about KIND. There is no file-type, extension or
 * language limit anywhere: a challenge may be JavaScript, TypeScript, Python, SQL, Java or anything
 * else, because a language is chosen by a file's name and nothing here looks at a name's ending.
 * A byte limit does apply to code, but at 32 KiB per file (about 800 lines) it is far above the
 * 1.5 KiB the largest Challenge 001 file needs.
 *
 * Text lengths count UTF-16 code units (`string.length`); file and body limits count UTF-8 bytes,
 * which is what is stored and sent. A limit is checked on a snapshot, so a value is measured
 * exactly once, and a message names the field and the size, never the content.
 */
import "server-only";
import { entriesOf, isRecord } from "./structure";

const KIB = 1024;

export const LIMITS = Object.freeze({
  /** Scenario files. */
  files: 64,
  fileBytes: 32 * KIB,
  totalFileBytes: 256 * KIB,
  pathLength: 128,
  pathSegmentLength: 64,
  pathDepth: 8,

  /** Server log lines. */
  logs: 500,
  logMessageLength: 1000,
  logSourceLength: 64,

  /** Browser network requests. */
  networkRequests: 200,
  headersPerList: 64,
  headerNameLength: 128,
  headerValueLength: 4 * KIB,
  requestBodyBytes: 32 * KIB,
  responseBodyBytes: 64 * KIB,
  urlLength: 2 * KIB,
  requestPathLength: 512,
  statusTextLength: 64,

  /** Any id that appears in an evidence reference or a root-cause choice. */
  idLength: 64,

  /** The challenge manifest. */
  tags: 16,
  tagLength: 32,
  titleLength: 100,
  incidentLength: 500,
  numberLength: 8,

  /** The diagnosis choices and the private evaluation. */
  rootCauseOptions: 12,
  optionLabelLength: 200,
  optionDescriptionLength: 1000,
  keyObservations: 20,
  refsPerObservation: 20,
  resolutionSummaryLength: 4000,

  /** The whole public scenario, serialized: what one API response could carry. */
  scenarioBytes: 1024 * KIB,
});

type Issues = string[];
type Record_ = Record<string, unknown>;

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

/** A string field over its limit, in characters. Absent or non-string fields are another pass's problem. */
function textLength(owner: Record_, key: string, at: string, max: number, issues: Issues): void {
  const value = owner[key];
  if (typeof value === "string" && value.length > max) {
    issues.push(`${at}.${key} is ${value.length} characters long; at most ${max} are allowed`);
  }
}

/** A string field over its limit, in UTF-8 bytes. */
function textBytes(owner: Record_, key: string, at: string, max: number, issues: Issues): number {
  const value = owner[key];
  if (typeof value !== "string") return 0;
  const size = byteLength(value);
  if (size > max) issues.push(`${at}.${key} is ${size} bytes; at most ${max} are allowed`);
  return size;
}

/** A list over its length limit. */
function listLength(owner: Record_, key: string, at: string, max: number, noun: string, issues: Issues): void {
  const value = owner[key];
  if (Array.isArray(value) && value.length > max) {
    issues.push(`${at}.${key} has ${value.length} ${noun}; at most ${max} are allowed`);
  }
}

function checkHeaders(request: Record_, key: string, at: string, issues: Issues): void {
  listLength(request, key, at, LIMITS.headersPerList, "headers", issues);
  entriesOf(request[key]).forEach(({ item, index }) => {
    const headerAt = `${at}.${key}[${index}]`;
    textLength(item, "name", headerAt, LIMITS.headerNameLength, issues);
    textLength(item, "value", headerAt, LIMITS.headerValueLength, issues);
  });
}

function checkNetworkRequest(request: Record_, at: string, issues: Issues): void {
  textLength(request, "id", at, LIMITS.idLength, issues);
  textLength(request, "serverLogId", at, LIMITS.idLength, issues);
  textLength(request, "url", at, LIMITS.urlLength, issues);
  textLength(request, "path", at, LIMITS.requestPathLength, issues);
  textLength(request, "statusText", at, LIMITS.statusTextLength, issues);
  textBytes(request, "requestBody", at, LIMITS.requestBodyBytes, issues);
  textBytes(request, "responseBody", at, LIMITS.responseBodyBytes, issues);
  checkHeaders(request, "requestHeaders", at, issues);
  checkHeaders(request, "responseHeaders", at, issues);
}

function checkScenario(scenario: Record_, issues: Issues): void {
  if (isRecord(scenario.challenge)) {
    const at = "scenario.challenge";
    const challenge = scenario.challenge;
    textLength(challenge, "number", at, LIMITS.numberLength, issues);
    textLength(challenge, "title", at, LIMITS.titleLength, issues);
    textLength(challenge, "incident", at, LIMITS.incidentLength, issues);
    listLength(challenge, "tags", at, LIMITS.tags, "tags", issues);
    if (Array.isArray(challenge.tags)) {
      challenge.tags.forEach((tag: unknown, index: number) => {
        if (typeof tag === "string" && tag.length > LIMITS.tagLength) {
          issues.push(`${at}.tags[${index}] is ${tag.length} characters long; at most ${LIMITS.tagLength} are allowed`);
        }
      });
    }
  }

  listLength(scenario, "files", "scenario", LIMITS.files, "files", issues);
  let total = 0;
  entriesOf(scenario.files).forEach(({ item, index }) => {
    total += textBytes(item, "content", `scenario.files[${index}]`, LIMITS.fileBytes, issues);
  });
  if (total > LIMITS.totalFileBytes) {
    issues.push(`scenario.files hold ${total} bytes in all; at most ${LIMITS.totalFileBytes} are allowed`);
  }

  listLength(scenario, "logs", "scenario", LIMITS.logs, "log lines", issues);
  entriesOf(scenario.logs).forEach(({ item, index }) => {
    const at = `scenario.logs[${index}]`;
    textLength(item, "id", at, LIMITS.idLength, issues);
    textLength(item, "source", at, LIMITS.logSourceLength, issues);
    textLength(item, "message", at, LIMITS.logMessageLength, issues);
  });

  listLength(scenario, "network", "scenario", LIMITS.networkRequests, "requests", issues);
  entriesOf(scenario.network).forEach(({ item, index }) => checkNetworkRequest(item, `scenario.network[${index}]`, issues));

  listLength(scenario, "rootCauseOptions", "scenario", LIMITS.rootCauseOptions, "options", issues);
  entriesOf(scenario.rootCauseOptions).forEach(({ item, index }) => {
    const at = `scenario.rootCauseOptions[${index}]`;
    textLength(item, "id", at, LIMITS.idLength, issues);
    textLength(item, "label", at, LIMITS.optionLabelLength, issues);
    textLength(item, "description", at, LIMITS.optionDescriptionLength, issues);
  });

  // The whole public scenario, as one response would carry it. A snapshot is plain data, so this cannot throw.
  const size = byteLength(JSON.stringify(scenario));
  if (size > LIMITS.scenarioBytes) {
    issues.push(`scenario is ${size} bytes when serialized; at most ${LIMITS.scenarioBytes} are allowed`);
  }
}

function checkEvaluation(evaluation: Record_, issues: Issues): void {
  textLength(evaluation, "correctRootCauseId", "evaluation", LIMITS.idLength, issues);
  textLength(evaluation, "resolutionSummary", "evaluation", LIMITS.resolutionSummaryLength, issues);

  listLength(evaluation, "keyObservations", "evaluation", LIMITS.keyObservations, "key observations", issues);
  entriesOf(evaluation.keyObservations).forEach(({ item: observation, index }) => {
    const at = `evaluation.keyObservations[${index}]`;
    textLength(observation, "id", at, LIMITS.idLength, issues);
    listLength(observation, "refs", at, LIMITS.refsPerObservation, "references", issues);
    entriesOf(observation.refs).forEach(({ item: ref, index: refIndex }) => {
      const refAt = `${at}.refs[${refIndex}]`;
      textLength(ref, "logId", refAt, LIMITS.idLength, issues);
      textLength(ref, "requestId", refAt, LIMITS.idLength, issues);
    });
  });
}

/** Everything over a limit. `definition` is a snapshot but is not assumed well formed. Never throws. */
export function findLimitIssues(definition: unknown): string[] {
  const issues: Issues = [];
  if (!isRecord(definition)) return issues;
  if (isRecord(definition.scenario)) checkScenario(definition.scenario, issues);
  if (isRecord(definition.evaluation)) checkEvaluation(definition.evaluation, issues);
  return issues;
}
