import { describe, expect, it } from "vitest";
import {
  failingVisibleReport,
  makeChallenge,
  makeReport,
  makeResult,
  passingAllReport,
  passingVisibleReport,
  visibleOnlyPassReport,
} from "../test-fixtures";
import type { SessionEvent, SessionState } from "../types";
import { createSession, sessionReducer } from "./reducer";

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

describe("createSession", () => {
  it("starts in progress with only the editable files", () => {
    const state = createSession(makeChallenge());

    expect(state).toMatchObject({
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
    });
    expect(Object.keys(state.files)).toEqual(["src/main.js", "src/util.js"]);
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

    expect(next.files["src/main.js"]).toBe("export const x = 2;\n");
    expect(next.editedSinceRun).toBe(true);
  });

  it("ignores read-only and unknown paths", () => {
    const readOnly = { type: "FILE_EDITED", path: "tests/visible.js", contents: "x" } as const;
    const unknown = { type: "FILE_EDITED", path: "nope.js", contents: "x" } as const;

    expect(apply(start, readOnly)).toBe(start);
    expect(apply(start, unknown)).toBe(start);
  });

  it("does not treat inherited object keys as files", () => {
    const next = apply(start, {
      type: "FILE_EDITED",
      path: "constructor",
      contents: "x",
    });

    expect(next).toBe(start);
  });

  it("ignores an edit that changes nothing", () => {
    const next = apply(start, {
      type: "FILE_EDITED",
      path: "src/main.js",
      contents: start.files["src/main.js"],
    });

    expect(next).toBe(start);
  });
});

describe("RUN_COMPLETED", () => {
  const start = createSession(makeChallenge());

  it("records a failing visible run without passing anything", () => {
    const report = failingVisibleReport();
    const next = apply(start, { type: "RUN_COMPLETED", report });

    expect(next.runs).toBe(1);
    expect(next.lastRun).toBe(report);
    expect(next.passedVisible).toBe(false);
    expect(next.status).toBe("in_progress");
  });

  it("marks visible tests passed without solving the challenge", () => {
    const next = apply(start, {
      type: "RUN_COMPLETED",
      report: passingVisibleReport(),
    });

    expect(next.passedVisible).toBe(true);
    expect(next.passedAll).toBe(false);
    expect(next.status).toBe("in_progress");
  });

  it("keeps the session open when visible tests pass but a hidden test fails", () => {
    const next = apply(start, {
      type: "RUN_COMPLETED",
      report: visibleOnlyPassReport(),
    });

    expect(next.passedVisible).toBe(true);
    expect(next.passedAll).toBe(false);
    expect(next.status).toBe("in_progress");
  });

  it("solves the challenge when every test passes", () => {
    const next = apply(start, {
      type: "RUN_COMPLETED",
      report: passingAllReport(),
    });

    expect(next.passedVisible).toBe(true);
    expect(next.passedAll).toBe(true);
    expect(next.status).toBe("solved");
  });

  it("does not credit visible tests after a timeout or crash", () => {
    for (const outcome of ["timeout", "crashed"] as const) {
      const report = makeReport("visible", outcome, [makeResult()]);
      const next = apply(start, { type: "RUN_COMPLETED", report });

      expect(next.passedVisible).toBe(false);
    }
  });

  it("never credits a run that contained no visible tests", () => {
    const next = apply(start, {
      type: "RUN_COMPLETED",
      report: makeReport("visible", "passed", []),
    });

    expect(next.passedVisible).toBe(false);
  });

  it("clears editedSinceRun and keeps an earlier visible pass sticky", () => {
    const next = apply(
      start,
      { type: "RUN_COMPLETED", report: passingVisibleReport() },
      { type: "FILE_EDITED", path: "src/main.js", contents: "broken" },
      { type: "RUN_COMPLETED", report: failingVisibleReport() },
    );

    expect(next.editedSinceRun).toBe(false);
    expect(next.passedVisible).toBe(true);
    expect(next.runs).toBe(2);
  });
});

describe("HINT_REVEALED", () => {
  it("counts hints up to the challenge's hint limit", () => {
    const start = createSession(makeChallenge());
    const hint = { type: "HINT_REVEALED" } as const;

    const next = apply(start, hint, hint, hint, hint, hint);

    expect(next.hintsUsed).toBe(3);
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

    expect(next.wrongDiagnoses).toBe(2);
    expect(next.diagnosed).toBe(false);
  });

  it("records a correct diagnosis once and ignores later attempts", () => {
    const next = apply(
      start,
      { type: "DIAGNOSIS_CHECKED", correct: true },
      { type: "DIAGNOSIS_CHECKED", correct: false },
    );

    expect(next.diagnosed).toBe(true);
    expect(next.wrongDiagnoses).toBe(0);
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
      expect(sessionReducer(solved, event)).toBe(solved);
    }
  });

  it("freezes a revealed session", () => {
    const revealed = apply(createSession(makeChallenge()), { type: "REVEALED" });

    expect(revealed.status).toBe("revealed");
    for (const event of events) {
      expect(sessionReducer(revealed, event)).toBe(revealed);
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

    expect(() => apply(start, ...events)).not.toThrow();
  });
});
