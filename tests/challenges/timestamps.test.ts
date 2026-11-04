/*
 * Timestamp rules (timestamps.ts): what a timestamp is. And, by decision, what it is NOT tied to: a request's
 * time and its link to a log line are independent of each other.
 *
 * The contract is a UTC date once on the scenario (`incidentDate`) and a UTC time of day on each
 * log line and request, so the ISO 8601 UTC instant is `${incidentDate}T${timestamp}Z`. These
 * tests prove that claim independently, with Date's own parser rather than the rule's regex, and
 * then prove each way a timestamp can be wrong, each as exactly one issue at exactly one path.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { isTimeOfDay } from "@/server/challenges/timestamps";
import { draftOf } from "./helpers";
import { MISSING, accepted, asShown, exactly, freeLog, issuesFor, loose, put } from "./mutation-helpers";

const FORMAT =
  "must be a UTC time of day written HH:mm:ss.SSS, such as 09:14:02.117 (with scenario.incidentDate it forms an ISO 8601 UTC instant)";

const wrongTypes: [string, unknown][] = [
  ["a number", 12345],
  ["null", null],
  ["a list", []],
  ["an object", {}],
  ["empty", ""],
  ["blank", "   "],
  ["missing", MISSING],
];

/** Text that looks like a time but is not the contract's form. Each is wrong in its own way. */
const malformed: [string, string][] = [
  ["plain text", "garbage"],
  ["a one-digit hour", "9:14:02.117"],
  ["no milliseconds", "09:14:02"],
  ["one fractional digit", "09:14:02.1"],
  ["four fractional digits", "09:14:02.1170"],
  ["a comma separator", "09:14:02,117"],
  ["a dot instead of colons", "09.14.02.117"],
  ["hour 24", "24:00:00.000"],
  ["minute 60", "23:60:00.000"],
  ["second 60 (a leap second)", "23:59:60.000"],
  ["hour 25", "25:99:99.999"],
  ["a time zone suffix", "09:14:02.117Z"],
  ["a full instant", "2026-10-30T09:14:02.117Z"],
  ["a date and time", "2026-10-30 09:14:02.117"],
  ["leading whitespace", " 09:14:02.117"],
  ["trailing whitespace", "09:14:02.117 "],
  ["a trailing newline", "09:14:02.117\n"],
  ["Arabic-Indic digits", String.fromCharCode(0x660, 0x669) + ":14:02.117"],
  ["a negative hour", "-9:14:02.117"],
];

const accepts = ["00:00:00.000", "23:59:59.999", "09:14:02.117", "12:00:00.000", "01:02:03.004"];

describe("the ISO 8601 UTC claim, proven independently of the rule", () => {
  test("every log line and request of Challenge 001 makes a valid ISO 8601 UTC instant with the incident date", () => {
    const { scenario } = draftOf();
    const timestamps = [...scenario.logs.map((entry) => entry.timestamp), ...scenario.network.map((request) => request.timestamp)];
    assert.ok(timestamps.length > 30);
    for (const timestamp of timestamps) {
      const text = `${scenario.incidentDate}T${timestamp}Z`;
      const parsed = new Date(text);
      assert.ok(!Number.isNaN(parsed.getTime()), `${text} parses`);
      assert.equal(parsed.toISOString(), text, `${text} is exactly the canonical ISO 8601 UTC form`);
    }
  });

  test("the rule accepts exactly the values that make a canonical instant, and refuses the rest", () => {
    // For every minute-boundary and a spread of other values, the rule and Date agree.
    const samples = [...accepts, ...malformed.map(([, value]) => value), "10:20:30.999", "23:59:59.000", "00:00:60.000", "00:60:00.000"];
    for (const sample of samples) {
      const canonical = (() => {
        const parsed = new Date(`2026-10-30T${sample}Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === `2026-10-30T${sample}Z`;
      })();
      assert.equal(isTimeOfDay(sample), canonical, JSON.stringify(sample));
    }
  });

  test("isTimeOfDay is false for every value that is not a string", () => {
    for (const value of [undefined, null, 0, 1, {}, [], true, Symbol("x")]) assert.equal(isTimeOfDay(value), false);
  });
});

describe("a log line timestamp", () => {
  const log = (change: (entry: Record<string, unknown>) => void, expected: (index: number) => string) => {
    const index = freeLog(draftOf());
    exactly((d) => change(loose(d.scenario.logs[index])), expected(index));
  };

  for (const [label, value] of wrongTypes) {
    test(`that is ${label} is refused`, () => {
      log((entry) => put(entry, "timestamp", value), (i) => `scenario.logs[${i}].timestamp ${FORMAT}, not ${asShown(value)}`);
    });
  }
  for (const [label, value] of malformed) {
    test(`that is ${label} (${JSON.stringify(value)}) is refused`, () => {
      log((entry) => put(entry, "timestamp", value), (i) => `scenario.logs[${i}].timestamp ${FORMAT}, not ${asShown(value)}`);
    });
  }
  for (const value of accepts) {
    test(`${value} is accepted`, () => {
      accepted((d) => put(d.scenario.logs[freeLog(d)], "timestamp", value));
    });
  }
});

describe("a network request timestamp", () => {
  const request = (change: (r: Record<string, unknown>) => void, expected: string) =>
    exactly((d) => change(loose(d.scenario.network[0])), `scenario.network[0].${expected}`);

  for (const [label, value] of wrongTypes) {
    test(`that is ${label} is refused, once: the relationship to its log line is not also reported`, () => {
      request((r) => put(r, "timestamp", value), `timestamp ${FORMAT}, not ${asShown(value)}`);
    });
  }
  for (const [label, value] of malformed) {
    test(`that is ${label} (${JSON.stringify(value)}) is refused, once`, () => {
      request((r) => put(r, "timestamp", value), `timestamp ${FORMAT}, not ${asShown(value)}`);
    });
  }
});

describe("a request's link to a log line, and its time, are independent (approved)", () => {
  // These tests replace ones that pinned the opposite: a request's timestamp had to equal its log line's,
  // and two requests could not share one log line.
  const logOf = (d: ReturnType<typeof draftOf>, requestIndex: number) =>
    d.scenario.logs.find((entry) => entry.id === d.scenario.network[requestIndex].serverLogId)!;

  test("a request whose timestamp differs from its log line's is accepted, by any amount", () => {
    accepted((d) => (d.scenario.network[0].timestamp = "23:00:00.000"));
    const original = draftOf().scenario.network[0].timestamp;
    const bumped = `${original.slice(0, -3)}${String((Number(original.slice(-3)) + 1) % 1000).padStart(3, "0")}`;
    assert.notEqual(bumped, original);
    accepted((d) => (d.scenario.network[0].timestamp = bumped));
  });

  test("so is a log line whose timestamp differs from its request's", () => {
    accepted((d) => (logOf(d, 0).timestamp = "23:00:00.000"));
  });

  test("a request that is out of step with its log line is published as written", () => {
    const registry = createChallengeRegistry([draftOf((d) => (d.scenario.network[0].timestamp = "23:00:00.000"))]);

    assert.equal(registry.getPublic("challenge-001")!.network[0].timestamp, "23:00:00.000");
  });

  test("several requests may share one log line", () => {
    const shared = draftOf().scenario.network[0].serverLogId;
    const mutate = (d: ReturnType<typeof draftOf>) => {
      d.scenario.network[1].serverLogId = shared;
      d.scenario.network[2].serverLogId = shared;
    };
    accepted(mutate);

    const published = createChallengeRegistry([draftOf(mutate)]).getPublic("challenge-001")!.network;
    assert.deepEqual([published[0].serverLogId, published[1].serverLogId, published[2].serverLogId], [shared, shared, shared]);
  });

  test("every request may point at the same single log line", () => {
    accepted((d) => d.scenario.network.forEach((request) => (request.serverLogId = d.scenario.logs[0].id)));
  });

  test("a request may have no linked log: the field may be absent, or undefined", () => {
    accepted((d) => delete loose(d.scenario.network[0]).serverLogId);
    accepted((d) => put(d.scenario.network[0], "serverLogId", undefined));
    accepted((d) => d.scenario.network.forEach((request) => delete loose(request).serverLogId));
  });

  test("a request with no linked log is published without the field, and the others keep theirs", () => {
    const base = draftOf();
    const registry = createChallengeRegistry([draftOf((d) => delete loose(d.scenario.network[0]).serverLogId)]);
    const published = registry.getPublic("challenge-001")!.network;

    assert.ok(!("serverLogId" in published[0]), "the key is absent, not undefined");
    assert.equal(published[1].serverLogId, base.scenario.network[1].serverLogId);
    assert.equal(published.length, base.scenario.network.length);
  });

  test("dropping a link changes the public content, so it changes the content version", () => {
    const before = createChallengeRegistry([draftOf()]).contentVersion("challenge-001");
    const after = createChallengeRegistry([draftOf((d) => delete loose(d.scenario.network[0]).serverLogId)]).contentVersion("challenge-001");

    assert.notEqual(before, after);
  });

  test("a request with no log can still be evidence: its references resolve", () => {
    const d0 = draftOf();
    const referenced = d0.evaluation.keyObservations.flatMap((group) => group.refs).find((ref) => ref.kind === "network");
    assert.ok(referenced && referenced.kind === "network");
    const index = d0.scenario.network.findIndex((request) => request.id === (referenced as { requestId: string }).requestId);

    accepted((d) => delete loose(d.scenario.network[index]).serverLogId);
  });

  test("but a SUPPLIED link must point at a log line: an unknown id is refused, once", () => {
    const issues = issuesFor((d) => (d.scenario.network[0].serverLogId = "log-does-not-exist"));

    assert.deepEqual(issues, [`challenge-001: network request "${draftOf().scenario.network[0].id}": serverLogId "log-does-not-exist" is not a log entry`]);
  });

  test("a link is matched exactly: the right id in the wrong case is not a log line", () => {
    const real = draftOf().scenario.network[0].serverLogId;
    const issues = issuesFor((d) => (d.scenario.network[0].serverLogId = real.toUpperCase()));

    assert.deepEqual(issues, [`challenge-001: network request "${draftOf().scenario.network[0].id}": serverLogId "${real.toUpperCase()}" is not a log entry`]);
  });

  test("a blank link is refused as blank, and as not a log line", () => {
    for (const blank of ["", "   "]) {
      const issues = issuesFor((d) => (d.scenario.network[0].serverLogId = blank));
      assert.ok(issues.includes("challenge-001: scenario.network[0].serverLogId must not be blank"), issues.join("\n"));
      assert.ok(issues.some((issue) => issue.includes("is not a log entry")), issues.join("\n"));
    }
  });

  test("a link of the wrong type is refused as a shape problem, once", () => {
    for (const value of [null, 5, true, [], {}]) {
      exactly((d) => put(d.scenario.network[0], "serverLogId", value), "scenario.network[0].serverLogId must be a string when present");
    }
  });

  test("when the log line's own timestamp is malformed, only that is reported", () => {
    const d0 = draftOf();
    const referenced = d0.scenario.logs.findIndex((entry) => entry.id === d0.scenario.network[0].serverLogId);
    exactly((d) => (d.scenario.logs[referenced].timestamp = "garbage"), `scenario.logs[${referenced}].timestamp ${FORMAT}, not "garbage"`);
  });

  test("a request's own malformed timestamp is reported once, and not also as out of step", () => {
    exactly((d) => (d.scenario.network[0].timestamp = "garbage"), `scenario.network[0].timestamp ${FORMAT}, not "garbage"`);
  });
});

describe("what is deliberately not enforced, pinned so the documentation stays true", () => {
  test("log lines need not be in time order", () => {
    accepted((d) => {
      d.scenario.logs[freeLog(d)].timestamp = "00:00:00.000";
    });
  });

  test("a request's duration is not compared with the duration written in its log line's message", () => {
    accepted((d) => {
      d.scenario.network[0].durationMs = 0;
    });
  });

  test("the incident date may be any real date, such as a leap day, and is not compared with anything else", () => {
    accepted((d) => {
      d.scenario.incidentDate = "2024-02-29";
    });
  });
});
