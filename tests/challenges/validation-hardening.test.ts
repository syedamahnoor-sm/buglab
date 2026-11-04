/*
 * Regression tests for the validation hardening: completion, challenge id format, revision
 * format, evidence-reference kinds, malformed structures, and source names in loader errors.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ChallengeDefinitionError,
  SUPPORTED_CONTRACT_VERSIONS,
  isValidChallengeId,
  isValidRevision,
} from "@/server/challenges/definition";
import { loadChallengeRegistry, staticChallengeSource } from "@/server/challenges/loader";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { findDefinitionIssues } from "@/server/challenges/validate";
import { definitionOf, draftOf, type Draft } from "./helpers";

const issuesFor = (change: (draft: Draft) => void) => findDefinitionIssues([definitionOf(change)]);
const mentions = (issues: string[], text: string) => issues.some((issue) => issue.includes(text));

/** Lets a test break the shape of a definition on purpose. */
type Loose = { [key: string]: unknown };
const loose = (value: unknown) => value as Loose;

describe("completion must be diagnosis", () => {
  test("a fix-mode challenge is refused, because this registry only produces diagnosis challenges", () => {
    const issues = issuesFor((draft) => {
      loose(draft.scenario.challenge).completion = "fix";
    });
    assert.ok(mentions(issues, 'completion must be "diagnosis", not "fix"'), issues.join("\n"));
  });

  test("a missing or unknown completion is refused too", () => {
    for (const value of [undefined, "", "Diagnosis", "solve"]) {
      const issues = issuesFor((draft) => {
        loose(draft.scenario.challenge).completion = value;
      });
      assert.ok(mentions(issues, "completion must be"), String(value));
    }
  });
});

describe("challenge id format", () => {
  const rejected: [string, unknown][] = [
    ["uppercase", "Challenge-001"],
    ["an underscore", "challenge_001"],
    ["a space", "challenge 001"],
    ["surrounding spaces", " challenge-001 "],
    ["a slash", "a/b"],
    ["path traversal", "../a"],
    ["a dot", "challenge.001"],
    ["a leading hyphen", "-a"],
    ["a trailing hyphen", "a-"],
    ["a double hyphen", "challenge--001"],
    ["the name __proto__", "__proto__"],
    ["non-ASCII characters", "défi-1"],
    ["no characters", ""],
    ["65 characters", "a".repeat(65)],
    ["a number instead of a string", 7],
  ];

  for (const [label, id] of rejected) {
    test(`refuses an id with ${label}`, () => {
      const issues = issuesFor((draft) => {
        loose(draft.scenario.challenge).id = id;
      });
      assert.ok(issues.length > 0, label);
      assert.ok(mentions(issues, "is not valid") || mentions(issues, "must be a string"), `${label}: ${issues.join("\n")}`);
    });
  }

  test("accepts lowercase letters and digits in hyphen-separated groups, up to 64 characters", () => {
    for (const id of ["challenge-001", "a", "0", "sql-joins-2", "a".repeat(64)]) {
      assert.equal(isValidChallengeId(id), true, id);
      const issues = issuesFor((draft) => {
        loose(draft.scenario.challenge).id = id;
      });
      assert.deepEqual(issues, [], id);
    }
  });

  test("the registry refuses to be built with a bad id", () => {
    const bad = definitionOf((draft) => {
      loose(draft.scenario.challenge).id = "Not Valid";
    });
    assert.throws(() => createChallengeRegistry([bad]), ChallengeDefinitionError);
  });

  test("a bad id is reported by position, and the definition's other problems are still reported", () => {
    const bad = definitionOf((draft) => {
      loose(draft.scenario.challenge).id = "Not Valid";
      draft.scenario.entryFilePath = "missing.md";
    });
    const issues = findDefinitionIssues([definitionOf(), bad]);
    assert.ok(mentions(issues, "definition #2: challenge id"), issues.join("\n"));
    assert.ok(mentions(issues, "definition #2: entry file"), issues.join("\n"));
  });
});

describe("revision format", () => {
  const rejected: [string, unknown][] = [
    ["empty", ""],
    ["blank", "   "],
    ["containing a plus sign (it would make the version ambiguous)", "1+x"],
    ["containing a space", "1 2"],
    ["starting with a hyphen", "-1"],
    ["starting with a dot", ".1"],
    ["containing a slash", "v1/b"],
    ["non-ASCII", "é"],
    ["33 characters long", "r".repeat(33)],
    ["a number", 1],
    ["missing", undefined],
  ];

  for (const [label, revision] of rejected) {
    test(`refuses a revision that is ${label}`, () => {
      const issues = issuesFor((draft) => {
        loose(draft).revision = revision;
      });
      assert.ok(issues.length > 0, label);
      assert.ok(mentions(issues, "revision"), `${label}: ${issues.join("\n")}`);
    });
  }

  test("accepts letters, digits, dots and hyphens, up to 32 characters", () => {
    for (const revision of ["1", "2", "1.2.3", "r7", "2026-11-03", "r".repeat(32)]) {
      assert.equal(isValidRevision(revision), true, revision);
      const issues = issuesFor((draft) => {
        draft.revision = revision;
      });
      assert.deepEqual(issues, [], revision);
    }
  });

  test("a valid revision can always be split back out of the version, because it never contains a plus", () => {
    for (const revision of ["1", "1.2", "2026-11-03"]) {
      const registry = createChallengeRegistry([
        definitionOf((draft) => {
          draft.revision = revision;
        }),
      ]);
      const parts = registry.contentVersion("challenge-001")!.split("+");
      assert.equal(parts.length, 2);
      assert.equal(parts[0], revision);
    }
  });

  test("the supported contract versions cannot be changed at runtime", () => {
    assert.ok(Object.isFrozen(SUPPORTED_CONTRACT_VERSIONS));
    assert.throws(() => (SUPPORTED_CONTRACT_VERSIONS as number[]).push(99), TypeError);
  });
});

describe("evidence references must be a valid discriminated union", () => {
  const pushRef = (ref: unknown) => (draft: Draft) => {
    (draft.evaluation.keyObservations[0].refs as unknown[]).push(ref);
  };

  const bad: [string, unknown, string][] = [
    ["an unknown kind", { kind: "foo", requestId: "req-14" }, 'kind must be "log" or "network", not "foo"'],
    ["a missing kind", { requestId: "req-14" }, 'kind must be "log" or "network"'],
    ["a kind of the wrong type", { kind: 1, requestId: "req-14" }, 'kind must be "log" or "network"'],
    ["a log reference with no logId", { kind: "log" }, "logId must be a string"],
    ["a log reference carrying a requestId instead", { kind: "log", requestId: "req-14" }, "logId must be a string"],
    ["a network reference carrying a logId instead", { kind: "network", logId: "log-01" }, "requestId must be a string"],
    ["a numeric id", { kind: "network", requestId: 14 }, "requestId must be a string"],
    ["a string", "network:req-14", "must be an object"],
    ["null", null, "must be an object"],
    ["a list", ["network", "req-14"], "must be an object"],
  ];

  for (const [label, ref, expected] of bad) {
    test(`refuses ${label}`, () => {
      const issues = issuesFor(pushRef(ref));
      assert.ok(mentions(issues, expected), `${label}: ${issues.join("\n")}`);
      assert.throws(() => createChallengeRegistry([definitionOf(pushRef(ref))]), ChallengeDefinitionError);
    });
  }

  test("a bad kind is never looked up as a network request that happens to exist", () => {
    const issues = issuesFor(pushRef({ kind: "foo", requestId: "req-01" }));
    assert.ok(mentions(issues, 'not "foo"'), issues.join("\n"));
  });

  test("both valid kinds are still accepted", () => {
    const issues = issuesFor((draft) => {
      draft.evaluation.keyObservations[0].refs.push({ kind: "log", logId: "log-01" }, { kind: "network", requestId: "req-14" });
    });
    // These ids already belong to other groups, so sharing is flagged, but the kind is not.
    assert.ok(!mentions(issues, "kind must be"), issues.join("\n"));
  });
});

describe("malformed structures are definition errors, never raw TypeErrors", () => {
  // Each case breaks one required structure and names the path the error must point at.
  const malformed: [string, (draft: Draft) => void, string][] = [
    ["a missing scenario", (d) => delete loose(d).scenario, "scenario must be an object"],
    ["a missing evaluation", (d) => delete loose(d).evaluation, "evaluation must be an object"],
    ["a missing challenge", (d) => delete loose(d.scenario).challenge, "scenario.challenge must be an object"],
    ["a missing files list", (d) => delete loose(d.scenario).files, "scenario.files must be a list"],
    ["a missing logs list", (d) => delete loose(d.scenario).logs, "scenario.logs must be a list"],
    ["a missing network list", (d) => delete loose(d.scenario).network, "scenario.network must be a list"],
    ["missing root-cause options", (d) => delete loose(d.scenario).rootCauseOptions, "scenario.rootCauseOptions must be a list"],
    ["missing tags", (d) => delete loose(d.scenario.challenge).tags, "scenario.challenge.tags must be a list"],
    ["a missing entry file path", (d) => delete loose(d.scenario).entryFilePath, "scenario.entryFilePath must be a string"],
    ["a file with no path", (d) => delete loose(d.scenario.files[0]).path, "scenario.files[0].path must be a string"],
    ["a null file", (d) => ((d.scenario.files as unknown[])[1] = null), "scenario.files[1] must be an object"],
    ["a log with no id", (d) => delete loose(d.scenario.logs[2]).id, "scenario.logs[2].id must be a string"],
    ["a request with no request headers", (d) => delete loose(d.scenario.network[0]).requestHeaders, "scenario.network[0].requestHeaders must be a list"],
    ["a request with no response headers", (d) => delete loose(d.scenario.network[3]).responseHeaders, "scenario.network[3].responseHeaders must be a list"],
    // A missing serverLogId is VALID now (a request may have no linked log); a present one of the wrong type is not.
    ["a request whose serverLogId is not a string", (d) => (loose(d.scenario.network[0]).serverLogId = 5), "scenario.network[0].serverLogId must be a string when present"],
    ["an option with no id", (d) => delete loose(d.scenario.rootCauseOptions[0]).id, "scenario.rootCauseOptions[0].id must be a string"],
    ["no correct root cause", (d) => delete loose(d.evaluation).correctRootCauseId, "evaluation.correctRootCauseId must be a string"],
    ["no resolution summary", (d) => delete loose(d.evaluation).resolutionSummary, "evaluation.resolutionSummary must be a string"],
    ["missing key observations", (d) => delete loose(d.evaluation).keyObservations, "evaluation.keyObservations must be a list"],
    ["an observation with no id", (d) => delete loose(d.evaluation.keyObservations[0]).id, "evaluation.keyObservations[0].id must be a string"],
    ["an observation with no refs", (d) => delete loose(d.evaluation.keyObservations[1]).refs, "evaluation.keyObservations[1].refs must be a list"],
    ["a missing revision", (d) => delete loose(d).revision, "definition.revision must be a string"],
  ];

  for (const [label, change, expected] of malformed) {
    test(label, () => {
      const definition = definitionOf((draft) => void change(draft));
      assert.throws(
        () => createChallengeRegistry([definition]),
        (error: unknown) => {
          assert.ok(!(error instanceof TypeError), "must not be a raw TypeError");
          assert.ok(error instanceof ChallengeDefinitionError);
          assert.ok(
            error.issues.some((issue) => issue.includes(expected)),
            `expected "${expected}" in:\n${error.issues.join("\n")}`,
          );
          return true;
        },
      );
    });
  }

  test("a definition that is not an object, and a list that is not a list", () => {
    for (const bad of [null, undefined, "x", 7, [], () => 0]) {
      assert.throws(() => createChallengeRegistry([bad as never]), ChallengeDefinitionError, String(bad));
    }
    for (const bad of [null, undefined, {}, "x"]) {
      assert.throws(() => createChallengeRegistry(bad as never), ChallengeDefinitionError, String(bad));
    }
  });

  test("a definition with no usable id is named by its position", () => {
    const issues = findDefinitionIssues([definitionOf(), null]);
    assert.ok(mentions(issues, "definition #2: definition must be an object"), issues.join("\n"));
  });

  test("one malformed definition does not hide a problem in another", () => {
    const broken = definitionOf((draft) => {
      delete loose(draft.scenario).files;
    });
    const sibling = definitionOf((draft) => {
      loose(draft.scenario.challenge).id = "challenge-002";
      loose(draft.scenario.challenge).number = "002";
      draft.scenario.entryFilePath = "missing.md";
    });
    const issues = findDefinitionIssues([broken, sibling]);
    assert.ok(mentions(issues, "challenge-001: scenario.files must be a list"), issues.join("\n"));
    assert.ok(mentions(issues, "challenge-002: entry file"), issues.join("\n"));
  });

  test("a definition with a malformed shape still takes part in the duplicate-id check", () => {
    const broken = definitionOf((draft) => {
      delete loose(draft.scenario).files;
    });
    const issues = findDefinitionIssues([definitionOf(), broken]);
    assert.ok(mentions(issues, 'challenge id "challenge-001" is defined more than once'), issues.join("\n"));
  });

  test("a very long list of problems is cut off instead of flooding the log", () => {
    const broken = definitionOf((draft) => {
      draft.scenario.files = Array.from({ length: 100 }, () => null) as never;
    });
    const issues = findDefinitionIssues([broken]);
    assert.ok(issues.length <= 22, String(issues.length));
    assert.ok(mentions(issues, "more problems"), issues.join("\n"));
  });

  test("messages carry paths, never answer text", () => {
    const definition = definitionOf((draft) => {
      delete loose(draft.scenario).files;
      delete loose(draft.evaluation).correctRootCauseId;
    });
    try {
      createChallengeRegistry([definition]);
      assert.fail("expected a definition error");
    } catch (error) {
      assert.ok(error instanceof ChallengeDefinitionError);
      assert.ok(!error.message.includes(draftOf().evaluation.resolutionSummary));
      assert.ok(!error.message.includes(draftOf().evaluation.correctRootCauseId));
    }
  });
});

describe("loader errors name their source", () => {
  const named = (name: string, change: (draft: Draft) => void) => staticChallengeSource(name, [definitionOf(change)]);

  test("a semantic problem is reported with the source it came from", () => {
    const source = named("authored-by-hand", (draft) => {
      draft.scenario.entryFilePath = "missing.md";
    });
    assert.throws(
      () => loadChallengeRegistry([source]),
      (error: unknown) =>
        error instanceof ChallengeDefinitionError &&
        error.issues.some((issue) => issue.startsWith('challenge-001 (source "authored-by-hand"): entry file')),
    );
  });

  test("a structural problem is reported with the source it came from", () => {
    const source = named("imported", (draft) => {
      delete loose(draft.scenario).logs;
    });
    assert.throws(
      () => loadChallengeRegistry([source]),
      (error: unknown) =>
        error instanceof ChallengeDefinitionError &&
        error.issues.some((issue) => issue.includes('(source "imported"): scenario.logs must be a list')),
    );
  });

  test("a duplicate id names both sources", () => {
    const first = named("first-source", () => undefined);
    const second = named("second-source", () => undefined);
    assert.throws(
      () => loadChallengeRegistry([first, second]),
      (error: unknown) =>
        error instanceof ChallengeDefinitionError &&
        error.issues.some(
          (issue) =>
            issue.includes('challenge id "challenge-001" is defined more than once') &&
            issue.includes('"first-source"') &&
            issue.includes('"second-source"'),
        ),
    );
  });

  test("the problem is attributed to the right source when several are loaded", () => {
    const good = staticChallengeSource("good", [
      definitionOf((draft) => {
        loose(draft.scenario.challenge).id = "challenge-002";
        loose(draft.scenario.challenge).number = "002";
      }),
    ]);
    const bad = named("bad", (draft) => {
      draft.evaluation.correctRootCauseId = "not-an-option";
    });
    assert.throws(
      () => loadChallengeRegistry([good, bad]),
      (error: unknown) =>
        error instanceof ChallengeDefinitionError &&
        error.issues.length === 1 &&
        error.issues[0].includes('(source "bad")') &&
        !error.issues[0].includes('"good"'),
    );
  });

  test("a source that returns something other than a list is a definition error that names it", () => {
    const wrong = { name: "returns-an-object", load: () => ({}) as never };
    assert.throws(
      () => loadChallengeRegistry([wrong]),
      (error: unknown) =>
        error instanceof ChallengeDefinitionError &&
        error.message.includes('source "returns-an-object" did not return a list of challenge definitions'),
    );
  });

  test("a source that throws a TypeError is wrapped, with its name", () => {
    const broken = {
      name: "throws-type-error",
      load: () => {
        throw new TypeError("boom");
      },
    };
    assert.throws(
      () => loadChallengeRegistry([broken]),
      (error: unknown) =>
        error instanceof ChallengeDefinitionError && error.message.includes('source "throws-type-error" could not be loaded: boom'),
    );
  });
});
