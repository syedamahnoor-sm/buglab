/*
 * Syeda's validation decisions, proven. (Her decisions on the deferred rules in section 8.7.)
 *
 * Enforced here: challenge numbers are unique across the registry. The other enforced decisions
 * (at least two options, unique option labels, case-insensitive tags) are in field-validation.test.ts
 * next to the fields they constrain, and the numerical limits are in limits.test.ts.
 *
 * Also proven here, because "stays as it is" is only a decision if something fails when it changes:
 * an unexpected property is ignored and reaches neither the public view nor the evaluation, and a
 * Windows-reserved file name is a perfectly good name for a virtual file.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ChallengeDefinitionError } from "@/server/challenges/definition";
import { loadChallengeRegistry, staticChallengeSource } from "@/server/challenges/loader";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { findDefinitionIssues } from "@/server/challenges/validate";
import { evaluateDiagnosis } from "@/server/diagnosis/evaluate";
import type { DiagnosisSubmission } from "@/types/diagnosis";
import { definitionOf, draftOf, toPlain, type Draft } from "./helpers";
import { accepted, freeFile, loose } from "./mutation-helpers";

const NUMBER_MESSAGE = (number: string, owners: string) => `challenge number "${number}" is used by more than one challenge (${owners})`;

/** Challenge 001's content as another challenge: its own id, and its own number unless told otherwise. */
const another = (id: string, number: string, change?: (draft: Draft) => void) =>
  definitionOf((d) => {
    loose(d.scenario.challenge).id = id;
    loose(d.scenario.challenge).number = number;
    change?.(d);
  });

const FIRST = () => definitionOf();
const FIRST_NUMBER = draftOf().scenario.challenge.number;

describe("challenge numbers are unique across the registry", () => {
  test("two challenges with the same number are refused, naming the number and both challenges", () => {
    const issues = findDefinitionIssues([FIRST(), another("challenge-002", FIRST_NUMBER)]);

    assert.deepEqual(issues, [NUMBER_MESSAGE(FIRST_NUMBER, "challenge-001, challenge-002")]);
  });

  test("the registry refuses to exist, and so does the loader, with that message", () => {
    const definitions = [FIRST(), another("challenge-002", FIRST_NUMBER)];

    const expect = (error: unknown) =>
      error instanceof ChallengeDefinitionError && error.issues.includes(NUMBER_MESSAGE(FIRST_NUMBER, "challenge-001, challenge-002"));
    assert.throws(() => createChallengeRegistry(definitions), expect);
    assert.throws(() => loadChallengeRegistry([staticChallengeSource("a", [definitions[0]]), staticChallengeSource("b", [definitions[1]])]), expect);
  });

  test("every challenge that shares a number is listed, in registration order", () => {
    const issues = findDefinitionIssues([FIRST(), another("challenge-002", FIRST_NUMBER), another("challenge-003", FIRST_NUMBER)]);

    assert.deepEqual(issues, [NUMBER_MESSAGE(FIRST_NUMBER, "challenge-001, challenge-002, challenge-003")]);
  });

  test("the order the challenges are given in is the order they are named in", () => {
    const issues = findDefinitionIssues([another("challenge-002", FIRST_NUMBER), FIRST()]);

    assert.deepEqual(issues, [NUMBER_MESSAGE(FIRST_NUMBER, "challenge-002, challenge-001")]);
  });

  test("two separate pairs of duplicates are each reported", () => {
    const issues = findDefinitionIssues([
      FIRST(),
      another("challenge-002", FIRST_NUMBER),
      another("challenge-003", "003"),
      another("challenge-004", "003"),
    ]);

    assert.deepEqual(issues, [NUMBER_MESSAGE(FIRST_NUMBER, "challenge-001, challenge-002"), NUMBER_MESSAGE("003", "challenge-003, challenge-004")]);
  });

  test("different numbers are accepted, including numbers that look alike: they are compared exactly as written", () => {
    assert.deepEqual(findDefinitionIssues([FIRST(), another("challenge-002", "002")]), []);
    assert.deepEqual(findDefinitionIssues([another("challenge-001", "001"), another("challenge-002", "1")]), []);
    assert.doesNotThrow(() => createChallengeRegistry([FIRST(), another("challenge-002", "002")]));
  });

  test("numbers are compared exactly as written: surrounding whitespace makes a number different", () => {
    assert.deepEqual(findDefinitionIssues([FIRST(), another("challenge-002", ` ${FIRST_NUMBER}`)]), []);
  });

  test("a definition with the same id and the same number is reported as both", () => {
    const issues = findDefinitionIssues([FIRST(), FIRST()]);

    assert.ok(issues.includes('challenge id "challenge-001" is defined more than once'), issues.join("\n"));
    assert.ok(issues.includes(NUMBER_MESSAGE(FIRST_NUMBER, "challenge-001, challenge-001")), issues.join("\n"));
  });

  test("a challenge with no usable id is named by its position", () => {
    const issues = findDefinitionIssues([FIRST(), another("Not A Valid Id", FIRST_NUMBER)]);

    assert.ok(issues.includes(NUMBER_MESSAGE(FIRST_NUMBER, "challenge-001, definition #2")), issues.join("\n"));
  });

  test("a missing, blank or non-string number is that definition's own field error, never a duplicate", () => {
    for (const bad of [undefined, "", "   ", 7, null]) {
      const issues = findDefinitionIssues([FIRST(), another("challenge-002", bad as never)]);
      assert.ok(!issues.some((issue) => issue.includes("is used by more than one challenge")), `${String(bad)}: ${issues.join("\n")}`);
      assert.ok(issues.some((issue) => issue.startsWith("challenge-002: scenario.challenge.number")), `${String(bad)}: ${issues.join("\n")}`);
    }
  });

  test("two blank numbers do not count as the same number", () => {
    const issues = findDefinitionIssues([another("challenge-001", "  "), another("challenge-002", "  ")]);

    assert.ok(!issues.some((issue) => issue.includes("is used by more than one challenge")), issues.join("\n"));
  });

  test("a definition that cannot even be read does not take part, and does not hide the others' duplicates", () => {
    const unreadable = Object.defineProperty(definitionOf(), "scenario", { get: () => ({}), enumerable: true });
    const issues = findDefinitionIssues([FIRST(), another("challenge-002", FIRST_NUMBER), unreadable]);

    assert.ok(issues.includes(NUMBER_MESSAGE(FIRST_NUMBER, "challenge-001, challenge-002")), issues.join("\n"));
  });

  test("a registry of one challenge, and the default registry's challenge, are unaffected", () => {
    assert.doesNotThrow(() => createChallengeRegistry([FIRST()]));
  });
});

describe("log lines and requests may be in any chronological order", () => {
  test("a log written entirely backwards is accepted and published in the order given", () => {
    const reversed = (d: Draft) => d.scenario.logs.reverse();
    accepted(reversed);

    const registry = createChallengeRegistry([draftOf(reversed)]);
    const expected = draftOf().scenario.logs.map((entry) => entry.id).reverse();

    assert.deepEqual(registry.getPublic("challenge-001")!.logs.map((entry) => entry.id), expected);
    assert.notEqual(
      createChallengeRegistry([draftOf()]).contentVersion("challenge-001"),
      registry.contentVersion("challenge-001"),
      "the order is part of the public content, so it is part of the version",
    );
  });

  test("the network list may be reversed too, with every request still matching its log line", () => {
    accepted((d) => d.scenario.network.reverse());
  });
});

describe("request URL and path: any non-blank text, with no absolute URL required", () => {
  // They may be simulated debugging evidence, so no format is required (approved).
  const urls = ["/api/profile", "profile", "//cdn.example.test/app.js", "orders.acme.example/x", "http://localhost:3000/a", "ftp://example.test/f", "mailto:someone@example.test", "javascript:void(0)", "not a url at all", "https://exa mple.test/a b"];
  const paths = ["/api/profile", "api/profile", "profile", "?q=1", "#fragment", "not a path", "/a b/c d", "../up"];

  for (const url of urls) {
    test(`url ${JSON.stringify(url)} is accepted`, () => {
      accepted((d) => (d.scenario.network[0].url = url));
    });
  }
  for (const path of paths) {
    test(`path ${JSON.stringify(path)} is accepted`, () => {
      accepted((d) => (d.scenario.network[0].path = path));
    });
  }

  test("only blank text is refused, as a missing value", () => {
    for (const blank of ["", "   ", "\t"]) {
      const issues = findDefinitionIssues([draftOf((d) => ((d.scenario.network[0].url = blank), (d.scenario.network[0].path = blank)))]);
      assert.deepEqual(issues, [
        "challenge-001: scenario.network[0].url must be a non-blank string",
        "challenge-001: scenario.network[0].path must be a non-blank string",
      ]);
    }
  });

  test("an odd url or path is published exactly as written", () => {
    const registry = createChallengeRegistry([
      draftOf((d) => {
        d.scenario.network[0].url = "not a url at all";
        d.scenario.network[0].path = "?q=1";
      }),
    ]);
    const request = registry.getPublic("challenge-001")!.network[0];

    assert.equal(request.url, "not a url at all");
    assert.equal(request.path, "?q=1");
  });
});

describe("unexpected properties are ignored, and reach neither the public view nor the evaluation", () => {
  const LEAK = "LEAK-MARKER-9f3a";
  const polluted = () =>
    draftOf((d) => {
      for (const target of [
        d,
        d.scenario,
        d.scenario.challenge,
        d.scenario.files[0],
        d.scenario.logs[0],
        d.scenario.network[0],
        d.scenario.network[0].requestHeaders[0],
        d.scenario.rootCauseOptions[0],
        d.evaluation,
        d.evaluation.keyObservations[0],
        d.evaluation.keyObservations[0].refs[0],
      ]) {
        loose(target).extraString = LEAK;
        loose(target).extraObject = { nested: LEAK };
        loose(target).isCorrect = true;
      }
    });

  test("the definition is accepted", () => {
    assert.deepEqual(findDefinitionIssues([polluted()]), []);
  });

  test("the public view and the content version are identical to the clean definition's", () => {
    const base = createChallengeRegistry([draftOf()]);
    const registry = createChallengeRegistry([polluted()]);

    assert.equal(JSON.stringify(registry.getPublic("challenge-001")), JSON.stringify(base.getPublic("challenge-001")));
    assert.equal(registry.contentVersion("challenge-001"), base.contentVersion("challenge-001"));
    assert.ok(!JSON.stringify(registry.getPublic("challenge-001")).includes(LEAK));
    assert.ok(!JSON.stringify(registry.list()).includes(LEAK));
  });

  test("the diagnosis data, the answer key and the validation context are identical to the clean definition's", () => {
    const base = createChallengeRegistry([draftOf()]).getDiagnosis("challenge-001")!;
    const got = createChallengeRegistry([polluted()]).getDiagnosis("challenge-001")!;

    assert.deepEqual(toPlain(got), toPlain(base));
    assert.ok(!JSON.stringify(toPlain(got)).includes(LEAK));
    assert.deepEqual(Object.keys(got).sort(), ["answerKey", "challengeId", "validation"]);
    assert.deepEqual(Object.keys(got.answerKey).sort(), ["correctRootCauseId", "keyObservations", "resolutionSummary"]);
    assert.deepEqual(Object.keys(got.validation).sort(), ["logIds", "requestIds", "rootCauseIds"]);
    for (const observation of got.answerKey.keyObservations) assert.deepEqual(Object.keys(observation).sort(), ["evidenceIds", "id"]);
  });

  test("an extra property cannot change grading: an `isCorrect` flag on a wrong option does not make it right", () => {
    const d = draftOf();
    const wrong = d.scenario.rootCauseOptions.find((o) => o.id !== d.evaluation.correctRootCauseId)!;
    const registry = createChallengeRegistry([polluted()]);
    const key = registry.getDiagnosis("challenge-001")!.answerKey;
    const submit = (rootCauseId: string): DiagnosisSubmission => ({ rootCauseId, explanation: "x".repeat(60), evidence: [{ kind: "log", logId: "log-06" }] });

    assert.equal(evaluateDiagnosis(submit(wrong.id), key).status, "incorrect");
    assert.equal(evaluateDiagnosis(submit(d.evaluation.correctRootCauseId), key).status, "correct");
    assert.equal(key.correctRootCauseId, d.evaluation.correctRootCauseId);
  });

  test("an unexpected property is never an error message either: it is not even named", () => {
    const issues = findDefinitionIssues([polluted(), another("challenge-002", FIRST_NUMBER)]);

    assert.ok(!issues.join("\n").includes(LEAK));
    assert.ok(!issues.join("\n").includes("extraString"));
  });
});

describe("Windows-reserved file names are allowed for virtual files", () => {
  for (const name of ["CON", "NUL", "PRN", "AUX", "COM1", "LPT9", "con.txt", "Nul.md", "aux.js", "src/COM2.ts", "PRN/readme.md", "dir/NUL"]) {
    test(`${name} is accepted`, () => {
      accepted((d) => (d.scenario.files[freeFile(d)].path = name));
    });
  }

  test("they are published exactly as written", () => {
    const registry = createChallengeRegistry([
      draftOf((d) => {
        d.scenario.files[freeFile(d)].path = "CON";
      }),
    ]);

    assert.ok(registry.getPublic("challenge-001")!.files.some((file) => file.path === "CON"));
  });
});
