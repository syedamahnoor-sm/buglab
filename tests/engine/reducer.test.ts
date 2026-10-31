import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSession, sessionReducer } from "@/engine/session/reducer";
import type { SessionEvent, SessionState } from "@/engine/types";
import {
  failingVisibleReport,
  makeChallenge,
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
  it("starts in progress with only the editable files", () => {
    const state = createSession(makeChallenge());

    assert.deepEqual(
      pick(state, [
        "version",
        "challengeId",
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
  const start = createSession(makeChallenge());

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
  const start = createSession(makeChallenge());

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
    const start = createSession(makeChallenge());
    const hint = { type: "HINT_REVEALED" } as const;

    const next = apply(start, hint, hint, hint, hint, hint);

    assert.equal(next.hintsUsed, 3);
  });
});

describe("DIAGNOSIS_CHECKED", () => {
  const start = createSession(makeChallenge());

  it("counts wrong diagnoses", () => {
    const next = apply(
      start,
      { type: "DIAGNOSIS_CHECKED", correct: false },
      { type: "DIAGNOSIS_CHECKED", correct: false },
    );

    assert.equal(next.wrongDiagnoses, 2);
    assert.equal(next.diagnosed, false);
  });

  it("records a correct diagnosis once and ignores later attempts", () => {
    const next = apply(
      start,
      { type: "DIAGNOSIS_CHECKED", correct: true },
      { type: "DIAGNOSIS_CHECKED", correct: false },
    );

    assert.equal(next.diagnosed, true);
    assert.equal(next.wrongDiagnoses, 0);
  });
});

describe("terminal states", () => {
  const events: SessionEvent[] = [
    { type: "FILE_EDITED", path: "src/main.js", contents: "changed" },
    { type: "RUN_COMPLETED", report: passingAllReport() },
    { type: "HINT_REVEALED" },
    { type: "DIAGNOSIS_CHECKED", correct: true },
    { type: "REVEALED" },
  ];

  it("freezes a solved session", () => {
    const solved = apply(createSession(makeChallenge()), {
      type: "RUN_COMPLETED",
      report: passingAllReport(),
    });

    for (const event of events) {
      assert.equal(sessionReducer(solved, event), solved);
    }
  });

  it("freezes a revealed session", () => {
    const revealed = apply(createSession(makeChallenge()), { type: "REVEALED" });

    assert.equal(revealed.status, "revealed");
    for (const event of events) {
      assert.equal(sessionReducer(revealed, event), revealed);
    }
  });
});

describe("purity", () => {
  it("never mutates the state it is given", () => {
    const start = deepFreeze(createSession(makeChallenge()));
    const events: SessionEvent[] = [
      { type: "FILE_EDITED", path: "src/main.js", contents: "changed" },
      { type: "RUN_COMPLETED", report: passingVisibleReport() },
      { type: "HINT_REVEALED" },
      { type: "DIAGNOSIS_CHECKED", correct: false },
      { type: "DIAGNOSIS_CHECKED", correct: true },
      { type: "RUN_COMPLETED", report: passingAllReport() },
    ];

    assert.doesNotThrow(() => apply(start, ...events));
  });
});
