import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { challenge001Definition } from "@/server/challenges/challenge-001";
import { ChallengeDefinitionError } from "@/server/challenges/definition";
import { createChallengeRegistry } from "@/server/challenges/registry";
import { findDefinitionIssues } from "@/server/challenges/validate";
import { draftOf, definitionOf, type Draft } from "./helpers";

/** The issues for one edited copy of Challenge 001. */
const issuesFor = (change: (draft: Draft) => void) => findDefinitionIssues([definitionOf(change)]);
const mentions = (issues: string[], text: string) => issues.some((issue) => issue.includes(text));

describe("definition validation: the real challenge", () => {
  test("Challenge 001 has no issues", () => {
    assert.deepEqual(findDefinitionIssues([challenge001Definition]), []);
  });

  test("a request with no initiator is valid (the field is optional)", () => {
    const issues = issuesFor((draft) => {
      delete draft.scenario.network[0].initiator;
    });
    assert.deepEqual(issues, []);
  });
});

describe("definition validation: duplicate ids fail fast", () => {
  test("a challenge id defined twice", () => {
    const issues = findDefinitionIssues([definitionOf(), definitionOf()]);
    assert.ok(mentions(issues, 'challenge id "challenge-001" is defined more than once'), issues.join("\n"));
  });

  test("a file path used twice", () => {
    const issues = issuesFor((draft) => draft.scenario.files.push({ ...draft.scenario.files[0] }));
    assert.ok(mentions(issues, 'file path "INCIDENT.md" is used more than once'), issues.join("\n"));
  });

  test("a log id used twice", () => {
    const issues = issuesFor((draft) => draft.scenario.logs.push({ ...draft.scenario.logs[0] }));
    assert.ok(mentions(issues, 'log id "log-01" is used more than once'), issues.join("\n"));
  });

  test("a network request id used twice", () => {
    const issues = issuesFor((draft) => draft.scenario.network.push({ ...draft.scenario.network[0] }));
    assert.ok(mentions(issues, 'network request id "req-01" is used more than once'), issues.join("\n"));
  });

  test("a root-cause option id used twice", () => {
    const issues = issuesFor((draft) => draft.scenario.rootCauseOptions.push({ ...draft.scenario.rootCauseOptions[0] }));
    assert.ok(mentions(issues, 'root-cause option id "cookie-not-sent" is used more than once'), issues.join("\n"));
  });

  test("a key observation id used twice", () => {
    const issues = issuesFor((draft) => {
      draft.evaluation.keyObservations[1].id = draft.evaluation.keyObservations[0].id;
    });
    assert.ok(mentions(issues, "is used more than once"), issues.join("\n"));
  });

  test("the registry refuses to be built from them", () => {
    assert.throws(() => createChallengeRegistry([definitionOf(), definitionOf()]), ChallengeDefinitionError);
  });
});

describe("definition validation: invalid references fail fast", () => {
  test("an unsupported contract version", () => {
    const issues = issuesFor((draft) => {
      (draft.scenario as { contractVersion: number }).contractVersion = 2;
    });
    assert.ok(mentions(issues, "contract version 2 is not supported"), issues.join("\n"));
  });

  test("a missing contract version", () => {
    const issues = issuesFor((draft) => {
      delete (draft.scenario as { contractVersion?: number }).contractVersion;
    });
    assert.ok(mentions(issues, "contract version undefined is not supported"), issues.join("\n"));
  });

  test("an entry file that is not a scenario file", () => {
    const issues = issuesFor((draft) => {
      draft.scenario.entryFilePath = "missing.md";
    });
    assert.ok(mentions(issues, 'entry file "missing.md" is not one of the scenario files'), issues.join("\n"));
  });

  test("a network serverLogId that is not a log", () => {
    const issues = issuesFor((draft) => {
      draft.scenario.network[2].serverLogId = "log-99";
    });
    assert.ok(mentions(issues, 'network request "req-03": serverLogId "log-99" is not a log entry'), issues.join("\n"));
  });

  test("a network initiator that is not a scenario file", () => {
    const issues = issuesFor((draft) => {
      draft.scenario.network[0].initiator = "public/missing.js";
    });
    assert.ok(mentions(issues, 'initiator "public/missing.js" is not a scenario file'), issues.join("\n"));
  });

  test("a blank initiator is not the same as no initiator", () => {
    const issues = issuesFor((draft) => {
      draft.scenario.network[0].initiator = "";
    });
    assert.ok(mentions(issues, "is not a scenario file"), issues.join("\n"));
  });

  test("a correct root cause that is not a public option", () => {
    const issues = issuesFor((draft) => {
      draft.evaluation.correctRootCauseId = "not-an-option";
    });
    assert.ok(mentions(issues, "the correct root cause is not one of the public root-cause options"), issues.join("\n"));
  });

  test("a key observation that refers to an unknown log", () => {
    const issues = issuesFor((draft) => draft.evaluation.keyObservations[0].refs.push({ kind: "log", logId: "log-99" }));
    assert.ok(mentions(issues, "refers to unknown evidence log:log-99"), issues.join("\n"));
  });

  test("a key observation that refers to an unknown network request", () => {
    const issues = issuesFor((draft) =>
      draft.evaluation.keyObservations[0].refs.push({ kind: "network", requestId: "req-99" }),
    );
    assert.ok(mentions(issues, "refers to unknown evidence network:req-99"), issues.join("\n"));
  });

  test("a log id is not a request id: the evidence kind decides where it is looked up", () => {
    const issues = issuesFor((draft) => draft.evaluation.keyObservations[0].refs.push({ kind: "network", requestId: "log-01" }));
    assert.ok(mentions(issues, "refers to unknown evidence network:log-01"), issues.join("\n"));
  });

  test("a key observation with no evidence", () => {
    const issues = issuesFor((draft) => {
      draft.evaluation.keyObservations[0].refs = [];
    });
    assert.ok(mentions(issues, "has no evidence, so it could never be covered"), issues.join("\n"));
  });

  test("an evidence id in two key-observation groups", () => {
    const issues = issuesFor((draft) =>
      draft.evaluation.keyObservations[1].refs.push({ kind: "network", requestId: "req-01" }),
    );
    assert.ok(mentions(issues, "evidence network:req-01 is in both key observation"), issues.join("\n"));
  });

  test("an evidence id listed twice in one group", () => {
    const issues = issuesFor((draft) => {
      const refs = draft.evaluation.keyObservations[0].refs;
      refs.push({ ...refs[0] });
    });
    assert.ok(mentions(issues, "is listed twice in key observation"), issues.join("\n"));
  });

  test("the registry refuses to be built from any of them", () => {
    const broken = [
      (draft: Draft) => {
        draft.scenario.entryFilePath = "missing.md";
      },
      (draft: Draft) => {
        draft.scenario.network[2].serverLogId = "log-99";
      },
      (draft: Draft) => {
        draft.evaluation.correctRootCauseId = "not-an-option";
      },
      (draft: Draft) => draft.evaluation.keyObservations[0].refs.push({ kind: "log", logId: "log-99" }),
    ];
    for (const change of broken) {
      assert.throws(() => createChallengeRegistry([definitionOf(change)]), ChallengeDefinitionError);
    }
  });
});

describe("definition validation: reporting", () => {
  test("every problem is reported together, in one error, each prefixed with its challenge", () => {
    const definition = definitionOf((draft) => {
      draft.scenario.entryFilePath = "missing.md";
      draft.scenario.network[2].serverLogId = "log-99";
      draft.evaluation.correctRootCauseId = "not-an-option";
    });

    assert.throws(
      () => createChallengeRegistry([definition]),
      (error: unknown) => {
        assert.ok(error instanceof ChallengeDefinitionError);
        assert.equal(error.issues.length, 3);
        assert.ok(error.issues.every((issue) => issue.startsWith("challenge-001: ")));
        assert.match(error.message, /Invalid challenge definitions/);
        return true;
      },
    );
  });

  test("messages never contain the answer or the resolution text", () => {
    const definition = definitionOf((draft) => {
      draft.evaluation.correctRootCauseId = "secret-answer-id";
      draft.scenario.entryFilePath = "missing.md";
    });

    try {
      createChallengeRegistry([definition]);
      assert.fail("expected the registry to refuse the definition");
    } catch (error) {
      assert.ok(error instanceof ChallengeDefinitionError);
      assert.ok(!error.message.includes("secret-answer-id"));
      assert.ok(!error.message.includes(draftOf().evaluation.resolutionSummary));
    }
  });
});
