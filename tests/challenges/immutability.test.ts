/*
 * The registry cannot be changed once built. Every case here is a way the audit showed the
 * first version could be changed (the registry's methods replaced, diagnosisRegistry emptied,
 * the answer key rewritten, a validation Set cleared), plus the ways around a naive fix
 * (Object.freeze does not stop Map.prototype.set or Set.prototype.add).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { challenge001Definition } from "@/server/challenges/challenge-001";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { ReadOnlyMap, ReadOnlySet } from "@/server/challenges/read-only";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { validateDiagnosisSubmission } from "@/lib/diagnosis/validate";
import { evaluateDiagnosis } from "@/server/diagnosis/evaluate";
import { CORRECT_ID, WRONG_IDS, submission } from "../diagnosis/fixtures";
import { draftOf } from "./helpers";

const ID = "challenge-001";
const fresh = () => createDefaultChallengeRegistry();

const loose = (value: unknown) => value as Record<string, unknown>;
/** The view, as a Map, the way code that wrongly believes it holds a mutable Map would use it. */
const asMap = (value: unknown) => value as Map<string, unknown>;
const asSet = (value: unknown) => value as Set<string>;

/** The grading the key gives: wrong answers incorrect, the right answer correct. */
function grade(registry: ReturnType<typeof fresh>, rootCauseId: string) {
  const diagnosis = registry.getDiagnosis(ID)!;
  const checked = validateDiagnosisSubmission(submission({ rootCauseId }), diagnosis.validation);
  assert.ok(checked.ok, "the submission should validate");
  return evaluateDiagnosis(checked.value, diagnosis.answerKey).status;
}

describe("the registry object cannot be changed", () => {
  const methods = ["list", "getPublic", "getDiagnosis", "contentVersion", "diagnosisRegistry"];

  test("it is frozen", () => {
    assert.ok(Object.isFrozen(fresh()));
  });

  test("no method can be replaced, so a patched getDiagnosis cannot hand out a forged key", () => {
    const registry = fresh();
    for (const name of methods) {
      assert.throws(() => (loose(registry)[name] = () => "patched"), TypeError, name);
    }
    assert.equal(registry.contentVersion("challenge-999"), undefined);
    assert.equal(grade(registry, WRONG_IDS[0]), "incorrect");
  });

  test("no method can be removed, and nothing can be added", () => {
    const registry = fresh();
    for (const name of methods) assert.throws(() => delete loose(registry)[name], TypeError, name);
    assert.throws(() => (loose(registry).backdoor = () => 1), TypeError);
    assert.throws(() => Object.defineProperty(registry, "list", { value: () => [] }), TypeError);
    assert.throws(() => Object.setPrototypeOf(registry, null), TypeError);
    assert.deepEqual(Object.keys(registry).sort(), [...methods].sort());
  });
});

describe("diagnosisRegistry cannot be changed", () => {
  test("it is not a Map and has no mutating methods at all", () => {
    const view = fresh().diagnosisRegistry;

    assert.ok(!(view instanceof Map));
    for (const name of ["set", "delete", "clear"]) {
      assert.equal(typeof loose(view)[name], "undefined", name);
    }
    assert.throws(() => asMap(view).set("challenge-002", {}), TypeError);
    assert.throws(() => asMap(view).delete(ID), TypeError);
    assert.throws(() => asMap(view).clear(), TypeError);
  });

  test("calling Map's own methods on it fails, because it holds no map data to write to", () => {
    const registry = fresh();
    const view = asMap(registry.diagnosisRegistry);

    assert.throws(() => Map.prototype.set.call(view, "challenge-002", {}), TypeError);
    assert.throws(() => Map.prototype.delete.call(view, ID), TypeError);
    assert.throws(() => Map.prototype.clear.call(view), TypeError);
    assert.equal(registry.diagnosisRegistry.size, 1);
    assert.equal(registry.diagnosisRegistry.has(ID), true);
    assert.equal(grade(registry, CORRECT_ID), "correct");
  });

  test("its methods cannot be replaced, on the instance or on the prototype", () => {
    const view = fresh().diagnosisRegistry;
    const prototype = Object.getPrototypeOf(view);

    assert.throws(() => (loose(view).get = () => undefined), TypeError);
    assert.throws(() => (prototype.get = () => undefined), TypeError);
    assert.throws(() => (prototype.has = () => false), TypeError);
    assert.throws(() => Object.defineProperty(prototype, "size", { value: 0 }), TypeError);
    assert.throws(() => Object.defineProperty(view, "size", { value: 0 }), TypeError);
    assert.throws(() => Object.setPrototypeOf(view, Map.prototype), TypeError);
    assert.ok(Object.isFrozen(view) && Object.isFrozen(prototype) && Object.isFrozen(view.constructor));
    assert.equal(view.has(ID), true);
  });

  test("the data behind it cannot be reached: it has no own properties", () => {
    const view = fresh().diagnosisRegistry;
    assert.deepEqual(Reflect.ownKeys(view), []);
    assert.equal(JSON.stringify(view), "{}");
  });

  test("forEach gives callbacks the read-only view, never the collection behind it", () => {
    const view = fresh().diagnosisRegistry;
    let seen: unknown;
    view.forEach((_value, _key, map) => {
      seen = map;
    });

    assert.equal(seen, view);
    assert.ok(!(seen instanceof Map));
    assert.throws(() => asMap(seen).set("x", {}), TypeError);
  });

  test("the iterators it returns cannot change it", () => {
    const registry = fresh();
    const entries = [...registry.diagnosisRegistry.entries()];
    entries.length = 0;
    entries.push(["challenge-002", {} as never]);
    for (const challenge of registry.diagnosisRegistry.values()) assert.ok(Object.isFrozen(challenge));
    assert.equal(registry.diagnosisRegistry.size, 1);
  });

  test("getDiagnosis and diagnosisRegistry hand out the very same frozen object", () => {
    const registry = fresh();
    assert.equal(registry.getDiagnosis(ID), registry.diagnosisRegistry.get(ID));
    assert.ok(Object.isFrozen(registry.getDiagnosis(ID)));
  });
});

describe("the answer key and the validation data cannot be changed", () => {
  const diagnosis = () => fresh().getDiagnosis(ID)!;

  test("every object holding them is frozen", () => {
    const challenge = diagnosis();
    assert.ok(Object.isFrozen(challenge));
    assert.ok(Object.isFrozen(challenge.validation));
    assert.ok(Object.isFrozen(challenge.answerKey));
    assert.ok(Object.isFrozen(challenge.answerKey.keyObservations));
    for (const observation of challenge.answerKey.keyObservations) assert.ok(Object.isFrozen(observation));
  });

  test("rewriting the correct answer fails, and wrong answers keep being graded wrong", () => {
    const registry = fresh();
    const { answerKey } = registry.getDiagnosis(ID)!;

    assert.throws(() => (loose(answerKey).correctRootCauseId = WRONG_IDS[0]), TypeError);
    assert.throws(() => (loose(answerKey).resolutionSummary = "forged"), TypeError);
    assert.throws(() => (loose(answerKey).keyObservations = []), TypeError);
    assert.equal(grade(registry, WRONG_IDS[0]), "incorrect");
    assert.equal(grade(registry, CORRECT_ID), "correct");
    assert.equal(registry.getDiagnosis(ID)!.answerKey.correctRootCauseId, CORRECT_ID);
  });

  test("the key observations cannot be edited, emptied or replaced", () => {
    const { answerKey } = diagnosis();
    const observations = answerKey.keyObservations as unknown as { id: string; evidenceIds: unknown }[];

    assert.throws(() => observations.push({ id: "forged", evidenceIds: new Set() }), TypeError);
    assert.throws(() => observations.pop(), TypeError);
    assert.throws(() => observations.splice(0, 1), TypeError);
    assert.throws(() => (observations.length = 0), TypeError);
    assert.throws(() => (observations[0].id = "forged"), TypeError);
    assert.throws(() => (observations[0].evidenceIds = new Set()), TypeError);
    assert.equal(answerKey.keyObservations.length, 4);
  });

  test("the validation sets are read-only: no add, delete or clear, and Set's own methods fail on them", () => {
    const { validation } = diagnosis();
    for (const set of [validation.rootCauseIds, validation.logIds, validation.requestIds]) {
      assert.ok(!(set instanceof Set));
      for (const name of ["add", "delete", "clear"]) assert.equal(typeof loose(set)[name], "undefined", name);
      assert.throws(() => asSet(set).add("forged"), TypeError);
      assert.throws(() => asSet(set).clear(), TypeError);
      assert.throws(() => Set.prototype.add.call(set, "forged"), TypeError);
      assert.throws(() => Set.prototype.delete.call(set, [...set][0]), TypeError);
      assert.throws(() => Set.prototype.clear.call(set), TypeError);
      assert.ok(set.size > 0);
    }
    assert.equal(validation.rootCauseIds.size, 5);
  });

  test("clearing the root-cause ids, to make every submission invalid, is not possible", () => {
    const registry = fresh();
    const { validation } = registry.getDiagnosis(ID)!;

    assert.throws(() => Set.prototype.clear.call(validation.rootCauseIds), TypeError);
    assert.throws(() => (loose(validation).rootCauseIds = new Set()), TypeError);
    assert.equal(grade(registry, WRONG_IDS[0]), "incorrect", "submissions still validate");
  });

  test("each observation's evidence ids are read-only too", () => {
    const [observation] = diagnosis().answerKey.keyObservations;
    assert.throws(() => Set.prototype.clear.call(observation.evidenceIds), TypeError);
    assert.throws(() => asSet(observation.evidenceIds).add("network:req-14"), TypeError);
    assert.ok(observation.evidenceIds.size > 0);
  });

  test("the sets behind the views are not reachable from any of them", () => {
    const { validation, answerKey } = diagnosis();
    const sets = [validation.rootCauseIds, validation.logIds, validation.requestIds, ...answerKey.keyObservations.map((o) => o.evidenceIds)];
    for (const set of sets) {
      assert.deepEqual(Reflect.ownKeys(set), []);
      assert.ok(Object.isFrozen(set));
    }
  });

  test("two registries share nothing: damage attempts on one cannot touch the other", () => {
    const a = fresh();
    const b = fresh();
    assert.notEqual(a.getDiagnosis(ID), b.getDiagnosis(ID));
    assert.notEqual(a.getDiagnosis(ID)!.validation.logIds, b.getDiagnosis(ID)!.validation.logIds);
  });
});

describe("a registry is a copy of its definitions", () => {
  test("editing the definition after the registry is built changes nothing in it", () => {
    const definition = draftOf();
    const registry = createChallengeRegistry([definition]);

    definition.evaluation.correctRootCauseId = WRONG_IDS[0];
    definition.evaluation.keyObservations[0].refs.length = 0;
    definition.evaluation.keyObservations.length = 0;
    definition.scenario.rootCauseOptions.length = 0;
    definition.scenario.logs.length = 0;

    assert.equal(registry.getDiagnosis(ID)!.answerKey.correctRootCauseId, CORRECT_ID);
    assert.equal(registry.getDiagnosis(ID)!.answerKey.keyObservations.length, 4);
    assert.ok(registry.getDiagnosis(ID)!.answerKey.keyObservations[0].evidenceIds.size > 0);
    assert.equal(registry.getDiagnosis(ID)!.validation.rootCauseIds.size, 5);
    assert.equal(registry.getPublic(ID)!.logs.length, 23);
    assert.equal(grade(registry, CORRECT_ID), "correct");
  });

  test("the source module's data is read, never handed on: building a registry does not freeze or alter it", () => {
    const before = JSON.stringify(challenge001Definition);
    createDefaultChallengeRegistry();
    assert.equal(JSON.stringify(challenge001Definition), before);
    assert.ok(!Object.isFrozen(challenge001Definition.scenario), "the shared public data is left as it was");
  });
});

describe("ReadOnlyMap and ReadOnlySet behave like Map and Set for their consumers", () => {
  const pairs: [string, number][] = [
    ["b", 2],
    ["a", 1],
    ["c", 3],
  ];

  test("ReadOnlyMap answers every read operation as a Map does, in the same order", () => {
    const real = new Map(pairs);
    const view = new ReadOnlyMap(pairs);

    assert.equal(view.size, real.size);
    assert.equal(view.has("a"), true);
    assert.equal(view.has("z"), false);
    assert.equal(view.get("c"), 3);
    assert.equal(view.get("z"), undefined);
    assert.deepEqual([...view], [...real]);
    assert.deepEqual([...view.keys()], [...real.keys()]);
    assert.deepEqual([...view.values()], [...real.values()]);
    assert.deepEqual([...view.entries()], [...real.entries()]);
    assert.deepEqual(Array.from(view), Array.from(real));
    assert.deepEqual([...new Map(view)], [...real]);
    assert.equal(Object.prototype.toString.call(view), "[object ReadOnlyMap]");
  });

  test("ReadOnlyMap.forEach passes value, key and the view, and honours thisArg", () => {
    const view = new ReadOnlyMap(pairs);
    const calls: unknown[][] = [];
    const context = { tag: "ctx" };
    view.forEach(function (this: unknown, value, key, map) {
      calls.push([value, key, map === view, this === context]);
    }, context);
    assert.deepEqual(calls, [
      [2, "b", true, true],
      [1, "a", true, true],
      [3, "c", true, true],
    ]);
  });

  test("ReadOnlySet answers every read operation as a Set does, in the same order", () => {
    const real = new Set(["b", "a", "c"]);
    const view = new ReadOnlySet(["b", "a", "c"]);

    assert.equal(view.size, 3);
    assert.equal(view.has("a"), true);
    assert.equal(view.has("z"), false);
    assert.deepEqual([...view], [...real]);
    assert.deepEqual([...view.values()], [...real.values()]);
    assert.deepEqual([...view.keys()], [...real.keys()]);
    assert.deepEqual([...view.entries()], [...real.entries()]);
    assert.deepEqual([...new Set(view)], [...real]);
    assert.ok([...view].some((value) => value === "c"), "the spread the evaluator relies on works");
    assert.equal(Object.prototype.toString.call(view), "[object ReadOnlySet]");
  });

  test("ReadOnlySet.forEach passes the value twice and the view, and honours thisArg", () => {
    const view = new ReadOnlySet(["x", "y"]);
    const seen: unknown[][] = [];
    const context = {};
    view.forEach(function (this: unknown, value, again, set) {
      seen.push([value, again, set === view, this === context]);
    }, context);
    assert.deepEqual(seen, [
      ["x", "x", true, true],
      ["y", "y", true, true],
    ]);
  });

  test("the set algebra methods work and return new Sets that the caller may change", () => {
    const view = new ReadOnlySet(["a", "b", "c"]);
    const other = new ReadOnlySet(["b", "c", "d"]);

    assert.deepEqual([...view.union(other)].sort(), ["a", "b", "c", "d"]);
    assert.deepEqual([...view.intersection(other)].sort(), ["b", "c"]);
    assert.deepEqual([...view.difference(other)], ["a"]);
    assert.deepEqual([...view.symmetricDifference(other)].sort(), ["a", "d"]);
    assert.equal(view.isSubsetOf(new Set(["a", "b", "c", "z"])), true);
    assert.equal(view.isSupersetOf(new ReadOnlySet(["a"])), true);
    assert.equal(view.isDisjointFrom(new Set(["q"])), true);

    const result = view.union(other);
    result.add("mutated");
    result.clear();
    assert.equal(view.size, 3, "changing a result never changes the view");
  });

  test("both copy their input: later changes to the source do not show through", () => {
    const sourceMap = new Map(pairs);
    const sourceSet = new Set(["a", "b"]);
    const map = new ReadOnlyMap(sourceMap);
    const set = new ReadOnlySet(sourceSet);

    sourceMap.set("z", 26);
    sourceMap.delete("a");
    sourceSet.add("z");
    sourceSet.clear();

    assert.equal(map.size, 3);
    assert.equal(map.get("a"), 1);
    assert.equal(map.has("z"), false);
    assert.equal(set.size, 2);
    assert.equal(set.has("a"), true);
  });

  test("both accept any iterable, including a generator", () => {
    function* numbers() {
      yield 1;
      yield 2;
    }
    assert.deepEqual([...new ReadOnlySet(numbers())], [1, 2]);
    assert.deepEqual([...new ReadOnlyMap([["k", 1] as const].values())], [["k", 1]]);
  });

  test("neither is a Map or a Set, and neither can be changed", () => {
    const map = new ReadOnlyMap(pairs);
    const set = new ReadOnlySet(["a"]);

    assert.ok(!(map instanceof Map) && !(set instanceof Set));
    assert.ok(Object.isFrozen(map) && Object.isFrozen(set));
    assert.ok(Object.isFrozen(ReadOnlyMap) && Object.isFrozen(ReadOnlySet));
    assert.ok(Object.isFrozen(ReadOnlyMap.prototype) && Object.isFrozen(ReadOnlySet.prototype));
    assert.throws(() => Map.prototype.set.call(map, "z", 1), TypeError);
    assert.throws(() => Set.prototype.add.call(set, "z"), TypeError);
  });
});

describe("existing consumers work with the protected registry exactly as before", () => {
  test("the existing validator accepts and rejects the same submissions", () => {
    const { validation } = fresh().getDiagnosis(ID)!;

    assert.ok(validateDiagnosisSubmission(submission(), validation).ok);
    assert.ok(!validateDiagnosisSubmission(submission({ rootCauseId: "not-an-option" }), validation).ok);
    assert.ok(!validateDiagnosisSubmission(submission({ evidence: [{ kind: "log", logId: "log-99" }] }), validation).ok);
  });

  test("the existing evaluator counts key observations through the read-only sets", () => {
    const registry = fresh();
    const { answerKey, validation } = registry.getDiagnosis(ID)!;
    const input = submission({
      rootCauseId: CORRECT_ID,
      evidence: [
        { kind: "network", requestId: "req-01" },
        { kind: "log", logId: "log-06" },
      ],
    });
    const checked = validateDiagnosisSubmission(input, validation);
    assert.ok(checked.ok);

    const result = evaluateDiagnosis(checked.value, answerKey);

    assert.equal(result.status, "correct");
    assert.match(result.feedback.hints[0], /covered 2 of 4 key observations/);
  });
});
