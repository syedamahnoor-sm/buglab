/*
 * Size and count limits (limits.ts).
 *
 * Three kinds of proof:
 *   1. GROUNDING. Challenge 001 is re-measured here, independently of the rule, and must use at
 *      most half of every limit, so no limit is the thing that rejects real content. Every limit
 *      must have a measurement, so a new limit cannot be added without grounding it.
 *   2. BOUNDARIES. For each limit, a value exactly at it is accepted and one past it is refused,
 *      as exactly one issue at exactly one path, with the size in the message and never the content.
 *   3. NO NARROWING. Large files in several languages are accepted.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LIMITS } from "@/server/challenges/limits";
import { draftOf, type Draft } from "./helpers";
import { accepted, exactly, freeFile, freeLog, issuesFor, loose, wrongOption } from "./mutation-helpers";

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const max = (values: number[]) => (values.length ? Math.max(...values) : 0);
const x = (length: number) => "x".repeat(length);

/** What Challenge 001 actually uses, measured here from scratch. Keys match LIMITS. */
function measure(d: Draft): Record<keyof typeof LIMITS, number> {
  const s = d.scenario;
  const headers = s.network.flatMap((r) => [...r.requestHeaders, ...r.responseHeaders]);
  return {
    files: s.files.length,
    fileBytes: max(s.files.map((f) => bytes(f.content))),
    totalFileBytes: s.files.reduce((n, f) => n + bytes(f.content), 0),
    pathLength: max(s.files.map((f) => f.path.length)),
    pathSegmentLength: max(s.files.flatMap((f) => f.path.split("/").map((p) => p.length))),
    pathDepth: max(s.files.map((f) => f.path.split("/").length)),
    logs: s.logs.length,
    logMessageLength: max(s.logs.map((l) => l.message.length)),
    logSourceLength: max(s.logs.map((l) => l.source.length)),
    networkRequests: s.network.length,
    headersPerList: max(s.network.flatMap((r) => [r.requestHeaders.length, r.responseHeaders.length])),
    headerNameLength: max(headers.map((h) => h.name.length)),
    headerValueLength: max(headers.map((h) => h.value.length)),
    requestBodyBytes: max(s.network.map((r) => bytes(r.requestBody ?? ""))),
    responseBodyBytes: max(s.network.map((r) => bytes(r.responseBody ?? ""))),
    urlLength: max(s.network.map((r) => r.url.length)),
    requestPathLength: max(s.network.map((r) => r.path.length)),
    statusTextLength: max(s.network.map((r) => r.statusText.length)),
    idLength: max([
      ...s.logs.map((l) => l.id.length),
      ...s.network.flatMap((r) => [r.id.length, r.serverLogId.length]),
      ...s.rootCauseOptions.map((o) => o.id.length),
      d.evaluation.correctRootCauseId.length,
      ...d.evaluation.keyObservations.map((k) => k.id.length),
      ...d.evaluation.keyObservations.flatMap((k) => k.refs.map((ref) => (ref.kind === "log" ? ref.logId.length : ref.requestId.length))),
    ]),
    tags: s.challenge.tags.length,
    tagLength: max(s.challenge.tags.map((t) => t.length)),
    titleLength: s.challenge.title.length,
    incidentLength: s.challenge.incident.length,
    numberLength: s.challenge.number.length,
    rootCauseOptions: s.rootCauseOptions.length,
    optionLabelLength: max(s.rootCauseOptions.map((o) => o.label.length)),
    optionDescriptionLength: max(s.rootCauseOptions.map((o) => o.description.length)),
    keyObservations: d.evaluation.keyObservations.length,
    refsPerObservation: max(d.evaluation.keyObservations.map((k) => k.refs.length)),
    resolutionSummaryLength: d.evaluation.resolutionSummary.length,
    scenarioBytes: bytes(JSON.stringify(s)),
  };
}

describe("every limit is grounded in Challenge 001", () => {
  const used = measure(draftOf());

  test("every limit has a measurement, and every measurement a limit", () => {
    assert.deepEqual(Object.keys(used).sort(), Object.keys(LIMITS).sort());
  });

  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    test(`${key}: Challenge 001 uses ${used[key]} of ${LIMITS[key]}, at most half`, () => {
      assert.ok(used[key] > 0, "a limit that nothing measures is not grounded");
      assert.ok(used[key] * 2 <= LIMITS[key], `${key} would leave less than 2x headroom`);
    });
  }

  test("the limits are frozen numbers", () => {
    assert.ok(Object.isFrozen(LIMITS));
    for (const value of Object.values(LIMITS)) assert.ok(Number.isSafeInteger(value) && value > 0);
  });
});

describe("the limits are exactly the numbers that were agreed and documented", () => {
  // Written out in full on purpose. Changing a limit is a decision for Syeda, so it must also
  // change this test and the table in docs/architecture/learner-session-foundation.md (section 8.7).
  const AGREED = {
    files: 64,
    fileBytes: 32768,
    totalFileBytes: 262144,
    pathLength: 128,
    pathSegmentLength: 64,
    pathDepth: 8,
    logs: 500,
    logMessageLength: 1000,
    logSourceLength: 64,
    networkRequests: 200,
    headersPerList: 64,
    headerNameLength: 128,
    headerValueLength: 4096,
    requestBodyBytes: 32768,
    responseBodyBytes: 65536,
    urlLength: 2048,
    requestPathLength: 512,
    statusTextLength: 64,
    idLength: 64,
    tags: 16,
    tagLength: 32,
    titleLength: 100,
    incidentLength: 500,
    numberLength: 8,
    rootCauseOptions: 12,
    optionLabelLength: 200,
    optionDescriptionLength: 1000,
    keyObservations: 20,
    refsPerObservation: 20,
    resolutionSummaryLength: 4000,
    scenarioBytes: 1048576,
  };

  test("LIMITS holds exactly these values", () => {
    assert.deepEqual({ ...LIMITS }, AGREED);
  });

  // That the documentation states them is checked in limits-doc.test.ts, which travels with the documentation.
});

describe("counts", () => {
  /** Adds log lines and requests, each with its own log line, timestamp-equal, until there are `total` requests. */
  const withRequests = (total: number) => (d: Draft) => {
    for (let k = d.scenario.network.length; k < total; k += 1) {
      d.scenario.logs.push({ id: `log-gen-${k}`, timestamp: "10:00:00.000", level: "INFO", source: "gen", message: "m" });
      d.scenario.network.push({
        id: `req-gen-${k}`, timestamp: "10:00:00.000", method: "GET", url: "https://example.test/", path: "/", status: 200,
        statusText: "OK", type: "fetch", durationMs: 1, serverLogId: `log-gen-${k}`, requestHeaders: [], responseHeaders: [],
      });
    }
  };
  const withLogs = (total: number) => (d: Draft) => {
    for (let k = d.scenario.logs.length; k < total; k += 1) {
      d.scenario.logs.push({ id: `log-gen-${k}`, timestamp: "10:00:00.000", level: "INFO", source: "gen", message: "m" });
    }
  };
  const withFiles = (total: number) => (d: Draft) => {
    for (let k = d.scenario.files.length; k < total; k += 1) d.scenario.files.push({ path: `gen/file-${k}.md`, content: "" });
  };
  const withOptions = (total: number) => (d: Draft) => {
    for (let k = d.scenario.rootCauseOptions.length; k < total; k += 1) {
      d.scenario.rootCauseOptions.push({ id: `option-gen-${k}`, label: `Label ${k}`, description: "D" });
    }
  };
  /** Key observations, each with one new log line of its own as evidence. */
  const withObservations = (total: number) => (d: Draft) => {
    for (let k = d.evaluation.keyObservations.length; k < total; k += 1) {
      d.scenario.logs.push({ id: `log-obs-${k}`, timestamp: "10:00:00.000", level: "INFO", source: "gen", message: "m" });
      d.evaluation.keyObservations.push({ id: `obs-gen-${k}`, refs: [{ kind: "log", logId: `log-obs-${k}` }] });
    }
  };

  test(`files: ${LIMITS.files} accepted, one more refused`, () => {
    accepted(withFiles(LIMITS.files));
    exactly(withFiles(LIMITS.files + 1), `scenario.files has ${LIMITS.files + 1} files; at most ${LIMITS.files} are allowed`);
  });
  test(`log lines: ${LIMITS.logs} accepted, one more refused`, () => {
    accepted(withLogs(LIMITS.logs));
    exactly(withLogs(LIMITS.logs + 1), `scenario.logs has ${LIMITS.logs + 1} log lines; at most ${LIMITS.logs} are allowed`);
  });
  test(`network requests: ${LIMITS.networkRequests} accepted, one more refused`, () => {
    accepted(withRequests(LIMITS.networkRequests));
    exactly(
      withRequests(LIMITS.networkRequests + 1),
      `scenario.network has ${LIMITS.networkRequests + 1} requests; at most ${LIMITS.networkRequests} are allowed`,
    );
  });
  test(`root-cause options: ${LIMITS.rootCauseOptions} accepted, one more refused`, () => {
    accepted(withOptions(LIMITS.rootCauseOptions));
    exactly(
      withOptions(LIMITS.rootCauseOptions + 1),
      `scenario.rootCauseOptions has ${LIMITS.rootCauseOptions + 1} options; at most ${LIMITS.rootCauseOptions} are allowed`,
    );
  });
  test(`key observations: ${LIMITS.keyObservations} accepted, one more refused`, () => {
    accepted(withObservations(LIMITS.keyObservations));
    exactly(
      withObservations(LIMITS.keyObservations + 1),
      `evaluation.keyObservations has ${LIMITS.keyObservations + 1} key observations; at most ${LIMITS.keyObservations} are allowed`,
    );
  });
  test(`references in one observation: ${LIMITS.refsPerObservation} accepted, one more refused`, () => {
    const refs = (count: number) => (d: Draft) => {
      const group = { id: "obs-wide", refs: [] as Draft["evaluation"]["keyObservations"][number]["refs"] };
      for (let k = 0; k < count; k += 1) {
        d.scenario.logs.push({ id: `log-wide-${k}`, timestamp: "10:00:00.000", level: "INFO", source: "gen", message: "m" });
        group.refs.push({ kind: "log", logId: `log-wide-${k}` });
      }
      d.evaluation.keyObservations.push(group);
    };
    accepted(refs(LIMITS.refsPerObservation));
    const index = draftOf().evaluation.keyObservations.length; // the new group is added last
    exactly(refs(LIMITS.refsPerObservation + 1), `evaluation.keyObservations[${index}].refs has ${LIMITS.refsPerObservation + 1} references; at most ${LIMITS.refsPerObservation} are allowed`);
  });
  test(`tags: ${LIMITS.tags} accepted, one more refused`, () => {
    const tags = (count: number) => (d: Draft) => (d.scenario.challenge.tags = Array.from({ length: count }, (_, i) => `tag-${i}`));
    accepted(tags(LIMITS.tags));
    exactly(tags(LIMITS.tags + 1), `scenario.challenge.tags has ${LIMITS.tags + 1} tags; at most ${LIMITS.tags} are allowed`);
  });
  test(`headers in one list: ${LIMITS.headersPerList} accepted, one more refused, for request and response alike`, () => {
    for (const key of ["requestHeaders", "responseHeaders"] as const) {
      const headers = (count: number) => (d: Draft) =>
        (d.scenario.network[0][key] = Array.from({ length: count }, (_, i) => ({ name: `h-${i}`, value: "v" })));
      accepted(headers(LIMITS.headersPerList));
      exactly(headers(LIMITS.headersPerList + 1), `scenario.network[0].${key} has ${LIMITS.headersPerList + 1} headers; at most ${LIMITS.headersPerList} are allowed`);
    }
  });
});

describe("text lengths (characters)", () => {
  /** Each case: where the field is, how to set it, and its limit. The value is `x` repeated. */
  const cases: { label: string; limit: number; set: (d: Draft, value: string) => void; path: (d: Draft) => string }[] = [
    { label: "challenge number", limit: LIMITS.numberLength, set: (d, v) => (d.scenario.challenge.number = v), path: () => "scenario.challenge.number" },
    { label: "challenge title", limit: LIMITS.titleLength, set: (d, v) => (d.scenario.challenge.title = v), path: () => "scenario.challenge.title" },
    { label: "challenge incident", limit: LIMITS.incidentLength, set: (d, v) => (d.scenario.challenge.incident = v), path: () => "scenario.challenge.incident" },
    { label: "a tag", limit: LIMITS.tagLength, set: (d, v) => (d.scenario.challenge.tags[0] = v), path: () => "scenario.challenge.tags[0]" },
    { label: "a log message", limit: LIMITS.logMessageLength, set: (d, v) => (d.scenario.logs[freeLog(d)].message = v), path: (d) => `scenario.logs[${freeLog(d)}].message` },
    { label: "a log source", limit: LIMITS.logSourceLength, set: (d, v) => (d.scenario.logs[freeLog(d)].source = v), path: (d) => `scenario.logs[${freeLog(d)}].source` },
    { label: "a log id", limit: LIMITS.idLength, set: (d, v) => (d.scenario.logs[freeLog(d)].id = v), path: (d) => `scenario.logs[${freeLog(d)}].id` },
    { label: "a request url", limit: LIMITS.urlLength, set: (d, v) => (d.scenario.network[0].url = v), path: () => "scenario.network[0].url" },
    { label: "a request path", limit: LIMITS.requestPathLength, set: (d, v) => (d.scenario.network[0].path = v), path: () => "scenario.network[0].path" },
    { label: "a request status text", limit: LIMITS.statusTextLength, set: (d, v) => (d.scenario.network[0].statusText = v), path: () => "scenario.network[0].statusText" },
    { label: "a header name", limit: LIMITS.headerNameLength, set: (d, v) => (d.scenario.network[0].requestHeaders[0].name = v), path: () => "scenario.network[0].requestHeaders[0].name" },
    { label: "a header value", limit: LIMITS.headerValueLength, set: (d, v) => (d.scenario.network[0].requestHeaders[0].value = v), path: () => "scenario.network[0].requestHeaders[0].value" },
    { label: "an option label", limit: LIMITS.optionLabelLength, set: (d, v) => (d.scenario.rootCauseOptions[wrongOption(d)].label = v), path: (d) => `scenario.rootCauseOptions[${wrongOption(d)}].label` },
    { label: "an option description", limit: LIMITS.optionDescriptionLength, set: (d, v) => (d.scenario.rootCauseOptions[wrongOption(d)].description = v), path: (d) => `scenario.rootCauseOptions[${wrongOption(d)}].description` },
    { label: "an option id", limit: LIMITS.idLength, set: (d, v) => (d.scenario.rootCauseOptions[wrongOption(d)].id = v), path: (d) => `scenario.rootCauseOptions[${wrongOption(d)}].id` },
    { label: "the resolution summary", limit: LIMITS.resolutionSummaryLength, set: (d, v) => (d.evaluation.resolutionSummary = v), path: () => "evaluation.resolutionSummary" },
    { label: "a key observation id", limit: LIMITS.idLength, set: (d, v) => (d.evaluation.keyObservations[0].id = v), path: () => "evaluation.keyObservations[0].id" },
  ];

  for (const { label, limit, set, path } of cases) {
    test(`${label}: ${limit} characters accepted, ${limit + 1} refused`, () => {
      accepted((d) => set(d, x(limit)));
      exactly((d) => set(d, x(limit + 1)), `${path(draftOf())} is ${limit + 1} characters long; at most ${limit} are allowed`);
    });
  }
});

describe("ids that are referred to from elsewhere are limited where they are defined and where they are used", () => {
  test("a request id, its server log id, and a correct root-cause id over the limit are each reported at their own field", () => {
    const long = x(LIMITS.idLength + 1);
    const issues = issuesFor((d) => {
      const optionIndex = d.scenario.rootCauseOptions.findIndex((o) => o.id === d.evaluation.correctRootCauseId);
      d.scenario.rootCauseOptions[optionIndex].id = long;
      d.evaluation.correctRootCauseId = long;
    });
    assert.deepEqual(
      issues.sort(),
      [
        `challenge-001: evaluation.correctRootCauseId is ${long.length} characters long; at most ${LIMITS.idLength} are allowed`,
        `challenge-001: scenario.rootCauseOptions[${draftOf().scenario.rootCauseOptions.findIndex((o) => o.id === draftOf().evaluation.correctRootCauseId)}].id is ${long.length} characters long; at most ${LIMITS.idLength} are allowed`,
      ].sort(),
    );
  });
});

describe("sizes in UTF-8 bytes", () => {
  const withFreeFile = (set: (file: { path: string; content: string }, d: Draft) => void) => (d: Draft) => set(d.scenario.files[freeFile(d)], d);
  const fileAt = (d: Draft) => `scenario.files[${freeFile(d)}]`;

  test(`a file: ${LIMITS.fileBytes} bytes accepted, one more refused, and the size is in bytes not characters`, () => {
    accepted(withFreeFile((file) => (file.content = x(LIMITS.fileBytes))));
    exactly(withFreeFile((file) => (file.content = x(LIMITS.fileBytes + 1))), `${fileAt(draftOf())}.content is ${LIMITS.fileBytes + 1} bytes; at most ${LIMITS.fileBytes} are allowed`);

    // "é" is one character but two bytes, so half the characters already fill the limit.
    const e = String.fromCharCode(0xe9);
    accepted(withFreeFile((file) => (file.content = e.repeat(LIMITS.fileBytes / 2))));
    exactly(withFreeFile((file) => (file.content = e.repeat(LIMITS.fileBytes / 2 + 1))), `${fileAt(draftOf())}.content is ${LIMITS.fileBytes + 2} bytes; at most ${LIMITS.fileBytes} are allowed`);
  });

  test(`all files together: ${LIMITS.totalFileBytes} bytes accepted, one more refused`, () => {
    const total = (extra: number) => (d: Draft) => {
      d.scenario.files.forEach((file) => (file.content = ""));
      const full = LIMITS.totalFileBytes / LIMITS.fileBytes;
      for (let k = 0; k < full; k += 1) d.scenario.files.push({ path: `big/${k}.txt`, content: x(LIMITS.fileBytes) });
      if (extra > 0) d.scenario.files[0].content = x(extra);
    };
    accepted(total(0));
    exactly(total(1), `scenario.files hold ${LIMITS.totalFileBytes + 1} bytes in all; at most ${LIMITS.totalFileBytes} are allowed`);
  });

  for (const key of ["requestBody", "responseBody"] as const) {
    const limit = key === "requestBody" ? LIMITS.requestBodyBytes : LIMITS.responseBodyBytes;
    test(`${key}: ${limit} bytes accepted, one more refused`, () => {
      accepted((d) => (d.scenario.network[0][key] = x(limit)));
      exactly((d) => (d.scenario.network[0][key] = x(limit + 1)), `scenario.network[0].${key} is ${limit + 1} bytes; at most ${limit} are allowed`);
    });
  }
});

describe("the whole scenario", () => {
  const bodies = (count: number) => (d: Draft) => {
    for (let k = 0; k < count; k += 1) {
      d.scenario.logs.push({ id: `log-big-${k}`, timestamp: "10:00:00.000", level: "INFO", source: "gen", message: "m" });
      d.scenario.network.push({
        id: `req-big-${k}`, timestamp: "10:00:00.000", method: "GET", url: "https://example.test/", path: "/", status: 200,
        statusText: "OK", type: "fetch", durationMs: 1, serverLogId: `log-big-${k}`, requestHeaders: [], responseHeaders: [],
        responseBody: x(LIMITS.responseBodyBytes),
      });
    }
  };

  test("many bodies, each within its own limit, are accepted until the whole scenario is too large", () => {
    accepted(bodies(14));
    const issues = issuesFor(bodies(17));
    assert.equal(issues.length, 1, issues.join("\n"));
    assert.match(issues[0], new RegExp(`^challenge-001: scenario is \\d+ bytes when serialized; at most ${LIMITS.scenarioBytes} are allowed$`));
  });
});

describe("messages carry sizes, never content", () => {
  test("the text of an oversized file is not repeated in the message", () => {
    const marker = "SECRET-MARKER-DO-NOT-ECHO";
    const issues = issuesFor((d) => (d.scenario.files[freeFile(d)].content = marker + x(LIMITS.fileBytes)));
    assert.equal(issues.length, 1);
    assert.ok(!issues[0].includes(marker));
    assert.ok(issues[0].length < 200);
  });
  test("an oversized resolution summary is reported by size, and its text is not echoed", () => {
    const marker = "PRIVATE-RESOLUTION-TEXT";
    const issues = issuesFor((d) => (d.evaluation.resolutionSummary = marker + x(LIMITS.resolutionSummaryLength)));
    assert.equal(issues.length, 1);
    assert.ok(!issues[0].includes(marker));
  });
});

describe("limits are about size, not language", () => {
  test("large files in Java, SQL, Python and TypeScript (24 KiB each) are accepted", () => {
    const line = (language: string) => `// ${language} line of ordinary code with some length to it ....\n`;
    const body = (language: string) => line(language).repeat(Math.floor((24 * 1024) / line(language).length));
    accepted((d) => {
      const keep = d.scenario.files.filter((file) => file.path === d.scenario.entryFilePath || d.scenario.network.some((r) => r.initiator === file.path));
      d.scenario.files = [
        ...keep.map((file) => ({ ...file, content: "" })),
        { path: "src/Service.java", content: body("java") },
        { path: "db/queries.sql", content: body("sql") },
        { path: "app/handler.py", content: body("python") },
        { path: "src/handler.ts", content: body("typescript") },
      ];
    });
  });

  test("a body of 64 KiB of non-ASCII text is counted in bytes, so it fits only up to half as many characters", () => {
    const cjk = String.fromCharCode(0x6587); // three bytes in UTF-8
    accepted((d) => (d.scenario.network[0].responseBody = cjk.repeat(Math.floor(LIMITS.responseBodyBytes / 3))));
    exactly(
      (d) => (d.scenario.network[0].responseBody = cjk.repeat(Math.floor(LIMITS.responseBodyBytes / 3) + 1)),
      `scenario.network[0].responseBody is ${(Math.floor(LIMITS.responseBodyBytes / 3) + 1) * 3} bytes; at most ${LIMITS.responseBodyBytes} are allowed`,
    );
  });
});

describe("the limit pass is safe on malformed input", () => {
  test("it ignores fields that are not the type it measures: those are other rules' problems", () => {
    const issues = issuesFor((d) => {
      loose(d.scenario.files[freeFile(d)]).content = 5;
      loose(d.scenario.logs[freeLog(d)]).message = { not: "a string" };
      loose(d.scenario.network[0]).requestHeaders = "not a list";
    });
    assert.ok(issues.every((issue) => !/at most \d+ are allowed/.test(issue)), issues.join("\n"));
  });
});
