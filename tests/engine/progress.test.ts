import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDiagnosisResponse,
  createProgress,
  progressStatus,
  type LearnerProgress,
} from "@/engine/session/progress";
import type { DiagnosisResponse } from "@/types/diagnosis";
import { diagnosisResponses as responses, makeDiagnosisConfig, makeFixConfig } from "./fixtures";

const diagnosisMode = createProgress(makeDiagnosisConfig());
const fixMode = createProgress(makeFixConfig());
const statusOf = (progress: LearnerProgress) => progressStatus(progress, true);
const receive = (progress: LearnerProgress, ...list: (typeof responses)[keyof typeof responses][]) =>
  list.reduce(applyDiagnosisResponse, progress);

describe("createProgress", () => {
  it("starts with an open session and nothing submitted", () => {
    assert.equal(diagnosisMode.session.status, "in_progress");
    assert.equal(diagnosisMode.session.completion, "diagnosis");
    assert.equal(diagnosisMode.diagnosisSubmitted, false);
  });

  it("reports not-started until the investigation has begun", () => {
    assert.equal(progressStatus(diagnosisMode, false), "not-started");
    assert.equal(progressStatus(diagnosisMode, true), "in-progress");
  });
});

describe("applyDiagnosisResponse", () => {
  it("resolves a diagnosis-mode session on a correct response", () => {
    const next = receive(diagnosisMode, responses.correct);

    assert.equal(next.session.status, "solved");
    assert.equal(statusOf(next), "resolved");
  });

  it("makes the status submitted on an incorrect response, without touching the session", () => {
    const next = receive(diagnosisMode, responses.incorrect);

    assert.equal(statusOf(next), "submitted");
    assert.equal(next.session, diagnosisMode.session);
  });

  for (const response of [responses.invalid, responses["rate-limited"], responses.error]) {
    it(`returns the very same progress for a ${response.status} response`, () => {
      assert.equal(receive(diagnosisMode, response), diagnosisMode);
      assert.equal(statusOf(receive(diagnosisMode, response)), "in-progress");
    });
  }

  it("keeps submitted latched through every later non-correct response", () => {
    const rejected = receive(diagnosisMode, responses.incorrect);

    for (const response of [responses.invalid, responses["rate-limited"], responses.error]) {
      assert.equal(statusOf(receive(rejected, response)), "submitted");
    }
    assert.equal(receive(rejected, responses.incorrect), rejected, "a repeat changes nothing");
  });

  it("resolves after rejected attempts once a correct response arrives", () => {
    const next = receive(diagnosisMode, responses.incorrect, responses.incorrect, responses.correct);

    assert.equal(statusOf(next), "resolved");
  });

  it("leaves the session and progress untouched for a malformed response of any status", () => {
    const { feedback, attempts } = responses.incorrect;
    const malformed = [
      { status: "correct" },
      { status: "correct", feedback, attempts },
      { status: "incorrect" },
      { status: "incorrect", feedback },
      { status: "rate-limited" },
      { status: "invalid", errors: "none" },
      { status: "error" },
      { status: "accepted" },
      null,
    ];

    for (const value of malformed) {
      const response = value as unknown as DiagnosisResponse;
      assert.equal(receive(diagnosisMode, response), diagnosisMode, JSON.stringify(value));
      assert.equal(receive(fixMode, response), fixMode, JSON.stringify(value));
    }
  });

  it("does not let a malformed response change an already submitted status", () => {
    const rejected = receive(diagnosisMode, responses.incorrect);

    assert.equal(receive(rejected, { status: "correct" } as unknown as DiagnosisResponse), rejected);
  });

  it("is safe to repeat a correct response", () => {
    const solved = receive(diagnosisMode, responses.correct);

    assert.equal(receive(solved, responses.correct), solved);
  });

  it("does not resolve a Fix Mode session merely because a diagnosis was accepted", () => {
    const next = receive(fixMode, responses.correct);

    assert.equal(next.session.diagnosed, true);
    assert.equal(next.session.status, "in_progress");
    assert.equal(statusOf(next), "in-progress");
  });

  it("never mutates the progress it is given", () => {
    const frozen = Object.freeze({
      session: Object.freeze({ ...diagnosisMode.session, files: Object.freeze({}) }),
      diagnosisSubmitted: false,
    });

    assert.doesNotThrow(() => receive(frozen, responses.incorrect, responses.correct));
  });
});
