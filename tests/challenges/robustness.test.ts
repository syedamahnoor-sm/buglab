/*
 * Regression tests for the remediation pass: malformed definitions are always a
 * ChallengeDefinitionError (headers, values that are not plain data, values that break message
 * building), the public view shares nothing with its source, messages are bounded and carry no
 * raw authored text, and the read-only views document their limits.
 */
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { describe, test } from "node:test";
import { ChallengeDefinitionError } from "@/server/challenges/definition";
import { loadChallengeRegistry, staticChallengeSource, type ChallengeSource } from "@/server/challenges/loader";
import { clonePlainData, findDataIssues } from "@/server/challenges/plain-data";
import { toPublicChallenge } from "@/server/challenges/public-view";
import { ReadOnlyMap, ReadOnlySet } from "@/server/challenges/read-only";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { reasonOf, safe, shown } from "@/server/challenges/text";
import { findDefinitionIssues } from "@/server/challenges/validate";
import { draftOf, definitionOf, type Draft } from "./helpers";

type Loose = { [key: string]: unknown };
const loose = (value: unknown) => value as Loose;
const mentions = (issues: readonly string[], text: string) => issues.some((issue) => issue.includes(text));

/** Registers a definition and returns what came out: the error it must be, or undefined if it was accepted. */
function refusal(definition: unknown): ChallengeDefinitionError | undefined {
  try {
    createChallengeRegistry([definition as never]);
    return undefined;
  } catch (error) {
    assert.ok(!(error instanceof TypeError), `a raw TypeError escaped: ${String(error)}`);
    assert.ok(error instanceof ChallengeDefinitionError, `not a ChallengeDefinitionError: ${String(error)}`);
    return error;
  }
}

describe("header entries are validated, so the public view never meets a malformed one", () => {
  const bad: [string, unknown, string][] = [
    ["null", null, "[0] must be an object"],
    ["a string", "Host: x", "[0] must be an object"],
    ["a list", ["Host", "x"], "[0] must be an object"],
    ["a number", 7, "[0] must be an object"],
    ["an entry without a name", { value: "x" }, "[0].name must be a string"],
    ["an entry without a value", { name: "Host" }, "[0].value must be a string"],
    ["an entry with a numeric name", { name: 5, value: "x" }, "[0].name must be a string"],
  ];

  for (const key of ["requestHeaders", "responseHeaders"]) {
    for (const [label, entry, expected] of bad) {
      test(`${key}: ${label} is a definition error that names the entry`, () => {
        const definition = definitionOf((draft) => {
          loose(draft.scenario.network[0])[key] = [entry];
        });
        const error = refusal(definition);
        assert.ok(error, "must be refused");
        assert.ok(mentions(error.issues, `scenario.network[0].${key}${expected}`), error.issues.join("\n"));
      });
    }
  }

  test("a good header list is still accepted, with extra fields on an entry simply not published", () => {
    const definition = definitionOf((draft) => {
      loose(draft.scenario.network[0].requestHeaders[0]).secret = "never published";
    });
    const registry = createChallengeRegistry([definition]);
    assert.ok(!JSON.stringify(registry.getPublic("challenge-001")).includes("never published"));
  });
});

describe("values that are not plain data are definition errors, never raw TypeErrors", () => {
  const cyclic = (() => {
    const loop: Loose = {};
    loop.self = loop;
    return loop;
  })();
  const deep = (() => {
    let value: unknown = "x";
    for (let level = 0; level < 40; level += 1) value = { next: value };
    return value;
  })();

  const cases: [string, (draft: Draft) => void, string][] = [
    ["a BigInt (it cannot be serialized)", (d) => loose(d.scenario.network[0]).durationMs = BigInt(10), "scenario.network[0].durationMs must be plain data, not a bigint"],
    ["NaN", (d) => loose(d.scenario.network[0]).durationMs = Number.NaN, "scenario.network[0].durationMs must be a finite number"],
    ["Infinity", (d) => loose(d.scenario.challenge).estimatedMinutes = Infinity, "scenario.challenge.estimatedMinutes must be a finite number"],
    ["a function", (d) => loose(d.scenario.logs[0]).message = () => "x", "scenario.logs[0].message must be plain data, not a function"],
    ["a symbol", (d) => loose(d.scenario.logs[0]).message = Symbol("x"), "scenario.logs[0].message must be plain data, not a symbol"],
    ["a Date", (d) => loose(d.scenario.challenge).created = new Date(0), "scenario.challenge.created must be a plain object"],
    ["a Map", (d) => (d.scenario.challenge.tags as unknown[]).push(new Map()), "scenario.challenge.tags[3] must be a plain object"],
    ["a class instance", (d) => (d.scenario.challenge.tags as unknown[]).push(new (class Tag {})()), "scenario.challenge.tags[3] must be a plain object"],
    ["a cycle", (d) => loose(d.scenario.logs[0]).extra = cyclic, "scenario.logs[0].extra.self refers back to one of its own parents"],
    ["a getter", (d) => Object.defineProperty(d.scenario.logs[0], "message", { get: () => "x", enumerable: true }), "scenario.logs[0].message must be a plain value, not a getter or setter"],
    ["undefined inside a list", (d) => (d.scenario.challenge.tags as unknown[]).push(undefined), "scenario.challenge.tags[3] must not be undefined"],
    ["nesting deeper than any scenario", (d) => loose(d.scenario.logs[0]).extra = deep, "levels deep"],
  ];

  for (const [label, change, expected] of cases) {
    test(label, () => {
      const error = refusal(definitionOf((draft) => void change(draft)));
      assert.ok(error, "must be refused");
      assert.ok(mentions(error.issues, expected), `expected "${expected}" in:\n${error.issues.join("\n")}`);
    });
  }

  test("an optional field left undefined is plain data, as it is in Challenge 001", () => {
    const definition = definitionOf((draft) => {
      loose(draft.scenario.network[0]).requestBody = undefined;
    });
    assert.deepEqual(findDefinitionIssues([definition]), []);
  });

  test("a key such as __proto__ is data: it is snapshotted as an own property, pollutes nothing and is never published", () => {
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "n": 1}') as Loose;
    const definition = definitionOf((draft) => {
      loose(draft.scenario).extra = hostile; // not a public field, so the public view must drop it
    });
    const registry = createChallengeRegistry([definition]);
    assert.equal(({} as Loose).polluted, undefined, "nothing leaked onto Object.prototype");
    assert.ok(!JSON.stringify(registry.getPublic("challenge-001")).includes("polluted"), "the unknown field is not published");

    const snapshot = clonePlainData({ holder: hostile }, "source").holder as unknown as Loose;
    assert.equal(Object.getPrototypeOf(snapshot), Object.prototype, "the snapshot's prototype is untouched");
    assert.ok(Object.hasOwn(snapshot, "__proto__"), "the key is kept as an own property");
    assert.equal(snapshot.n, 1);
  });
});

describe("a definition that throws while it is read is still a definition error", () => {
  test("a proxy whose every trap throws is refused without being asked anything", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new TypeError("read refused");
        },
        ownKeys() {
          throw new TypeError("keys refused");
        },
      },
    );
    const definition = draftOf();
    (definition as unknown as Loose).scenario = hostile;
    const error = refusal(definition);
    assert.ok(error);
    assert.ok(mentions(error.issues, "definition.scenario must be plain data, not a proxy"), error.issues.join("\n"));
  });

  test("an evidence kind that is not plain data is refused at its own path; one with no prototype is plain data and is refused as a kind", () => {
    const cases: [string, unknown, string][] = [
      ["a throwing toString", { toString() { throw new Error("no"); } }, "refs[2].kind.toString must be plain data, not a function"],
      ["a symbol", Symbol("kind"), "refs[2].kind must be plain data, not a symbol"],
      ["a BigInt", BigInt(10), "refs[2].kind must be plain data, not a bigint"],
      ["no prototype", Object.create(null), 'refs[2].kind must be "log" or "network"'],
    ];
    for (const [label, kind, expected] of cases) {
      const definition = definitionOf((draft) => {
        (draft.evaluation.keyObservations[0].refs as unknown[]).push({ kind, requestId: "req-14" });
      });
      assert.doesNotThrow(() => findDefinitionIssues([definition]), label);
      const error = refusal(definition);
      assert.ok(error, label);
      assert.ok(mentions(error.issues, expected), `${label}: ${error.issues.join("\n")}`);
    }
  });

  test("junk of every kind, at the top level and nested, is only ever a definition error", () => {
    const junk: unknown[] = [null, undefined, 0, "x", true, [], {}, () => 0, Symbol("s"), BigInt(10), new Date(0), new Map(), NaN];
    for (const value of junk) {
      assert.doesNotThrow(() => findDefinitionIssues([value]));
      assert.ok(refusal(value), String(typeof value));
      for (const key of ["scenario", "evaluation", "revision"]) {
        if (key === "revision" && value === "x") continue; // "x" is a valid revision
        const definition = draftOf();
        (definition as unknown as Loose)[key] = value;
        assert.ok(refusal(definition), `${key} = ${typeof value}`);
      }
    }
  });

  test("Challenge 001 is still accepted, and builds", () => {
    assert.deepEqual(findDefinitionIssues([definitionOf()]), []);
    assert.doesNotThrow(() => createDefaultChallengeRegistry());
  });
});

describe("the public view shares nothing with its source", () => {
  test("no object in the view is an object of the source, and the source is not frozen by building it", () => {
    const nested = { a: { b: 1 } };
    const draft = draftOf((d) => {
      (d.scenario.challenge.tags as unknown[]).push(nested);
    });
    const view = toPublicChallenge(draft.scenario);

    const sourceObjects = new Set<unknown>();
    const collect = (value: unknown) => {
      if (typeof value !== "object" || value === null || sourceObjects.has(value)) return;
      sourceObjects.add(value);
      Object.values(value).forEach(collect);
    };
    collect(draft.scenario);
    const aliased: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value !== "object" || value === null) return;
      if (sourceObjects.has(value)) aliased.push(path);
      Object.entries(value).forEach(([key, item]) => walk(item, `${path}.${key}`));
    };
    walk(view, "view");
    assert.deepEqual(aliased, []);

    assert.ok(Object.isFrozen(view), "the view itself is frozen");
    assert.equal(Object.isFrozen(nested), false, "the author's object was not frozen");
    assert.equal(Object.isFrozen(nested.a), false);
    assert.equal(Object.isFrozen(draft.scenario), false);
    assert.equal(Object.isFrozen(draft.scenario.files[0]), false);
    assert.equal(Object.isFrozen(draft.scenario.network[0].requestHeaders[0]), false);
  });

  test("the author can still edit the source afterwards without reaching a registry that is already built", () => {
    const draft = draftOf();
    const registry = createChallengeRegistry([draft]);
    const before = JSON.stringify(registry.getPublic("challenge-001"));
    draft.scenario.network[0].requestHeaders[0].value = "changed after the fact";
    draft.scenario.challenge.tags.push("added-later");
    draft.scenario.files[0].content = "changed after the fact";
    assert.equal(JSON.stringify(registry.getPublic("challenge-001")), before);
  });

  test("the copy has the same content: it is JSON-equal to the source's public fields", () => {
    const registry = createDefaultChallengeRegistry();
    const view = registry.getPublic("challenge-001")!;
    const source = definitionOf().scenario;
    assert.deepEqual(JSON.parse(JSON.stringify(view)), JSON.parse(JSON.stringify(source)));
  });

  test("clonePlainData reads its source and never changes it", () => {
    const source = { list: [{ x: 1 }], text: "t" };
    const copy = clonePlainData(source, "source");
    assert.deepEqual(copy, source);
    assert.notEqual(copy, source);
    assert.notEqual(copy.list, source.list);
    assert.notEqual(copy.list[0], source.list[0]);
    assert.equal(Object.isFrozen(source), false);
    assert.throws(() => clonePlainData({ n: BigInt(1) }, "source"), ChallengeDefinitionError);
  });

  test("findDataIssues accepts Challenge 001's whole scenario, and caps what it reports", () => {
    assert.deepEqual(findDataIssues(definitionOf().scenario, "scenario"), []);
    const many = Array.from({ length: 500 }, () => BigInt(1));
    assert.ok(findDataIssues(many, "list").length <= 20);
  });
});

describe("error messages are one bounded line with no raw authored text", () => {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const oneLine = (issue: string) => !new RegExp(`[\n\r${LS}${PS}\u001b\u0085]`).test(issue);

  test("shown() and safe() are total: they never throw, whatever they are given", () => {
    const hostile: unknown[] = [
      { toString() { throw new Error("no"); } },
      Object.create(null),
      new Proxy({}, { get() { throw new Error("no"); }, getPrototypeOf() { throw new Error("no"); } }),
      Symbol("s"),
      BigInt(10),
      () => 0,
      null,
      undefined,
      NaN,
      [],
      "\ud800", // a lone surrogate
    ];
    for (const value of hostile) {
      assert.doesNotThrow(() => shown(value));
      assert.doesNotThrow(() => safe(value));
      assert.equal(typeof shown(value), "string");
    }
    assert.equal(shown("plain"), '"plain"');
    assert.equal(safe("plain"), "plain");
  });

  test("a newline, an escape code and the Unicode line separators are escaped, so a value cannot forge a log line", () => {
    for (const text of ["a\nb", "a\rb", "a\u001b[31mred", `a${LS}b`, `a${PS}b`, "a\u0085b", "a\u0000b"]) {
      assert.ok(oneLine(shown(text)), JSON.stringify(text));
      assert.ok(oneLine(safe(text)), JSON.stringify(text));
      assert.ok(!shown(text).includes(text.slice(1, 2)) || text.startsWith("a\u0000"), "the raw character is gone");
    }
    assert.equal(shown("a\nb"), String.raw`"a\nb"`);
  });

  test("a long value is cut to 60 characters", () => {
    assert.equal(shown("x".repeat(5000)).length, 60 + 3 + 2);
    assert.equal(safe("x".repeat(5000)).length, 60 + 3);
  });

  test("reasonOf() takes the message of anything that was thrown, bounded and on one line", () => {
    assert.equal(reasonOf(new Error("boom")), "boom");
    assert.equal(reasonOf("not an error"), "unknown error");
    assert.equal(reasonOf(null), "unknown error");
    assert.ok(reasonOf(new Error("x".repeat(5000))).length <= 203);
    assert.ok(oneLine(reasonOf(new Error("line one\nline two"))));
    const nasty = new Error("x");
    Object.defineProperty(nasty, "message", { get() { throw new Error("no"); } });
    assert.equal(reasonOf(nasty), "unknown error");
  });

  test("an id with a newline in it cannot forge a second line in any message", () => {
    const forged = "log-02\nERROR forged line";
    const definition = definitionOf((draft) => {
      draft.scenario.logs[1].id = forged;
      draft.scenario.logs.push({ ...draft.scenario.logs[1] });
    });
    const issues = findDefinitionIssues([definition]);
    assert.ok(mentions(issues, "is used more than once"), issues.join("\n"));
    for (const issue of issues) assert.ok(oneLine(issue), JSON.stringify(issue));
  });

  test("a 5,000-character value is cut in the message that repeats it", () => {
    const issues = findDefinitionIssues([
      definitionOf((draft) => {
        draft.scenario.entryFilePath = "x".repeat(5000);
      }),
    ]);
    const entry = issues.find((issue) => issue.includes("entry file"));
    assert.ok(entry && entry.length < 200, String(entry?.length));
  });

  test("every message that repeats a value stays one bounded line, however hostile the value", () => {
    const hostile = "\u001b[31m" + "A".repeat(500) + `\nNEXT${LS}LINE`;
    const definition = definitionOf((draft) => {
      draft.scenario.entryFilePath = hostile;
      draft.scenario.files.push({ ...draft.scenario.files[0], path: hostile }, { ...draft.scenario.files[0], path: hostile });
      draft.scenario.network[0].serverLogId = hostile;
      draft.scenario.network[1].initiator = hostile;
      draft.scenario.logs[0].id = hostile;
      draft.scenario.logs[1].id = hostile;
      draft.scenario.rootCauseOptions[1].id = draft.scenario.rootCauseOptions[0].id;
      draft.evaluation.keyObservations[0].id = hostile;
      draft.evaluation.keyObservations[1].id = hostile;
      draft.evaluation.keyObservations[0].refs.push({ kind: "log", logId: hostile });
      draft.revision = hostile;
      loose(draft.scenario.challenge).completion = hostile;
      loose(draft.scenario).contractVersion = hostile;
    });
    const issues = findDefinitionIssues([definition], [hostile]);
    assert.ok(issues.length > 5, issues.join("\n"));
    for (const issue of issues) {
      assert.ok(oneLine(issue), JSON.stringify(issue));
      assert.ok(issue.length < 400, `${issue.length}: ${issue.slice(0, 80)}`);
    }
  });

  test("one definition that is wrong in hundreds of ways reports a bounded number of problems", () => {
    const definition = definitionOf((draft) => {
      const paths = Array.from({ length: 1500 }, (_, index) => `f${index}.ts`);
      draft.scenario.files = [...paths, ...paths].map((path) => ({ path, content: "" }));
    });
    const issues = findDefinitionIssues([definition]);
    assert.ok(issues.length <= 21, String(issues.length));
    assert.ok(mentions(issues, "more problems"), issues.join("\n"));
  });

  test("many wrong definitions report a bounded number of problems in all", () => {
    const definitions = Array.from({ length: 300 }, (_, index) =>
      definitionOf((draft) => {
        loose(draft.scenario.challenge).id = `challenge-${index + 1}`;
        draft.scenario.entryFilePath = "missing.md";
      }),
    );
    const issues = findDefinitionIssues(definitions);
    assert.ok(issues.length <= 101, String(issues.length));
    assert.ok(mentions(issues, "more problems in other definitions"), issues.slice(-2).join("\n"));
  });

  test("a message may name a key-observation id, but never the correct root cause or the resolution text", () => {
    const answer = draftOf().evaluation;
    const definition = definitionOf((draft) => {
      draft.evaluation.correctRootCauseId = "zzz-not-an-option";
      draft.evaluation.keyObservations[0].refs = [];
      draft.scenario.entryFilePath = "missing.md";
    });
    const error = refusal(definition);
    assert.ok(error);
    const text = error.message;
    assert.ok(!text.includes("zzz-not-an-option"), "the (wrong) answer value is not echoed");
    assert.ok(!text.includes(answer.correctRootCauseId));
    assert.ok(!text.includes(answer.resolutionSummary));
    assert.ok(text.includes(answer.keyObservations[0].id), "the observation id an author needs is named");
  });
});

describe("a malformed source or source list is reported by name or position", () => {
  const good = (): ChallengeSource => staticChallengeSource("good", [definitionOf()]);

  test("a source with a hostile name is quoted safely", () => {
    const name = "evil\nsource " + "n".repeat(500);
    assert.throws(
      () => loadChallengeRegistry([{ name, load: () => ({}) as never }]),
      (error: unknown) =>
        error instanceof ChallengeDefinitionError && error.issues.length === 1 && !/[\n\r]/.test(error.issues[0]) && error.issues[0].length < 200,
    );
  });

  test("a source that throws something with a hostile message is wrapped, bounded, on one line", () => {
    const source = {
      name: "throws",
      load: () => {
        throw new Error("first\nSECOND LINE " + "m".repeat(1000));
      },
    };
    assert.throws(
      () => loadChallengeRegistry([source]),
      (error: unknown) =>
        error instanceof ChallengeDefinitionError && error.issues.length === 1 && !/[\n\r]/.test(error.issues[0]) && error.issues[0].length < 300,
    );
  });

  test("a source that is not an object, or has no name, is a definition error that names its position", () => {
    for (const bad of [null, undefined, 7, "x", {}, { load: () => ({}) }]) {
      assert.throws(
        () => loadChallengeRegistry([good(), bad as never]),
        (error: unknown) => {
          assert.ok(!(error instanceof TypeError), "must not be a raw TypeError");
          return error instanceof ChallengeDefinitionError && error.issues[0].includes("#2");
        },
        String(bad),
      );
    }
  });

  test("a source whose name throws when read is named by its position", () => {
    const source = {
      get name(): string {
        throw new TypeError("name refused");
      },
      load: () => ({}) as never,
    };
    assert.throws(
      () => loadChallengeRegistry([source]),
      (error: unknown) => error instanceof ChallengeDefinitionError && error.issues[0].includes('"#1"'),
    );
  });

  test("a source list that is not a list is a definition error", () => {
    for (const bad of [null, undefined, {}, "x", 7]) {
      assert.throws(() => loadChallengeRegistry(bad as never), ChallengeDefinitionError, String(bad));
    }
  });
});

describe("the read-only views: inspection works, and the equality and cloning limits are the documented ones", () => {
  test("util.inspect shows the contents, under the view's own name", () => {
    assert.equal(inspect(new ReadOnlyMap([["a", 1]])), "ReadOnlyMap(1) [Map] { 'a' => 1 }".replace(" [Map]", ""));
    assert.equal(inspect(new ReadOnlySet(["x", "y"])), "ReadOnlySet(2) { 'x', 'y' }");
    assert.equal(inspect(new ReadOnlyMap([])), "ReadOnlyMap(0) {}");
  });

  test("inspection honours the caller's options and hands out no collection", () => {
    const nested = new ReadOnlyMap([["a", { b: { c: { d: 1 } } }]]);
    assert.match(inspect(nested, { depth: 0 }), /\[Object\]/);
    assert.match(inspect(nested, { depth: 5 }), /d: 1/);
    const custom = (nested as unknown as Record<symbol, (...args: unknown[]) => unknown>)[Symbol.for("nodejs.util.inspect.custom")];
    assert.equal(typeof custom.call(nested, 2, {}, inspect), "string");
  });

  test("inspecting the registry's diagnosis map shows the challenge", () => {
    const map = createDefaultChallengeRegistry().diagnosisRegistry;
    assert.match(inspect(map), new RegExp(String.raw`^ReadOnlyMap\(${map.size}\) \{\s+'challenge-001' => `));
  });

  test("inspection does not weaken immutability: the inspector's output is a string, and the view is unchanged", () => {
    const view = new ReadOnlySet(["x"]);
    inspect(view);
    assert.deepEqual([...view], ["x"]);
    assert.throws(() => (view as unknown as { add(v: string): void }).add("y"), TypeError);
  });

  // These tests state the limits so a change in behaviour is noticed and the documentation updated with it.
  test("documented limit: deepStrictEqual cannot tell two views apart, so compare their contents", () => {
    const a = new ReadOnlySet(["x"]);
    const b = new ReadOnlySet(["completely", "different"]);
    assert.doesNotThrow(() => assert.deepStrictEqual(a, b));
    assert.notDeepEqual([...a], [...b]);
  });

  test("documented limit: structuredClone and JSON lose the contents, so convert first", () => {
    const view = new ReadOnlyMap([["a", 1]]);
    assert.deepEqual(Object.keys(structuredClone(view)), []);
    assert.equal(JSON.stringify(view), "{}");
    assert.deepEqual([...new Map(view)], [["a", 1]]);
    assert.deepEqual(structuredClone([...view]), [["a", 1]]);
  });
});
