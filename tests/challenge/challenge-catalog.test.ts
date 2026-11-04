import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { REGISTERED_CHALLENGES } from "@/data/catalog";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import {
  getPublicScenario,
  listChallengeSummaries,
  sortChallengeSummaries,
} from "@/lib/challenge-catalog";
import type { ChallengeSummary } from "@/types/workspace";

/**
 * Source without block comments and whole-line `//` comments, which may name
 * what the module must not import. A trailing `//` comment is kept, so the
 * guards can only err towards flagging too much, never too little.
 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every module specifier in code: static, side-effect, re-export, dynamic and require. */
function moduleSpecifiers(code: string): string[] {
  const pattern = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']/g;
  return [...code.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? match[3]);
}

const FORBIDDEN_CODE = /answer-key|\.server\b|@\/server\/|server-only|fetch\(/;

const source = codeOnly(readFileSync(new URL("../../src/lib/challenge-catalog.ts", import.meta.url), "utf8"));

/** A test-only summary; never part of the catalog. */
const summary = (id: string, number: string): ChallengeSummary => ({ ...challenge001.challenge, id, number });

describe("challenge catalog: lookup", () => {
  test("returns Challenge 001's public scenario by its ID", () => {
    assert.equal(getPublicScenario("challenge-001"), challenge001);
  });

  test("returns null for unknown IDs, with exact matching only", () => {
    for (const id of [
      "challenge-999",
      "",
      "001",
      "CHALLENGE-001",
      " challenge-001",
      "challenge-001 ",
      "challenge-001/",
      "challenges/challenge-001",
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      assert.equal(getPublicScenario(id), null, JSON.stringify(id));
    }
  });
});

describe("challenge catalog: listing", () => {
  test("lists every registered challenge, Challenge 001 first", () => {
    assert.deepEqual(listChallengeSummaries(), REGISTERED_CHALLENGES.map((entry) => entry.scenario.challenge));
    assert.deepEqual(listChallengeSummaries()[0], challenge001.challenge);
  });

  test("every listed summary is the summary of the scenario with that ID", () => {
    const summaries = listChallengeSummaries();
    assert.equal(new Set(summaries.map((item) => item.id)).size, summaries.length, "unique IDs");
    for (const item of summaries) assert.deepEqual(item, getPublicScenario(item.id)?.challenge, item.id);
  });

  test("returns independent summary objects that callers cannot use to change the catalog", () => {
    const original = structuredClone(challenge001.challenge);
    const [first] = listChallengeSummaries();
    assert.notEqual(first, challenge001.challenge, "not the scenario's own object");
    assert.notEqual(first.tags, challenge001.challenge.tags, "not the scenario's own tags array");

    first.title = "Changed by a caller";
    first.tags.push("Changed");
    first.tags[0] = "Changed";
    first.estimatedMinutes = 0;

    const [second] = listChallengeSummaries();
    assert.notEqual(second, first, "a new object each call");
    assert.deepEqual(second, original, "a later call is unaffected");
    assert.deepEqual(challenge001.challenge, original, "the scenario is unaffected");
    assert.deepEqual(getPublicScenario("challenge-001")?.challenge, original, "lookups are unaffected");
  });

  test("is deterministic, and callers cannot change it", () => {
    const first = listChallengeSummaries();
    first.reverse();
    first.push(summary("challenge-x", "999"));
    first.length = 0;
    assert.deepEqual(listChallengeSummaries(), REGISTERED_CHALLENGES.map((entry) => entry.scenario.challenge));
    assert.notEqual(listChallengeSummaries(), listChallengeSummaries(), "a new array each call");
  });

  test("orders by challenge number numerically, then by ID, whatever the input order", () => {
    const items = [summary("c", "10"), summary("b", "002"), summary("z", "2"), summary("a", "2"), summary("d", "001")];
    const expected = ["d", "a", "b", "z", "c"];
    assert.deepEqual(sortChallengeSummaries(items).map((item) => item.id), expected);
    assert.deepEqual(sortChallengeSummaries([...items].reverse()).map((item) => item.id), expected);
    assert.deepEqual(items.map((item) => item.id), ["c", "b", "z", "a", "d"], "input is not reordered");
  });
});

describe("challenge catalog: public data only", () => {
  test("no answer-key field or resolution text is reachable through the catalog", () => {
    const published = JSON.stringify([listChallengeSummaries(), getPublicScenario("challenge-001")]);
    for (const field of ["correctRootCauseId", "resolutionSummary", "keyObservations", "keyEvidence", "provisional"]) {
      assert.equal(published.includes(field), false, field);
    }
    assert.equal(published.includes(provisionalAnswerKey.resolutionSummary), false, "resolution summary");
  });

  test("scenarios have exactly the WorkspaceScenario fields", () => {
    const keys = Object.keys(getPublicScenario("challenge-001")!).sort();
    assert.deepEqual(keys, [
      "challenge",
      "contractVersion",
      "entryFilePath",
      "files",
      "incidentDate",
      "logs",
      "network",
      "rootCauseOptions",
    ]);
  });

  test("imports only the registration point, the catalog builder and types", () => {
    assert.deepEqual(moduleSpecifiers(source), ["@/data/catalog", "@/lib/catalog/catalog", "@/types/catalog", "@/types/workspace"]);
    assert.doesNotMatch(source, FORBIDDEN_CODE);
  });

  test("holds no learner or session state", () => {
    assert.doesNotMatch(source, /session|cookie|localStorage|status:/i);
  });
});

describe("challenge catalog: source guards", () => {
  test("ignore forbidden names that appear only in comments", () => {
    const code = codeOnly(
      [
        "/*",
        ' * Never import "@/data/challenge-001/answer-key.server" or "server-only" here.',
        " */",
        '// import { key } from "@/server/diagnosis/registry";',
        '  // fetch("/api/secret")',
        'import { challenge001 } from "@/data/challenge-001"; /* not answer-key */',
      ].join("\n"),
    );
    assert.deepEqual(moduleSpecifiers(code), ["@/data/challenge-001"]);
    assert.doesNotMatch(code, FORBIDDEN_CODE);
  });

  test("still detect every form of forbidden import in code", () => {
    const samples = [
      'import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";',
      'import "server-only";',
      "export { registry } from '@/server/diagnosis/registry';",
      'const key = await import("@/data/challenge-001/answer-key.server");',
      'const key = require("@/data/challenge-001/answer-key.server");',
      'import { x } from "@/data/challenge-001/answer-key.server"; // looks like a comment',
      'fetch("/api/challenges")',
    ];
    for (const sample of samples) {
      const code = codeOnly(sample);
      assert.match(code, FORBIDDEN_CODE, sample);
      if (!sample.startsWith("fetch")) assert.equal(moduleSpecifiers(code).length, 1, sample);
    }
  });

  test("a forbidden import between comments is still found", () => {
    const code = codeOnly(
      ["/* public only */", 'import { k } from "@/data/challenge-001/answer-key.server";', "// end"].join("\n"),
    );
    assert.deepEqual(moduleSpecifiers(code), ["@/data/challenge-001/answer-key.server"]);
  });
});
