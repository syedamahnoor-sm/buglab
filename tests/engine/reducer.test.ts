import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSession, sessionReducer } from "@/engine/session/reducer";
import type { SessionEvent, SessionState } from "@/engine/types";
import {
  failingVisibleReport,
  makeDiagnosisConfig,
  makeFixConfig,
  makeReport,
  makeResult,
  passingAllReport,
  passingVisibleReport,
  visibleOnlyPassReport,
} from "./fixtures";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function apply(state: SessionState, ...events: SessionEvent[]): SessionState {
  return events.reduce(sessionReducer, state);
}

function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}

describe("createSession", () => {
  it("starts a diagnosis-mode session with nothing to edit and no hints", () => {
    const state = createSession(makeDiagnosisConfig());

    assert.deepEqual(
      pick(state, ["challengeId", "completion", "status", "diagnosed", "hintLimit"]),
      {
        challengeId: "000-fixture",
        completion: "diagnosis",
        status: "in_progress",
        diagnosed: false,
        hintLimit: 0,
      },
    );
    assert.deepEqual(state.files, {});
  });

  it("starts in progress with only the editable files", () => {
    const state = createSession(makeFixConfig());

    assert.deepEqual(
      pick(state, [
        "version",
        "challengeId",
        "completion",
        "status",
        "hintLimit",
        "hintsUsed",
        "runs",
        "lastRun",
        "diagnosed",
        "passedVisible",
        "passedAll",
      ]),
      {
        version: 1,
        challengeId: "000-fixture",
        completion: "fix",
        status: "in_progress",
        hintLimit: 3,
        hintsUsed: 0,
        runs: 0,
        lastRun: null,
        diagnosed: false,
        passedVisible: false,
        passedAll: false,
      },
    );
    assert.deepEqual(Object.keys(state.files), ["src/main.js", "src/util.js"]);
  });
});

describe("FILE_EDITED", () => {
  const start = createSession(makeFixConfig());

  it("updates the file and marks the session edited since the last run", () => {
    const next = apply(start, {
      type: "FILE_EDITED",
      path: "src/main.js",
      contents: "export const x = 2;\n",
    });

    assert.equal(next.files["src/main.js"], "export const x = 2;\n");
    assert.equal(next.editedSinceRun, true);
  });

  it("ignores read-only and unknown paths", () => {
    const readOnly = { type: "FILE_EDITED", path: "tests/visible.js", contents: "x" } as const;
    const unknown = { type: "FILE_EDITED", path: "nope.js", contents: "x" } as const;

    assert.equal(apply(start, readOnly), start);
    assert.equal(apply(start, unknown), start);
  });

  it("does not treat inherited object keys as files", () => {
    const next = apply(start, {
      type: "FILE_EDITED",
      path: "constructor",
      contents: "x",
    });

    assert.equal(next, start);
  });

  it("ignores an edit that changes nothing", () => {
    const next = apply(start, {
      type: "FILE_EDITED",
      path: "src/main.js",
      contents: start.files["src/main.js"],
    });

    assert.equal(next, start);
  });
});

describe("RUN_COMPLETED", () => {
  const start = createSession(makeFixConfig());

  it("records a failing visible run without passing anything", () => {
    const report = failingVisibleReport();
    const next = apply(start, { type: "RUN_COMPLETED", report });

    assert.equal(next.runs, 1);
    assert.equal(next.lastRun, report);
    assert.equal(next.passedVisible, false);
    assert.equal(next.status, "in_progress");
  });

  it("marks visible tests passed without solving the challenge", () => {
    const next = apply(start, {
      type: "RUN_COMPLETED",
      report: passingVisibleReport(),
    });

    assert.equal(next.passedVisible, true);
    assert.equal(next.passedAll, false);
    assert.equal(next.status, "in_progress");
  });

  it("keeps the session open when visible tests pass but a hidden test fails", () => {
    const next = apply(start, {
      type: "RUN_COMPLETED",
      report: visibleOnlyPassReport(),
    });

    assert.equal(next.passedVisible, true);
    assert.equal(next.passedAll, false);
    assert.equal(next.status, "in_progress");
  });

  it("solves the challenge when every test passes", () => {
    const next = apply(start, {
      type: "RUN_COMPLETED",
      report: passingAllReport(),
    });

    assert.equal(next.passedVisible, true);
    assert.equal(next.passedAll, true);
    assert.equal(next.status, "solved");
  });

  it("does not credit visible tests after a timeout or crash", () => {
    for (const outcome of ["timeout", "crashed"] as const) {
      const report = makeReport("visible", outcome, [makeResult()]);
      const next = apply(start, { type: "RUN_COMPLETED", report });

      assert.equal(next.passedVisible, false);
    }
  });

  it("never credits a run that contained no visible tests", () => {
    const next = apply(start, {
      type: "RUN_COMPLETED",
      report: makeReport("visible", "passed", []),
    });

    assert.equal(next.passedVisible, false);
  });

  it("clears editedSinceRun and keeps an earlier visible pass sticky", () => {
    const next = apply(
      start,
      { type: "RUN_COMPLETED", report: passingVisibleReport() },
      { type: "FILE_EDITED", path: "src/main.js", contents: "broken" },
      { type: "RUN_COMPLETED", report: failingVisibleReport() },
    );

    assert.equal(next.editedSinceRun, false);
    assert.equal(next.passedVisible, true);
    assert.equal(next.runs, 2);
  });
});

describe("HINT_REVEALED", () => {
  it("counts hints up to the challenge's hint limit", () => {
    const start = createSession(makeFixConfig());
    const hint = { type: "HINT_REVEALED" } as const;

    const next = apply(start, hint, hint, hint, hint, hint);

    assert.equal(next.hintsUsed, 3);
  });
});

describe("DIAGNOSIS_ACCEPTED in a diagnosis-mode session", () => {
  const start = createSession(makeDiagnosisConfig());
  const accepted: SessionEvent = { type: "DIAGNOSIS_ACCEPTED" };

  it("solves the session", () => {
    const next = apply(start, accepted);

    assert.equal(next.diagnosed, true);
    assert.equal(next.status, "solved");
  });

  it("is idempotent: repeats return the very same state", () => {
    const solved = apply(start, accepted);

    assert.equal(apply(solved, accepted), solved);
    assert.deepEqual(apply(solved, accepted, accepted), solved);
  });

  it("ignores every event that only makes sense in Fix Mode", () => {
    const events: SessionEvent[] = [
      { type: "FILE_EDITED", path: "src/main.js", contents: "changed" },
      { type: "RUN_COMPLETED", report: passingAllReport() },
      { type: "HINT_REVEALED" },
      { type: "REVEALED" },
    ];

    for (const event of events) {
      assert.equal(sessionReducer(start, event), start);
    }
  });
});

describe("DIAGNOSIS_ACCEPTED in a Fix Mode session", () => {
  const start = createSession(makeFixConfig());

  it("records the diagnosis without solving the session", () => {
    const next = apply(start, { type: "DIAGNOSIS_ACCEPTED" });

    assert.equal(next.diagnosed, true);
    assert.equal(next.status, "in_progress");
    assert.equal(next.passedAll, false);
  });

  it("is idempotent: repeats return the very same state", () => {
    const diagnosed = apply(start, { type: "DIAGNOSIS_ACCEPTED" });

    assert.equal(apply(diagnosed, { type: "DIAGNOSIS_ACCEPTED" }), diagnosed);
  });

  it("still solves once the tests pass after a diagnosis", () => {
    const next = apply(
      start,
      { type: "DIAGNOSIS_ACCEPTED" },
      { type: "RUN_COMPLETED", report: passingAllReport() },
    );

    assert.equal(next.diagnosed, true);
    assert.equal(next.status, "solved");
  });
});

describe("terminal states", () => {
  const events: SessionEvent[] = [
    { type: "FILE_EDITED", path: "src/main.js", contents: "changed" },
    { type: "RUN_COMPLETED", report: passingAllReport() },
    { type: "HINT_REVEALED" },
    { type: "DIAGNOSIS_ACCEPTED" },
    { type: "REVEALED" },
  ];

  it("freezes a solved session", () => {
    const solved = apply(createSession(makeFixConfig()), {
      type: "RUN_COMPLETED",
      report: passingAllReport(),
    });

    for (const event of events) {
      assert.equal(sessionReducer(solved, event), solved);
    }
  });

  it("freezes a revealed session", () => {
    const revealed = apply(createSession(makeFixConfig()), { type: "REVEALED" });

    assert.equal(revealed.status, "revealed");
    for (const event of events) {
      assert.equal(sessionReducer(revealed, event), revealed);
    }
  });
});

describe("purity", () => {
  it("never mutates the state it is given", () => {
    const start = deepFreeze(createSession(makeFixConfig()));
    const events: SessionEvent[] = [
      { type: "FILE_EDITED", path: "src/main.js", contents: "changed" },
      { type: "RUN_COMPLETED", report: passingVisibleReport() },
      { type: "HINT_REVEALED" },
      { type: "DIAGNOSIS_ACCEPTED" },
      { type: "DIAGNOSIS_ACCEPTED" },
      { type: "RUN_COMPLETED", report: passingAllReport() },
    ];

    assert.doesNotThrow(() => apply(start, ...events));
  });
});
