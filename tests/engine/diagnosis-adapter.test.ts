import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diagnosisResponseToEvent,
  isRejectedDiagnosis,
} from "@/engine/adapters/diagnosis";
import { createSession, sessionReducer } from "@/engine/session/reducer";
import type { SessionEvent, SessionState } from "@/engine/types";
import type { DiagnosisResponse, DiagnosisResponseStatus } from "@/types/diagnosis";
import { diagnosisResponses as responses, makeDiagnosisConfig, makeFixConfig } from "./fixtures";

const notCorrect = [
  responses.incorrect,
  responses.invalid,
  responses["rate-limited"],
  responses.error,
];

// What the workspace would do: dispatch the event only when there is one.
function applyResponse(state: SessionState, response: DiagnosisResponse): SessionState {
  const event = diagnosisResponseToEvent(response);
  return event ? sessionReducer(state, event) : state;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

describe("diagnosisResponseToEvent", () => {
  it("turns a correct response into DIAGNOSIS_ACCEPTED", () => {
    assert.deepEqual(diagnosisResponseToEvent(responses.correct), {
      type: "DIAGNOSIS_ACCEPTED",
    });
  });

  for (const response of notCorrect) {
    it(`produces no event for a ${response.status} response`, () => {
      assert.equal(diagnosisResponseToEvent(response), null);
    });
  }

  it("fails closed on a status it does not know", () => {
    // @ts-expect-error a status outside the DiagnosisResponse union is rejected by the types
    const event: SessionEvent | null = diagnosisResponseToEvent({ status: "accepted" });

    assert.equal(event, null);
  });

  it("needs no root cause or answer, only a complete correct response", () => {
    assert.equal(isRejectedDiagnosis(responses.correct), false);
    assert.deepEqual(diagnosisResponseToEvent(responses.correct), { type: "DIAGNOSIS_ACCEPTED" });
  });

  it("produces no event for a bare or malformed correct response", () => {
    const { feedback, resolution, attempts } = responses.correct;
    const malformed = [
      { status: "correct" },
      { status: "correct", feedback, resolution },
      { status: "correct", feedback, attempts },
      { status: "correct", resolution, attempts },
      { status: "correct", feedback: null, resolution, attempts },
      { status: "correct", feedback, resolution: { summary: 7 }, attempts },
      { status: "correct", feedback, resolution, attempts: { used: "1", limit: 3, remaining: 2 } },
      { status: "correct", feedback: { ...feedback, hints: "none" }, resolution, attempts },
      { status: "correct", feedback, resolution, attempts: null },
      null,
      undefined,
      "correct",
      [],
    ];

    for (const value of malformed) {
      assert.equal(
        diagnosisResponseToEvent(value as unknown as DiagnosisResponse),
        null,
        JSON.stringify(value),
      );
    }
  });

  it("does not count a malformed incorrect response as a rejected diagnosis", () => {
    for (const value of [{ status: "incorrect" }, { status: "incorrect", attempts: responses.incorrect.attempts }]) {
      assert.equal(isRejectedDiagnosis(value as unknown as DiagnosisResponse), false);
    }
  });

  it("does not modify the response", () => {
    for (const response of Object.values(responses)) {
      const frozen = deepFreeze(structuredClone(response));

      assert.doesNotThrow(() => diagnosisResponseToEvent(frozen));
      assert.deepEqual(frozen, response);
    }
  });
});

describe("applying API outcomes to a session", () => {
  it("a correct response solves a diagnosis-mode session", () => {
    const next = applyResponse(createSession(makeDiagnosisConfig()), responses.correct);

    assert.equal(next.status, "solved");
    assert.equal(next.diagnosed, true);
  });

  it("repeating a correct response is safe", () => {
    const solved = applyResponse(createSession(makeDiagnosisConfig()), responses.correct);

    assert.equal(applyResponse(solved, responses.correct), solved);
  });

  it("a correct response does not solve a Fix Mode session", () => {
    const next = applyResponse(createSession(makeFixConfig()), responses.correct);

    assert.equal(next.diagnosed, true);
    assert.equal(next.status, "in_progress");
    assert.equal(next.passedAll, false);
  });

  for (const config of [makeDiagnosisConfig(), makeFixConfig()]) {
    it(`non-correct responses leave a ${config.completion}-mode session untouched`, () => {
      const start = createSession(config);

      for (const response of notCorrect) {
        assert.equal(applyResponse(start, response), start);
      }
      assert.equal(
        notCorrect.reduce(applyResponse, start),
        start,
        "a run of failed submissions never changes the session",
      );
    });
  }

  it("a correct response after failed ones still solves the session", () => {
    const start = createSession(makeDiagnosisConfig());
    const next = [...notCorrect, responses.correct].reduce(applyResponse, start);

    assert.equal(next.status, "solved");
  });
});

describe("isRejectedDiagnosis", () => {
  it("is true only for an incorrect response", () => {
    const evaluated: Record<DiagnosisResponseStatus, boolean> = {
      correct: false,
      incorrect: true,
      invalid: false,
      "rate-limited": false,
      error: false,
    };

    for (const [status, expected] of Object.entries(evaluated)) {
      assert.equal(
        isRejectedDiagnosis(responses[status as DiagnosisResponseStatus]),
        expected,
        status,
      );
    }
  });
});
