import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import { challenge001Definition, challenge001Source } from "@/server/challenges/challenge-001";
import { ChallengeDefinitionError } from "@/server/challenges/definition";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { loadChallengeRegistry, staticChallengeSource } from "@/server/challenges/loader";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { canonicalJson } from "@/server/challenges/version";
import { assertContentVersion, definitionOf, onTheWire } from "./helpers";

const ID = "challenge-001";
const registry = createDefaultChallengeRegistry();

describe("Challenge 001 loads", () => {
  test("the default registry builds without error and lists the challenge", () => {
    assert.deepEqual(
      registry.list().map((summary) => summary.id),
      [ID],
    );
  });

  test("the loader builds the same registry from the Challenge 001 source", () => {
    const loaded = loadChallengeRegistry([challenge001Source]);
    assert.deepEqual(onTheWire(loaded.getPublic(ID)), onTheWire(registry.getPublic(ID)));
    assert.equal(loaded.contentVersion(ID), registry.contentVersion(ID));
  });

  test("the definition wraps the existing modules: it holds the very same scenario object", () => {
    assert.equal(challenge001Definition.scenario, challenge001);
  });
});

describe("every current id and public field is preserved", () => {
  const view = registry.getPublic(ID)!;

  test("the public view carries exactly the fields of WorkspaceScenario, with identical values", () => {
    assert.deepEqual(Object.keys(view).sort(), Object.keys(challenge001).sort());
    assert.deepEqual(onTheWire(view), onTheWire(challenge001));
  });

  test("summary, ordering and counts are unchanged", () => {
    assert.deepEqual(onTheWire(registry.list()), [onTheWire(challenge001.challenge)]);
    assert.equal(view.contractVersion, 1);
    assert.equal(view.entryFilePath, "INCIDENT.md");
    assert.equal(view.incidentDate, challenge001.incidentDate);
    assert.deepEqual([view.files.length, view.logs.length, view.network.length, view.rootCauseOptions.length], [14, 23, 14, 5]);
  });

  test("every file path, log id, request id and option id is the same, in the same order", () => {
    assert.deepEqual(view.files.map((file) => file.path), challenge001.files.map((file) => file.path));
    assert.deepEqual(view.logs.map((entry) => entry.id), challenge001.logs.map((entry) => entry.id));
    assert.deepEqual(view.network.map((request) => request.id), challenge001.network.map((request) => request.id));
    assert.deepEqual(
      view.rootCauseOptions.map((option) => option.id),
      challenge001.rootCauseOptions.map((option) => option.id),
    );
  });

  test("network links survive: serverLogId and initiator still point at a real log and file", () => {
    const logs = new Set(view.logs.map((entry) => entry.id));
    const files = new Set(view.files.map((file) => file.path));
    for (const request of view.network) {
      assert.ok(logs.has(request.serverLogId), request.id);
      if (request.initiator !== undefined) assert.ok(files.has(request.initiator), request.id);
    }
    assert.ok(view.network.some((request) => request.initiator !== undefined));
  });

  test("the logs/app.log file still agrees with the log entries", () => {
    const appLog = view.files.find((file) => file.path === "logs/app.log")!.content;
    for (const entry of view.logs) assert.ok(appLog.includes(entry.message), entry.id);
  });
});

describe("the public view is built from an allow-list", () => {
  test("fields that are not part of the public contract never reach it, at any level", () => {
    const LEAK = "LEAK-MARKER";
    const definition = definitionOf((draft) => {
      const extra = { answerKey: LEAK, correctRootCauseId: LEAK, secret: LEAK, isCorrect: true };
      Object.assign(draft.scenario, extra);
      Object.assign(draft.scenario.challenge, extra);
      Object.assign(draft.scenario.files[0], extra);
      Object.assign(draft.scenario.logs[0], extra);
      Object.assign(draft.scenario.network[0], extra);
      Object.assign(draft.scenario.network[0].requestHeaders[0], extra);
      Object.assign(draft.scenario.network[0].responseHeaders[0], extra);
      Object.assign(draft.scenario.rootCauseOptions[0], extra);
    });

    const view = createChallengeRegistry([definition]).getPublic(ID)!;

    assert.ok(!JSON.stringify(view).includes(LEAK));
    assert.deepEqual(onTheWire(view), onTheWire(challenge001));
  });

  test("the whole evaluation configuration and revision stay out of the public view", () => {
    const view = registry.getPublic(ID)!;
    assert.ok(!("evaluation" in view) && !("revision" in view));
    assert.deepEqual(Object.keys(registry.list()[0]).sort(), Object.keys(challenge001.challenge).sort());
  });

  test("an optional field that is absent stays absent instead of becoming undefined", () => {
    const definition = definitionOf((draft) => {
      delete draft.scenario.network[0].initiator;
      draft.scenario.network[0].requestBody = undefined;
    });

    const request = createChallengeRegistry([definition]).getPublic(ID)!.network[0];

    assert.ok(!("initiator" in request));
    assert.ok(!("requestBody" in request));
  });

  test("the view is a frozen copy: callers cannot change it, and neither can edits to the source", () => {
    const definition = definitionOf();
    const copy = createChallengeRegistry([definition]);
    const view = copy.getPublic(ID)!;

    assert.notEqual(view, definition.scenario);
    assert.ok(Object.isFrozen(view) && Object.isFrozen(view.challenge) && Object.isFrozen(view.challenge.tags));
    assert.ok(Object.isFrozen(view.files[0]) && Object.isFrozen(view.network[0].requestHeaders[0]));
    assert.throws(() => {
      (view.challenge as { title: string }).title = "changed";
    }, TypeError);
    assert.throws(() => (view.logs as unknown[]).push({}), TypeError);

    (definition.scenario.challenge as { title: string }).title = "edited after the fact";
    assert.equal(copy.getPublic(ID)!.challenge.title, challenge001.challenge.title);
  });

  test("getPublic and list return the same object every time", () => {
    assert.equal(registry.getPublic(ID), registry.getPublic(ID));
    assert.equal(registry.list(), registry.list());
  });
});

describe("public serialization contains no private evaluation data", () => {
  const publicJson = JSON.stringify([registry.getPublic(ID), registry.list()]);

  // The key's `evidence` details quote lines of the public source files, so they are not private text.
  test("none of the answer-key text appears", () => {
    const privateText = [
      provisionalAnswerKey.resolutionSummary,
      provisionalAnswerKey.rootCause,
      provisionalAnswerKey.expectedFix,
      ...provisionalAnswerKey.plausibleRedHerrings,
      ...provisionalAnswerKey.keyObservations.flatMap((observation) => [observation.id, observation.why]),
    ];
    for (const text of privateText) assert.ok(!publicJson.includes(text), text.slice(0, 60));
  });

  test("none of the private field names appears", () => {
    assert.doesNotMatch(
      publicJson,
      /correctRootCauseId|resolutionSummary|keyObservations|answerKey|expectedFix|plausibleRedHerrings|"evaluation"|"revision"/,
    );
  });

  test("the registry object exposes only its documented methods", () => {
    assert.deepEqual(Object.keys(registry).sort(), ["contentVersion", "diagnosisRegistry", "getDiagnosis", "getPublic", "list"]);
  });

  test("the only place the answer is reachable is the server-only diagnosis side", () => {
    const diagnosis = registry.getDiagnosis(ID)!;
    assert.equal(diagnosis.answerKey.correctRootCauseId, provisionalAnswerKey.correctRootCauseId);
    assert.equal(diagnosis.answerKey.resolutionSummary, provisionalAnswerKey.resolutionSummary);
    assert.equal(diagnosis.answerKey.keyObservations.length, provisionalAnswerKey.keyObservations.length);
  });
});

describe("content version", () => {
  test("is the revision plus a 12-character fingerprint of the public content", () => {
    assertContentVersion(registry.contentVersion(ID), challenge001Definition.revision);
  });

  test("is stable: the same definition always gets the same version", () => {
    assert.equal(createDefaultChallengeRegistry().contentVersion(ID), registry.contentVersion(ID));
    assert.equal(createChallengeRegistry([definitionOf()]).contentVersion(ID), registry.contentVersion(ID));
  });

  test("changes when anything a learner sees changes", () => {
    const edits = [
      (d: ReturnType<typeof definitionOf>) => ((d.scenario.challenge as { title: string }).title = "A new title"),
      (d: ReturnType<typeof definitionOf>) => (d.scenario.files[1].content += "\n"),
      (d: ReturnType<typeof definitionOf>) => (d.scenario.logs[0].message += "!"),
      (d: ReturnType<typeof definitionOf>) => (d.scenario.network[0].responseHeaders[0].value += "x"),
      (d: ReturnType<typeof definitionOf>) => (d.scenario.rootCauseOptions[0].label += "?"),
    ];
    const versions = new Set([registry.contentVersion(ID)]);
    for (const edit of edits) {
      versions.add(createChallengeRegistry([definitionOf(edit as never)]).contentVersion(ID));
    }
    assert.equal(versions.size, edits.length + 1);
  });

  test("changes when the revision is bumped", () => {
    const bumpedRevision = `${challenge001Definition.revision}.1`;
    const bumped = createChallengeRegistry([definitionOf((draft) => (draft.revision = bumpedRevision))]);
    assertContentVersion(bumped.contentVersion(ID), bumpedRevision);
    assert.equal(bumped.contentVersion(ID)!.split("+")[1], registry.contentVersion(ID)!.split("+")[1]);
  });

  test("does not depend on the private evaluation configuration, so it cannot be used to test answers", () => {
    const other = definitionOf((draft) => {
      draft.evaluation.correctRootCauseId = draft.scenario.rootCauseOptions[0].id;
      draft.evaluation.resolutionSummary = "A different resolution.";
      draft.evaluation.keyObservations = [{ id: "only", refs: [{ kind: "log", logId: "log-01" }] }];
    });

    assert.equal(createChallengeRegistry([other]).contentVersion(ID), registry.contentVersion(ID));
  });

  test("canonicalJson ignores key order and drops undefined", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: undefined }] } }), canonicalJson({ a: { c: [3, { z: 1 }], d: 2 }, b: 1 }));
    assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
  });

  test("an unknown challenge has no version", () => {
    assert.equal(registry.contentVersion("challenge-999"), undefined);
  });
});

describe("lookups", () => {
  test("unknown ids find nothing, including names that exist on every object", () => {
    for (const id of ["challenge-999", "", "__proto__", "constructor", "toString", "hasOwnProperty"]) {
      assert.equal(registry.getPublic(id), undefined, id);
      assert.equal(registry.getDiagnosis(id), undefined, id);
      assert.equal(registry.contentVersion(id), undefined, id);
      assert.equal(registry.diagnosisRegistry.has(id), false, id);
    }
  });

  test("several challenges are kept apart, in registration order", () => {
    const second = definitionOf((draft) => {
      (draft.scenario.challenge as { id: string }).id = "challenge-002";
      draft.scenario.challenge.number = "002";
      draft.scenario.challenge.title = "Second";
      draft.revision = "7";
    });

    const both = createChallengeRegistry([challenge001Definition, second]);

    assert.deepEqual(both.list().map((summary) => summary.id), [ID, "challenge-002"]);
    assert.equal(both.getPublic("challenge-002")!.challenge.title, "Second");
    assert.equal(both.getPublic(ID)!.challenge.title, challenge001.challenge.title);
    assert.equal(both.getDiagnosis("challenge-002")!.challengeId, "challenge-002");
    assertContentVersion(both.contentVersion("challenge-002"), second.revision);
    assertContentVersion(both.contentVersion(ID), challenge001Definition.revision);
    assert.deepEqual([...both.diagnosisRegistry.keys()], [ID, "challenge-002"]);
  });
});

describe("the loader fails fast and never returns a partial registry", () => {
  test("two sources that define the same challenge id", () => {
    assert.throws(() => loadChallengeRegistry([challenge001Source, challenge001Source]), ChallengeDefinitionError);
  });

  test("an invalid definition from a source", () => {
    const bad = staticChallengeSource("bad", [
      definitionOf((draft) => {
        (draft.scenario.challenge as { id: string }).id = "challenge-002";
        draft.scenario.challenge.number = "002";
        draft.scenario.entryFilePath = "missing.md";
      }),
    ]);
    assert.throws(
      () => loadChallengeRegistry([challenge001Source, bad]),
      (error: unknown) => error instanceof ChallengeDefinitionError && error.issues.length === 1,
    );
  });

  test("a source that throws is reported by name", () => {
    const broken = {
      name: "broken-source",
      load: () => {
        throw new Error("disk on fire");
      },
    };
    assert.throws(
      () => loadChallengeRegistry([broken]),
      (error: unknown) =>
        error instanceof ChallengeDefinitionError && error.message.includes('source "broken-source" could not be loaded: disk on fire'),
    );
  });

  test("no sources is an empty registry, not an error", () => {
    const empty = loadChallengeRegistry([]);
    assert.deepEqual(empty.list(), []);
    assert.equal(empty.diagnosisRegistry.size, 0);
  });
});
