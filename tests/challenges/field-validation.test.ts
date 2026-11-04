/*
 * Field-level validation and the definition snapshot.
 *
 * Every test here proves a SPECIFIC message at a SPECIFIC path, not merely that something failed:
 * a mutation of one field is expected to produce exactly one issue, naming that field. Each rule
 * also has its boundary: the values just inside it are accepted. The rules are fields.ts's; what
 * it deliberately does not judge (the deferred decisions) is pinned here too, so the documentation
 * for Syeda stays true.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ChallengeDefinitionError } from "@/server/challenges/definition";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { isCalendarDate, pathProblem } from "@/server/challenges/fields";
import { toPublicChallenge } from "@/server/challenges/public-view";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { shown } from "@/server/challenges/text";
import { contentVersionOf } from "@/server/challenges/version";
import { findDefinitionIssues } from "@/server/challenges/validate";
import { draftOf, type Draft } from "./helpers";
import { MISSING, PREFIX, accepted, asShown, exactly, freeFile, freeLog, issuesFor, loose, put, wrongOption } from "./mutation-helpers";

describe("the fixture has what these tests assume", () => {
  test("Challenge 001 has an unreferenced file, log and option, and passes every field rule", () => {
    const d = draftOf();
    assert.ok(freeFile(d) >= 0 && freeLog(d) >= 0 && wrongOption(d) >= 0);
    assert.deepEqual(findDefinitionIssues([d]), []);
  });
});

describe("manifest fields", () => {
  const wrongText: [string, unknown][] = [
    ["missing", MISSING], ["null", null], ["a number", 5], ["a list", []], ["an object", {}], ["empty", ""], ["whitespace only", "  \t "],
  ];
  for (const key of ["number", "title", "incident"]) {
    for (const [label, value] of wrongText) {
      test(`${key} that is ${label} is refused`, () => {
        exactly((d) => put(d.scenario.challenge, key, value), `scenario.challenge.${key} must be a non-blank string`);
      });
    }
    test(`${key} with visible content is accepted, whatever its format`, () => {
      accepted((d) => put(d.scenario.challenge, key, "7"));
    });
  }

  const wrongDifficulty: [string, unknown][] = [
    ["an unknown name", "legendary"], ["the wrong case", "Beginner"], ["a number", 3], ["null", null], ["a list", ["beginner"]], ["missing", MISSING],
  ];
  for (const [label, value] of wrongDifficulty) {
    test(`difficulty that is ${label} is refused, and the message lists the allowed values`, () => {
      exactly(
        (d) => put(d.scenario.challenge, "difficulty", value),
        `scenario.challenge.difficulty must be one of "beginner", "intermediate", "advanced", not ${asShown(value)}`,
      );
    });
  }
  test("every difficulty the type names is accepted", () => {
    for (const difficulty of ["beginner", "intermediate", "advanced"]) accepted((d) => put(d.scenario.challenge, "difficulty", difficulty));
  });

  const wrongMinutes: [string, unknown][] = [
    ["zero", 0], ["negative", -5], ["fractional", 1.5], ["a numeric string", "30"], ["null", null], ["a list", []], ["an object", {}],
    ["missing", MISSING], ["beyond the safe integers", 2 ** 53],
  ];
  for (const [label, value] of wrongMinutes) {
    test(`estimatedMinutes that is ${label} is refused`, () => {
      exactly(
        (d) => put(d.scenario.challenge, "estimatedMinutes", value),
        `scenario.challenge.estimatedMinutes must be a positive whole number, not ${asShown(value)}`,
      );
    });
  }
  test("estimatedMinutes of 1, and a large whole number, are accepted: no upper limit is invented", () => {
    accepted((d) => put(d.scenario.challenge, "estimatedMinutes", 1));
    accepted((d) => put(d.scenario.challenge, "estimatedMinutes", 100000));
  });
  for (const [label, value] of [["NaN", Number.NaN], ["Infinity", Infinity], ["-Infinity", -Infinity]] as const) {
    test(`estimatedMinutes that is ${label} is refused as not a finite number`, () => {
      exactly((d) => put(d.scenario.challenge, "estimatedMinutes", value), "definition.scenario.challenge.estimatedMinutes must be a finite number");
    });
  }

  const wrongTags: [string, unknown, string][] = [
    ["a number", 1, `not ${shown(1)}`],
    ["null", null, `not ${shown(null)}`],
    ["empty", "", `not ${shown("")}`],
    ["whitespace only", "   ", `not ${shown("   ")}`],
    ["an object", {}, `not ${shown({})}`],
    ["a list", [], `not ${shown([])}`],
  ];
  for (const [label, value, tail] of wrongTags) {
    test(`a tag that is ${label} is refused at its index`, () => {
      exactly((d) => put(d.scenario.challenge.tags, "1", value), `scenario.challenge.tags[1] must be a non-blank string, ${tail}`);
    });
  }
  test("an exactly repeated tag is refused at the second occurrence, and an empty list is accepted", () => {
    exactly((d) => (d.scenario.challenge.tags = ["Auth", "HTTP", "Auth"]), 'scenario.challenge.tags[2] "Auth" is listed more than once');
    accepted((d) => (d.scenario.challenge.tags = []));
  });

  // Approved: tags are unique ignoring case. (This test replaces one that pinned the opposite, "Auth" and "auth" accepted.)
  describe("tags are unique ignoring case", () => {
    const sameTag = (index: number, tag: string, firstIndex: number, first: string) =>
      `scenario.challenge.tags[${index}] "${tag}" is the same tag as scenario.challenge.tags[${firstIndex}] "${first}", ignoring case`;

    test("a tag that differs only in case is refused at the later one, naming the first", () => {
      exactly((d) => (d.scenario.challenge.tags = ["Auth", "auth"]), sameTag(1, "auth", 0, "Auth"));
      exactly((d) => (d.scenario.challenge.tags = ["auth", "HTTP", "AUTH"]), sameTag(2, "AUTH", 0, "auth"));
      exactly((d) => (d.scenario.challenge.tags = ["Backend", "HTTP", "BACKEND"]), sameTag(2, "BACKEND", 0, "Backend"));
    });

    test("it works beyond ASCII", () => {
      const upper = String.fromCharCode(0xc4); // A with diaeresis
      const lower = String.fromCharCode(0xe4);
      exactly((d) => (d.scenario.challenge.tags = [upper, lower]), sameTag(1, lower, 0, upper));
    });

    test("every repeat is reported against the first occurrence, an exact repeat in its own words", () => {
      const issues = issuesFor((d) => (d.scenario.challenge.tags = ["a", "A", "a", "b"]));
      assert.deepEqual(issues, [
        `${PREFIX}${sameTag(1, "A", 0, "a")}`,
        `${PREFIX}scenario.challenge.tags[2] "a" is listed more than once`,
      ]);
    });

    test("distinct tags are accepted, and nothing but case is normalised: surrounding whitespace makes a tag different", () => {
      accepted((d) => (d.scenario.challenge.tags = ["Auth", "Authz", "HTTP"]));
      accepted((d) => (d.scenario.challenge.tags = ["Auth", " auth"]));
    });

    test("a blank tag is still reported as blank, and does not take part in the comparison", () => {
      exactly((d) => (d.scenario.challenge.tags = ["Auth", " ", "auth2"]), 'scenario.challenge.tags[1] must be a non-blank string, not " "');
    });
  });

  test("a missing or blank challenge id is still an id error, not a field error", () => {
    const issues = issuesFor((d) => put(d.scenario.challenge, "id", "  "));
    assert.ok(issues.some((issue) => issue.includes("challenge id") && issue.includes("is not valid")), issues.join("\n"));
  });
});

describe("incidentDate", () => {
  const bad = ["not-a-date", "2026-13-45", "2026-00-10", "2026-02-30", "2025-02-29", "1900-02-29", "2026-1-5", "2026-01-05T00:00:00Z", "", " 2026-01-05", "2026-01-05 "];
  for (const value of [...bad, 5, null, [], {}, MISSING]) {
    test(`${value === MISSING ? "a missing date" : JSON.stringify(value) ?? String(value)} is refused`, () => {
      exactly(
        (d) => put(d.scenario, "incidentDate", value),
        `scenario.incidentDate must be a real calendar date written YYYY-MM-DD, not ${asShown(value)}`,
      );
    });
  }
  test("real calendar dates are accepted, leap days included", () => {
    for (const value of ["2026-10-30", "2024-02-29", "2000-02-29", "2026-12-31", "2026-01-01"]) {
      assert.equal(isCalendarDate(value), true, value);
      accepted((d) => put(d.scenario, "incidentDate", value));
    }
  });
  test("isCalendarDate takes only a string", () => {
    for (const value of [20260101, null, undefined, new Date(0)]) assert.equal(isCalendarDate(value), false);
  });
});

describe("files", () => {
  for (const [label, value] of [["a number", 5], ["null", null], ["an object", {}], ["a list", []], ["missing", MISSING]] as [string, unknown][]) {
    test(`file content that is ${label} is refused`, () => {
      const at = (d: Draft) => freeFile(d);
      const d0 = draftOf();
      exactly((d) => put(d.scenario.files[at(d)], "content", value), `scenario.files[${at(d0)}].content must be a string`);
    });
  }
  test("empty file content is accepted: an empty file is a file", () => {
    accepted((d) => put(d.scenario.files[freeFile(d)], "content", ""));
  });

  const path = (change: (file: Record<string, unknown>) => void, expectFor: (index: number) => string) => {
    const index = freeFile(draftOf());
    exactly((d) => change(loose(d.scenario.files[index])), expectFor(index));
  };

  for (const blank of ["", " ", "\t"]) {
    test(`a path that is ${JSON.stringify(blank)} is refused as blank`, () => {
      path((file) => (file.path = blank), (i) => `scenario.files[${i}].path ${shown(blank)} must not be blank`);
    });
  }
  for (const value of ["../x", "a/../b", "./a", "a/./b", "a/..", ".", ".."]) {
    test(`a path with a dot segment (${value}) is refused`, () => {
      path((file) => (file.path = value), (i) => `scenario.files[${i}].path ${shown(value)} must not contain a "." or ".." segment`);
    });
  }
  for (const value of ["/abs/path.md", "a//b.md", "dir/", "/"]) {
    test(`a path with an empty segment (${value}), so absolute or doubled, is refused`, () => {
      path(
        (file) => (file.path = value),
        (i) => `scenario.files[${i}].path ${shown(value)} must not have an empty segment (no leading, trailing or doubled "/", so it is relative)`,
      );
    });
  }
  for (const value of ["a\u0000b.md", "a\nb.md", "a\u007fb.md", "tab\there.md"]) {
    test(`a path with a control character (${JSON.stringify(value)}) is refused`, () => {
      path((file) => (file.path = value), (i) => `scenario.files[${i}].path ${shown(value)} must not contain control, invisible or direction-changing characters`);
    });
  }
  for (const [label, value] of [["a number", 5], ["null", null], ["missing", MISSING]] as [string, unknown][]) {
    test(`a path that is ${label} is refused as not a string`, () => {
      path((file) => put(file, "path", value), (i) => `scenario.files[${i}].path must be a string`);
    });
  }
  test("an entry file path is held to the same rule", () => {
    const issues = issuesFor((d) => {
      d.scenario.files[0].path = "../x.md";
      d.scenario.entryFilePath = "../x.md";
    });
    assert.ok(issues.includes(`${PREFIX}scenario.entryFilePath "../x.md" must not contain a "." or ".." segment`), issues.join("\n"));
    assert.ok(issues.includes(`${PREFIX}scenario.files[0].path "../x.md" must not contain a "." or ".." segment`), issues.join("\n"));
  });

  test("STILL DEFERRED, so accepted: any extension or none, and an all-capitals name (languages are not narrowed)", () => {
    for (const value of ["payload.exe", "UPPER.MD", "no-extension", "Main.java", "query.sql", "tool.py", "lib.rs", "Makefile", ".env"]) {
      accepted((d) => (d.scenario.files[freeFile(d)].path = value));
    }
  });

  test("pathProblem agrees with the rule, on its own", () => {
    for (const ok of ["a", "a/b", "dir/sub/file.name.ts", "INCIDENT.md", "public/dashboard.js", "a b/c d.md"]) assert.equal(pathProblem(ok), null, ok);
    for (const bad of ["", "a//b", "/a", "a/", "a/../b", "./a", "a\u0000", "a\\b", "C:/x", "%2e%2e/x", "a/b "]) assert.notEqual(pathProblem(bad), null, JSON.stringify(bad));
  });
});

describe("logs", () => {
  const log = (change: (entry: Record<string, unknown>) => void, expectFor: (index: number) => string) => {
    const index = freeLog(draftOf());
    exactly((d) => change(loose(d.scenario.logs[index])), expectFor(index));
  };

  for (const [label, value] of [["unknown", "FATAL"], ["the wrong case", "info"], ["a number", 7], ["null", null], ["missing", MISSING]] as [string, unknown][]) {
    test(`a level that is ${label} is refused, and the message lists the allowed values`, () => {
      log((entry) => put(entry, "level", value), (i) => `scenario.logs[${i}].level must be one of "DEBUG", "INFO", "WARN", "ERROR", not ${asShown(value)}`);
    });
  }
  test("every level the type names is accepted", () => {
    for (const level of ["DEBUG", "INFO", "WARN", "ERROR"]) accepted((d) => put(d.scenario.logs[freeLog(d)], "level", level));
  });

  for (const [label, value] of [["a number", 12345], ["null", null], ["a list", []], ["empty", ""], ["blank", "  "], ["missing", MISSING]] as [string, unknown][]) {
    test(`a log source that is ${label} is refused`, () => {
      log((entry) => put(entry, "source", value), (i) => `scenario.logs[${i}].source must be a non-blank string`);
    });
  }
  // The timestamp rules (format, and the relationship to a request) are in timestamps.test.ts.
  for (const [label, value] of [["a number", 5], ["null", null], ["an object", {}], ["missing", MISSING]] as [string, unknown][]) {
    test(`a log message that is ${label} is refused`, () => {
      log((entry) => put(entry, "message", value), (i) => `scenario.logs[${i}].message must be a string`);
    });
  }
  test("an empty log message is accepted", () => {
    accepted((d) => put(d.scenario.logs[freeLog(d)], "message", ""));
  });
  for (const blank of ["", "   "]) {
    test(`a log id that is ${JSON.stringify(blank)} is refused as blank`, () => {
      log((entry) => (entry.id = blank), (i) => `scenario.logs[${i}].id must not be blank`);
    });
  }
});

describe("network requests", () => {
  const request = (change: (r: Record<string, unknown>) => void, expected: string) => exactly((d) => change(loose(d.scenario.network[0])), `scenario.network[0].${expected}`);

  for (const [label, value] of [["unknown", "DELETE"], ["the wrong case", "get"], ["a number", 5], ["null", null], ["missing", MISSING]] as [string, unknown][]) {
    test(`a method that is ${label} is refused`, () => {
      request((r) => put(r, "method", value), `method must be one of "GET", "POST", not ${asShown(value)}`);
    });
  }
  for (const [label, value] of [["unknown", "websocket"], ["the wrong case", "Fetch"], ["a number", 1], ["missing", MISSING]] as [string, unknown][]) {
    test(`a request type that is ${label} is refused`, () => {
      request((r) => put(r, "type", value), `type must be one of "document", "script", "fetch", "ping", not ${asShown(value)}`);
    });
  }
  test("every method and request type the types name is accepted", () => {
    for (const method of ["GET", "POST"]) accepted((d) => put(d.scenario.network[0], "method", method));
    for (const type of ["document", "script", "fetch", "ping"]) accepted((d) => put(d.scenario.network[0], "type", type));
  });

  for (const [label, value] of [["99", 99], ["600", 600], ["negative", -1], ["fractional", 1.5], ["fractional inside the range", 200.5], ["zero", 0], ["a numeric string", "200"], ["null", null], ["a list", []], ["missing", MISSING]] as [string, unknown][]) {
    test(`a status that is ${label} is refused`, () => {
      request((r) => put(r, "status", value), `status must be an HTTP status code, a whole number from 100 to 599, not ${asShown(value)}`);
    });
  }
  test("the status boundaries 100 and 599 are accepted", () => {
    accepted((d) => put(d.scenario.network[0], "status", 100));
    accepted((d) => put(d.scenario.network[0], "status", 599));
  });

  for (const [label, value] of [["negative", -0.001], ["a numeric string", "5"], ["null", null], ["a list", []], ["missing", MISSING]] as [string, unknown][]) {
    test(`a duration that is ${label} is refused`, () => {
      request((r) => put(r, "durationMs", value), `durationMs must be a finite number of milliseconds, 0 or more, not ${asShown(value)}`);
    });
  }
  test("a duration of 0 and a fractional duration are accepted", () => {
    accepted((d) => put(d.scenario.network[0], "durationMs", 0));
    accepted((d) => put(d.scenario.network[0], "durationMs", 12.5));
  });
  for (const [label, value] of [["NaN", Number.NaN], ["Infinity", Infinity]] as const) {
    test(`a duration that is ${label} is refused as not a finite number`, () => {
      exactly((d) => put(d.scenario.network[0], "durationMs", value), "definition.scenario.network[0].durationMs must be a finite number");
    });
  }

  for (const key of ["url", "path"]) {
    for (const [label, value] of [["a number", 5], ["null", null], ["empty", ""], ["blank", " "], ["missing", MISSING]] as [string, unknown][]) {
      test(`a request ${key} that is ${label} is refused`, () => {
        request((r) => put(r, key, value), `${key} must be a non-blank string`);
      });
    }
  }
  test("STILL DEFERRED, so accepted: any non-blank url and path text", () => {
    accepted((d) => put(d.scenario.network[0], "url", "javascript:alert(1)"));
    accepted((d) => put(d.scenario.network[0], "path", "not a path"));
  });
  // The timestamp rules (format, and the relationship to its server log line) are in timestamps.test.ts.

  for (const [label, value] of [["a number", 5], ["null", null], ["missing", MISSING]] as [string, unknown][]) {
    test(`a statusText that is ${label} is refused`, () => {
      request((r) => put(r, "statusText", value), "statusText must be a string");
    });
  }
  test("an empty statusText is accepted (HTTP/2 has none)", () => {
    accepted((d) => put(d.scenario.network[0], "statusText", ""));
  });

  for (const key of ["requestBody", "responseBody"]) {
    for (const [label, value] of [["a number", 5], ["null", null], ["an object", {}], ["a list", []]] as [string, unknown][]) {
      test(`${key} that is ${label} is refused when present`, () => {
        request((r) => put(r, key, value), `${key} must be a string when present`);
      });
    }
    test(`${key} may be absent, undefined or an empty string`, () => {
      accepted((d) => put(d.scenario.network[0], key, MISSING));
      accepted((d) => put(d.scenario.network[0], key, undefined));
      accepted((d) => put(d.scenario.network[0], key, ""));
    });
  }

  for (const [label, value] of [["a number", 5], ["null", null], ["empty", ""], ["blank", "  "]] as [string, unknown][]) {
    test(`an initiator that is ${label} is refused when present`, () => {
      const issues = issuesFor((d) => put(d.scenario.network[0], "initiator", value));
      assert.ok(issues.includes(`${PREFIX}scenario.network[0].initiator must be a non-blank string when present`), issues.join("\n"));
    });
  }

  for (const key of ["requestHeaders", "responseHeaders"]) {
    test(`a ${key} entry with a blank name is refused, and one with an empty value is accepted`, () => {
      exactly((d) => put((loose(d.scenario.network[0])[key] as unknown[])[0], "name", " "), `scenario.network[0].${key}[0].name must not be blank`);
      accepted((d) => put((loose(d.scenario.network[0])[key] as unknown[])[0], "value", ""));
    });
    for (const [label, value] of [["a number", 5], ["null", null], ["missing", MISSING]] as [string, unknown][]) {
      test(`a ${key} name that is ${label} is refused as not a string`, () => {
        exactly((d) => put((loose(d.scenario.network[0])[key] as unknown[])[0], "name", value), `scenario.network[0].${key}[0].name must be a string`);
      });
    }
  }
});

describe("root-cause options", () => {
  const option = (change: (o: Record<string, unknown>) => void, expectFor: (index: number) => string) => {
    const index = wrongOption(draftOf());
    exactly((d) => change(loose(d.scenario.rootCauseOptions[index])), expectFor(index));
  };
  for (const key of ["label", "description"]) {
    for (const [label, value] of [["a number", 5], ["null", null], ["a list", []], ["empty", ""], ["blank", "  "], ["missing", MISSING]] as [string, unknown][]) {
      test(`an option ${key} that is ${label} is refused`, () => {
        option((o) => put(o, key, value), (i) => `scenario.rootCauseOptions[${i}].${key} must be a non-blank string`);
      });
    }
  }
  for (const blank of ["", "  "]) {
    test(`an option id that is ${JSON.stringify(blank)} is refused as blank`, () => {
      option((o) => (o.id = blank), (i) => `scenario.rootCauseOptions[${i}].id must not be blank`);
    });
  }
  // Approved: at least two options, and unique labels after trimming and lower-casing.
  // (These tests replace one that pinned the opposite: a single option and equal labels accepted.)
  describe("at least two options", () => {
    const keep = (d: Draft, count: number) => {
      const correct = d.scenario.rootCauseOptions.filter((o) => o.id === d.evaluation.correctRootCauseId);
      const others = d.scenario.rootCauseOptions.filter((o) => o.id !== d.evaluation.correctRootCauseId);
      d.scenario.rootCauseOptions = [...correct, ...others].slice(0, count);
    };

    test("a single option, even the correct one, is refused", () => {
      exactly((d) => keep(d, 1), "scenario.rootCauseOptions must have at least 2 options, not 1");
    });
    test("no options is refused, and so is a correct answer that has nothing to be", () => {
      const issues = issuesFor((d) => keep(d, 0));
      assert.ok(issues.includes(`${PREFIX}scenario.rootCauseOptions must have at least 2 options, not 0`), issues.join("\n"));
      assert.ok(issues.includes(`${PREFIX}the correct root cause is not one of the public root-cause options`), issues.join("\n"));
    });
    test("exactly two options are accepted", () => {
      accepted((d) => keep(d, 2));
    });
    test("a list of the wrong type is a shape error, not also a count error", () => {
      const issues = issuesFor((d) => put(d.scenario, "rootCauseOptions", "none"));
      assert.ok(!issues.some((issue) => issue.includes("at least 2 options")), issues.join("\n"));
    });
    test("zero key observations stay valid (approved)", () => {
      accepted((d) => (d.evaluation.keyObservations = []));
    });
  });

  describe("option labels are unique after trimming and lower-casing", () => {
    const same = (index: number, label: string, firstIndex: number, first: string) =>
      `scenario.rootCauseOptions[${index}].label ${shown(label)} is the same as scenario.rootCauseOptions[${firstIndex}].label ${shown(first)}, ignoring case and surrounding whitespace`;
    const labelOf = (d: Draft, i: number) => d.scenario.rootCauseOptions[i].label;

    test("an identical label is refused at the later option, naming the first", () => {
      const first = labelOf(draftOf(), 0);
      exactly((d) => (d.scenario.rootCauseOptions[1].label = labelOf(d, 0)), same(1, first, 0, first));
    });
    test("a label that differs only in case is refused", () => {
      const first = labelOf(draftOf(), 0);
      exactly((d) => (d.scenario.rootCauseOptions[1].label = labelOf(d, 0).toUpperCase()), same(1, first.toUpperCase(), 0, first));
    });
    test("a label that differs only by surrounding whitespace is refused", () => {
      const first = labelOf(draftOf(), 0);
      exactly((d) => (d.scenario.rootCauseOptions[1].label = `  ${labelOf(d, 0)}\t`), same(1, `  ${first}\t`, 0, first));
    });
    test("case and whitespace together are refused", () => {
      const first = labelOf(draftOf(), 0);
      exactly((d) => (d.scenario.rootCauseOptions[1].label = ` ${labelOf(d, 0).toLowerCase()} `), same(1, ` ${first.toLowerCase()} `, 0, first));
    });
    test("every later copy is reported against the first", () => {
      const first = labelOf(draftOf(), 0);
      const issues = issuesFor((d) => {
        d.scenario.rootCauseOptions[1].label = labelOf(d, 0);
        d.scenario.rootCauseOptions[2].label = labelOf(d, 0).toUpperCase();
      });
      assert.deepEqual(issues, [`${PREFIX}${same(1, first, 0, first)}`, `${PREFIX}${same(2, first.toUpperCase(), 0, first)}`]);
    });
    test("the same description, and a different label, are accepted", () => {
      accepted((d) => (d.scenario.rootCauseOptions[1].description = d.scenario.rootCauseOptions[0].description));
    });
    test("nothing beyond trimming and case is normalised: inner spacing and Unicode form make labels different", () => {
      accepted((d) => {
        d.scenario.rootCauseOptions[0].label = "Cookie  not sent";
        d.scenario.rootCauseOptions[1].label = "Cookie not sent";
      });
      accepted((d) => {
        d.scenario.rootCauseOptions[0].label = `Caf${String.fromCharCode(0xe9)}`;
        d.scenario.rootCauseOptions[1].label = `Cafe${String.fromCharCode(0x301)}`;
      });
    });
    test("a blank label is reported as blank only, and is not compared", () => {
      exactly((d) => (d.scenario.rootCauseOptions[1].label = "  "), "scenario.rootCauseOptions[1].label must be a non-blank string");
    });
  });
});

describe("the private evaluation", () => {
  test("a blank resolution summary is refused, and a non-string one is refused as not a string", () => {
    for (const value of ["", "   \n"]) exactly((d) => (d.evaluation.resolutionSummary = value), "evaluation.resolutionSummary must not be blank");
    for (const value of [5, null, [], MISSING]) exactly((d) => put(d.evaluation, "resolutionSummary", value), "evaluation.resolutionSummary must be a string");
  });
  test("a blank key-observation id is refused at its index", () => {
    for (const value of ["", "  "]) exactly((d) => (d.evaluation.keyObservations[1].id = value), "evaluation.keyObservations[1].id must not be blank");
  });
  test("a blank correct root-cause id is refused as blank, and as not a public option", () => {
    const issues = issuesFor((d) => (d.evaluation.correctRootCauseId = " "));
    assert.ok(issues.includes(`${PREFIX}evaluation.correctRootCauseId must not be blank`), issues.join("\n"));
    assert.ok(issues.includes(`${PREFIX}the correct root cause is not one of the public root-cause options`), issues.join("\n"));
  });
  test("a blank evidence id in a reference is refused as blank, and as unknown evidence", () => {
    const issues = issuesFor((d) => {
      d.evaluation.keyObservations[0].refs[0] = { kind: "log", logId: " " };
    });
    assert.ok(issues.includes(`${PREFIX}evaluation.keyObservations[0].refs[0].logId must not be blank`), issues.join("\n"));
    assert.ok(issues.some((issue) => issue.includes("refers to unknown evidence")), issues.join("\n"));
  });
  test("DEFERRED, so accepted today: no key observations at all", () => {
    accepted((d) => (d.evaluation.keyObservations = []));
  });
  test("a field message never repeats the private resolution text or the correct answer", () => {
    const secret = "SECRET-RESOLUTION-TEXT-0451";
    const issues = issuesFor((d) => {
      d.evaluation.resolutionSummary = secret;
      d.evaluation.correctRootCauseId = "";
      d.evaluation.keyObservations[0].id = " ";
      d.scenario.challenge.title = "";
    });
    assert.ok(issues.length >= 3);
    assert.ok(!issues.join("\n").includes(secret));
    assert.ok(!issues.join("\n").includes(draftOf().evaluation.correctRootCauseId));
  });
});

describe("required fields, removed one at a time", () => {
  const removals: [string, (d: Draft) => unknown, string, string][] = [
    ["challenge.number", (d) => d.scenario.challenge, "number", "scenario.challenge.number must be a non-blank string"],
    ["challenge.title", (d) => d.scenario.challenge, "title", "scenario.challenge.title must be a non-blank string"],
    ["challenge.incident", (d) => d.scenario.challenge, "incident", "scenario.challenge.incident must be a non-blank string"],
    ["challenge.tags", (d) => d.scenario.challenge, "tags", "scenario.challenge.tags must be a list"],
    ["scenario.incidentDate", (d) => d.scenario, "incidentDate", "scenario.incidentDate must be a real calendar date written YYYY-MM-DD, not \"undefined\""],
    ["scenario.contractVersion", (d) => d.scenario, "contractVersion", "contract version undefined is not supported"],
    ["scenario.entryFilePath", (d) => d.scenario, "entryFilePath", "scenario.entryFilePath must be a string"],
    ["evaluation.correctRootCauseId", (d) => d.evaluation, "correctRootCauseId", "evaluation.correctRootCauseId must be a string"],
    ["evaluation.resolutionSummary", (d) => d.evaluation, "resolutionSummary", "evaluation.resolutionSummary must be a string"],
    ["evaluation.keyObservations", (d) => d.evaluation, "keyObservations", "evaluation.keyObservations must be a list"],
    ["definition.revision", (d) => d, "revision", "definition.revision must be a string"],
  ];
  for (const [label, owner, key, expected] of removals) {
    test(`${label} missing is reported at its path`, () => {
      const issues = issuesFor((d) => delete loose(owner(d))[key]);
      assert.ok(issues.some((issue) => issue === `${PREFIX}${expected}`), `expected "${expected}" in:\n${issues.join("\n")}`);
    });
  }

  test("every documented field of a log, a request, an option and a file, removed in turn, gives its own field error", () => {
    const logFields = ["timestamp", "level", "source", "message"];
    const requestFields = ["timestamp", "method", "url", "path", "status", "statusText", "type", "durationMs"];
    for (const key of logFields) {
      const index = freeLog(draftOf());
      const issues = issuesFor((d) => delete loose(d.scenario.logs[index])[key]);
      assert.ok(issues.some((issue) => issue.startsWith(`${PREFIX}scenario.logs[${index}].${key} must be`)), `${key}: ${issues.join("\n")}`);
    }
    for (const key of requestFields) {
      const issues = issuesFor((d) => delete loose(d.scenario.network[0])[key]);
      assert.ok(issues.some((issue) => issue.startsWith(`${PREFIX}scenario.network[0].${key} must be`)), `${key}: ${issues.join("\n")}`);
    }
    for (const key of ["label", "description"]) {
      const index = wrongOption(draftOf());
      const issues = issuesFor((d) => delete loose(d.scenario.rootCauseOptions[index])[key]);
      assert.ok(issues.some((issue) => issue.startsWith(`${PREFIX}scenario.rootCauseOptions[${index}].${key} must be`)), `${key}: ${issues.join("\n")}`);
    }
    const file = freeFile(draftOf());
    const issues = issuesFor((d) => delete loose(d.scenario.files[file]).content);
    assert.deepEqual(issues, [`${PREFIX}scenario.files[${file}].content must be a string`]);
  });
});

describe("malformed nested objects", () => {
  const cases: [string, (d: Draft) => void, string][] = [
    ["scenario is a list", (d) => put(d, "scenario", []), "scenario must be an object"],
    ["challenge is a list", (d) => put(d.scenario, "challenge", []), "scenario.challenge must be an object"],
    ["challenge is a string", (d) => put(d.scenario, "challenge", "x"), "scenario.challenge must be an object"],
    ["a file is a string", (d) => put(d.scenario.files, "1", "x"), "scenario.files[1] must be an object"],
    ["a log is a list", (d) => put(d.scenario.logs, "2", []), "scenario.logs[2] must be an object"],
    ["a request is a number", (d) => put(d.scenario.network, "0", 7), "scenario.network[0] must be an object"],
    ["a header is null", (d) => put(d.scenario.network[0].requestHeaders, "0", null), "scenario.network[0].requestHeaders[0] must be an object"],
    ["a header list is an object", (d) => put(d.scenario.network[0], "responseHeaders", {}), "scenario.network[0].responseHeaders must be a list"],
    ["an option is a string", (d) => put(d.scenario.rootCauseOptions, "0", "x"), "scenario.rootCauseOptions[0] must be an object"],
    ["evaluation is a list", (d) => put(d, "evaluation", []), "evaluation must be an object"],
    ["an observation is a number", (d) => put(d.evaluation.keyObservations, "0", 5), "evaluation.keyObservations[0] must be an object"],
    ["refs is a string", (d) => put(d.evaluation.keyObservations[0], "refs", "log-01"), "evaluation.keyObservations[0].refs must be a list"],
    ["a ref is a string", (d) => put(d.evaluation.keyObservations[0].refs, "0", "log:log-01"), "evaluation.keyObservations[0].refs[0] must be an object"],
  ];
  for (const [label, change, expected] of cases) {
    test(`${label}`, () => {
      const issues = issuesFor(change);
      // With no usable challenge id the issue is named by position, so match on the message itself.
      assert.ok(issues.some((issue) => issue.endsWith(`: ${expected}`)), `expected "${expected}" in:\n${issues.join("\n")}`);
      assert.ok(!issues.some((issue) => /TypeError|Cannot read/.test(issue)), "no raw error text");
    });
  }

  test("a field problem is reported at the item's real index even when an earlier item is not an object", () => {
    const issues = issuesFor((d) => {
      put(d.scenario.logs, "0", null);
      put(d.scenario.logs[1], "level", "FATAL");
    });
    assert.ok(issues.includes(`${PREFIX}scenario.logs[0] must be an object`), issues.join("\n"));
    assert.ok(
      issues.includes(`${PREFIX}scenario.logs[1].level must be one of "DEBUG", "INFO", "WARN", "ERROR", not "FATAL"`),
      issues.join("\n"),
    );
  });
});

describe("unexpected properties (the policy is deferred): ignored, never published", () => {
  test("an unknown property at every level is accepted and does not reach the public view or the version", () => {
    const base = createChallengeRegistry([draftOf()]);
    const polluted = draftOf((d) => {
      loose(d).extra = "x";
      loose(d.scenario).extra = "x";
      loose(d.scenario.challenge).extra = "x";
      loose(d.scenario.files[0]).extra = "x";
      loose(d.scenario.logs[0]).extra = "x";
      loose(d.scenario.network[0]).extra = "x";
      loose(d.scenario.network[0].requestHeaders[0]).extra = "x";
      loose(d.scenario.rootCauseOptions[0]).extra = "x";
      loose(d.evaluation).extra = "x";
      loose(d.evaluation.keyObservations[0]).extra = "x";
      loose(d.evaluation.keyObservations[0].refs[0]).extra = "x";
    });
    assert.deepEqual(findDefinitionIssues([polluted]), []);
    const registry = createChallengeRegistry([polluted]);
    assert.equal(JSON.stringify(registry.getPublic("challenge-001")), JSON.stringify(base.getPublic("challenge-001")));
    assert.equal(registry.contentVersion("challenge-001"), base.contentVersion("challenge-001"));
  });
});

describe("the snapshot: what is validated is exactly what is published and graded", () => {
  /** A definition whose field is a getter that counts how often it is called. */
  function withGetter(owner: object, key: string, value: unknown, counter: { reads: number }): void {
    Object.defineProperty(owner, key, {
      enumerable: true,
      configurable: true,
      get() {
        counter.reads += 1;
        return value;
      },
    });
  }

  const places: [string, (d: Draft) => object, string, string][] = [
    ["the definition's scenario", (d) => d, "scenario", "definition.scenario"],
    ["the definition's evaluation", (d) => d, "evaluation", "definition.evaluation"],
    ["the definition's revision", (d) => d, "revision", "definition.revision"],
    ["a manifest field", (d) => d.scenario.challenge, "title", "definition.scenario.challenge.title"],
    ["a log field", (d) => d.scenario.logs[0], "message", "definition.scenario.logs[0].message"],
    ["a header value", (d) => d.scenario.network[0].requestHeaders[0], "value", "definition.scenario.network[0].requestHeaders[0].value"],
    ["the correct root cause", (d) => d.evaluation, "correctRootCauseId", "definition.evaluation.correctRootCauseId"],
    ["the resolution summary", (d) => d.evaluation, "resolutionSummary", "definition.evaluation.resolutionSummary"],
    ["a key observation's refs", (d) => d.evaluation.keyObservations[0], "refs", "definition.evaluation.keyObservations[0].refs"],
    ["a reference", (d) => d.evaluation.keyObservations[0].refs[0], "kind", "definition.evaluation.keyObservations[0].refs[0].kind"],
  ];
  for (const [label, owner, key, path] of places) {
    test(`a getter on ${label} is refused with its path, and is never called`, () => {
      const counter = { reads: 0 };
      const definition = draftOf();
      const target = owner(definition);
      withGetter(target, key, Reflect.get(target, key), counter);
      const issues = findDefinitionIssues([definition]);
      assert.ok(
        issues.some((issue) => issue.endsWith(`${path} must be a plain value, not a getter or setter`)),
        `expected ${path} in:\n${issues.join("\n")}`,
      );
      assert.throws(() => createChallengeRegistry([definition]), ChallengeDefinitionError);
      assert.equal(counter.reads, 0, "the getter must never be called");
    });
  }

  test("a setter-only accessor is refused too, and never called", () => {
    let sets = 0;
    const definition = draftOf();
    Object.defineProperty(definition.evaluation, "resolutionSummary", {
      enumerable: true,
      set() {
        sets += 1;
      },
    });
    const issues = findDefinitionIssues([definition]);
    assert.ok(issues.some((issue) => issue.endsWith("definition.evaluation.resolutionSummary must be a plain value, not a getter or setter")), issues.join("\n"));
    assert.equal(sets, 0);
  });

  test("the audit's case: a getter that returns a valid answer first and an invalid one later cannot get a bad key sealed", () => {
    const counter = { reads: 0 };
    const definition = draftOf();
    const real = definition.evaluation.correctRootCauseId;
    Object.defineProperty(definition.evaluation, "correctRootCauseId", {
      enumerable: true,
      get() {
        counter.reads += 1;
        return counter.reads <= 2 ? real : "not-an-option";
      },
    });
    assert.throws(
      () => createChallengeRegistry([definition]),
      (error: unknown) =>
        error instanceof ChallengeDefinitionError &&
        error.issues.some((issue) => issue.endsWith("definition.evaluation.correctRootCauseId must be a plain value, not a getter or setter")),
    );
    assert.equal(counter.reads, 0);
  });

  test("the audit's other case: a scenario getter swapped after validation cannot change what is published", () => {
    const counter = { reads: 0 };
    const definition = draftOf();
    const good = definition.scenario;
    const swapped = structuredClone(good);
    swapped.challenge.title = "SWAPPED AFTER VALIDATION";
    Object.defineProperty(definition, "scenario", {
      enumerable: true,
      get() {
        counter.reads += 1;
        return counter.reads <= 3 ? good : swapped;
      },
    });
    assert.throws(() => createChallengeRegistry([definition]), ChallengeDefinitionError);
    assert.equal(counter.reads, 0);
  });

  test("a list element that is a getter is read exactly once, and what it returned is what is used", () => {
    const counter = { reads: 0 };
    const definitions: unknown[] = [];
    withGetter(definitions, "0", draftOf(), counter);
    definitions.length = 1;
    const registry = createChallengeRegistry(definitions as never);
    assert.equal(counter.reads, 1);
    assert.deepEqual(registry.list().map((summary) => summary.id), ["challenge-001"]);
  });

  test("an object with a class prototype is refused at its path, whether it is the scenario, the evaluation or a field", () => {
    class Holder {
      value = 1;
    }
    for (const [put_, path] of [
      [(d: Draft) => put(d, "scenario", Object.assign(new Holder(), d.scenario)), "definition.scenario"],
      [(d: Draft) => put(d, "evaluation", Object.assign(new Holder(), d.evaluation)), "definition.evaluation"],
      [(d: Draft) => put(d.scenario.network[0], "requestBody", new Holder()), "definition.scenario.network[0].requestBody"],
    ] as const) {
      const issues = issuesFor(put_);
      assert.ok(issues.some((issue) => issue.endsWith(`${path} must be a plain object, a list or a primitive value`)), `${path}: ${issues.join("\n")}`);
    }
  });

  test("a symbol-keyed or non-enumerable property is refused: a copy would silently drop it", () => {
    const withSymbol = issuesFor((d) => put(d.evaluation, Symbol("hidden") as never, 1));
    assert.ok(withSymbol.some((issue) => issue.endsWith("definition.evaluation must not have symbol-keyed or non-enumerable properties")), withSymbol.join("\n"));
    const hidden = issuesFor((d) => Object.defineProperty(d.scenario.challenge, "hidden", { value: 1, enumerable: false }));
    assert.ok(hidden.some((issue) => issue.endsWith("definition.scenario.challenge must not have symbol-keyed or non-enumerable properties")), hidden.join("\n"));
  });

  test("a list with a hole or an extra named property is refused", () => {
    const holey = issuesFor((d) => (d.scenario.challenge.tags = new Array(3) as string[]));
    assert.ok(holey.some((issue) => issue.endsWith("definition.scenario.challenge.tags must be a plain list, with no holes and no extra properties")), holey.join("\n"));
    const extra = issuesFor((d) => (d.scenario.challenge.tags = Object.assign(["a"], { note: "x" })));
    assert.ok(extra.some((issue) => issue.endsWith("definition.scenario.challenge.tags must be a plain list, with no holes and no extra properties")), extra.join("\n"));
  });

  test("a proxy is refused as the evaluation, as a field, and as the whole list", () => {
    const trap = { get() { throw new Error("must not be asked"); }, getOwnPropertyDescriptor() { throw new Error("must not be asked"); }, ownKeys() { throw new Error("must not be asked"); } };
    const asEvaluation = issuesFor((d) => put(d, "evaluation", new Proxy({}, trap)));
    assert.ok(asEvaluation.some((issue) => issue.endsWith("definition.evaluation must be plain data, not a proxy")), asEvaluation.join("\n"));
    const asField = issuesFor((d) => put(d.scenario.challenge, "tags", new Proxy([], trap)));
    assert.ok(asField.some((issue) => issue.endsWith("definition.scenario.challenge.tags must be plain data, not a proxy")), asField.join("\n"));
    assert.deepEqual(findDefinitionIssues(new Proxy([draftOf()], trap)), ["definitions must be a list"]);
  });

  test("a frozen definition is plain data and is accepted: freezing is not an accessor", () => {
    const frozen = structuredClone(draftOf());
    const freeze = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    };
    freeze(frozen);
    assert.deepEqual(findDefinitionIssues([frozen]), []);
    assert.doesNotThrow(() => createChallengeRegistry([frozen]));
  });

  test("the registry shares nothing with the source, so editing the source's nested objects afterwards changes nothing it holds or grades with", () => {
    const definition = draftOf();
    const registry = createChallengeRegistry([definition]);
    const key = registry.getDiagnosis("challenge-001")!.answerKey;
    const before = JSON.stringify([key.correctRootCauseId, key.resolutionSummary, key.keyObservations.map((g) => [g.id, [...g.evidenceIds]])]);

    definition.evaluation.keyObservations[0].refs.push({ kind: "log", logId: "log-01" });
    definition.evaluation.keyObservations.length = 0;
    definition.evaluation.correctRootCauseId = definition.scenario.rootCauseOptions[0].id;
    definition.evaluation.resolutionSummary = "tampered";
    definition.scenario.rootCauseOptions.length = 0;
    definition.scenario.logs.length = 0;

    const after = registry.getDiagnosis("challenge-001")!.answerKey;
    assert.equal(JSON.stringify([after.correctRootCauseId, after.resolutionSummary, after.keyObservations.map((g) => [g.id, [...g.evidenceIds]])]), before);
    assert.ok(registry.getPublic("challenge-001")!.logs.length > 0);
    assert.ok(registry.getDiagnosis("challenge-001")!.validation.rootCauseIds.size > 0);
  });

  test("public and private data stay apart after snapshotting: nothing private is in the public view, the list or the registry's printout", async () => {
    const { inspect } = await import("node:util");
    const registry = createDefaultChallengeRegistry();
    const evaluation = draftOf().evaluation;
    const surface = [JSON.stringify(registry.getPublic("challenge-001")), JSON.stringify(registry.list()), inspect(registry, { depth: 0 })].join("\n");
    assert.ok(!surface.includes(evaluation.resolutionSummary));
    for (const group of evaluation.keyObservations) assert.ok(!surface.includes(group.id), group.id);
    assert.ok(!/keyObservations|resolutionSummary|answerKey/.test(surface));
  });
});

describe("registry version stability", () => {
  test("the version equals the version computed from the source directly, so snapshotting changes nothing", () => {
    const source = draftOf();
    const expected = contentVersionOf(source.revision, toPublicChallenge(source.scenario));
    assert.equal(createChallengeRegistry([source]).contentVersion("challenge-001"), expected);
    assert.equal(createDefaultChallengeRegistry().contentVersion("challenge-001")?.startsWith(`${source.revision}+`), true);
  });

  test("it is the same for every way of building the same content: twice, from a clone, from a frozen copy, with keys in another order", () => {
    const versions = new Set<string | undefined>();
    versions.add(createChallengeRegistry([draftOf()]).contentVersion("challenge-001"));
    versions.add(createChallengeRegistry([draftOf()]).contentVersion("challenge-001"));
    versions.add(
      createChallengeRegistry([
        draftOf((d) => {
          d.scenario.challenge = Object.fromEntries(Object.entries(d.scenario.challenge).reverse()) as typeof d.scenario.challenge;
          d.scenario = Object.fromEntries(Object.entries(d.scenario).reverse()) as typeof d.scenario;
        }),
      ]).contentVersion("challenge-001"),
    );
    const frozen = Object.freeze(structuredClone(draftOf()));
    versions.add(createChallengeRegistry([frozen]).contentVersion("challenge-001"));
    assert.equal(versions.size, 1, [...versions].join(", "));
  });

  test("a field fix that makes an invalid definition valid does not change the version of content that was already valid", () => {
    const base = createChallengeRegistry([draftOf()]).contentVersion("challenge-001");
    assert.notEqual(createChallengeRegistry([draftOf((d) => (d.scenario.challenge.title += "!"))]).contentVersion("challenge-001"), base);
    assert.equal(createChallengeRegistry([draftOf((d) => (d.evaluation.resolutionSummary += "!"))]).contentVersion("challenge-001"), base);
    assert.notEqual(createChallengeRegistry([draftOf((d) => (d.revision = "2"))]).contentVersion("challenge-001"), base);
  });

  test("validation is deterministic: the same invalid definition gives the same issues in the same order, every time", () => {
    const change = (d: Draft) => {
      d.scenario.challenge.title = "";
      d.scenario.challenge.difficulty = "x" as never;
      d.scenario.network[0].status = 99;
      d.evaluation.resolutionSummary = "";
    };
    const first = issuesFor(change);
    assert.ok(first.length >= 4);
    assert.deepEqual(issuesFor(change), first);
    assert.deepEqual(issuesFor(change), first);
  });
});
