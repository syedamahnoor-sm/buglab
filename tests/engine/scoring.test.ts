import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSession, sessionReducer } from "@/engine/session/reducer";
import { computeScore, maxScore } from "@/engine/session/scoring";
import type { SessionEvent } from "@/engine/types";
import {
  makeChallenge,
  passingAllReport,
  passingVisibleReport,
  visibleOnlyPassReport,
} from "./fixtures";

const challenge = makeChallenge();
const rules = challenge.scoring;

function play(...events: SessionEvent[]) {
  return computeScore(
    events.reduce(sessionReducer, createSession(challenge)),
    rules,
  );
}

describe("maxScore", () => {
  it("sums the diagnosis and fix points", () => {
    assert.equal(maxScore(rules), 100);
  });
});

describe("computeScore", () => {
  it("scores zero for a session with no progress", () => {
    assert.deepEqual(play(), {
      total: 0,
      max: 100,
      breakdown: { diagnosis: 0, visibleFix: 0, hiddenFix: 0, hintPenalty: 0 },
    });
  });

  it("awards the full score for a clean diagnosis and fix", () => {
    const score = play(
      { type: "DIAGNOSIS_CHECKED", correct: true },
      { type: "RUN_COMPLETED", report: passingAllReport() },
    );

    assert.equal(score.total, 100);
    assert.deepEqual(score.breakdown, {
      diagnosis: 30,
      visibleFix: 25,
      hiddenFix: 45,
      hintPenalty: 0,
    });
  });

  it("gives only the visible points when hidden tests still fail", () => {
    const score = play(
      { type: "DIAGNOSIS_CHECKED", correct: true },
      { type: "RUN_COMPLETED", report: visibleOnlyPassReport() },
    );

    assert.equal(score.total, 55);
  });

  it("keeps visible credit when the player later gives up", () => {
    const score = play(
      { type: "RUN_COMPLETED", report: passingVisibleReport() },
      { type: "REVEALED" },
    );

    assert.equal(score.total, 25);
  });

  it("subtracts each wrong diagnosis from the diagnosis points", () => {
    const score = play(
      { type: "DIAGNOSIS_CHECKED", correct: false },
      { type: "DIAGNOSIS_CHECKED", correct: false },
      { type: "DIAGNOSIS_CHECKED", correct: true },
    );

    assert.equal(score.breakdown.diagnosis, 20);
  });

  it("never lets the diagnosis points go negative", () => {
    const wrong: SessionEvent = { type: "DIAGNOSIS_CHECKED", correct: false };
    const score = play(
      ...Array.from({ length: 10 }, () => wrong),
      { type: "DIAGNOSIS_CHECKED", correct: true },
    );

    assert.equal(score.breakdown.diagnosis, 0);
  });

  it("charges hint costs in reveal order", () => {
    const hint: SessionEvent = { type: "HINT_REVEALED" };
    const solve: SessionEvent = { type: "RUN_COMPLETED", report: passingAllReport() };

    assert.equal(play(solve).total, 70);
    assert.equal(play(hint, solve).breakdown.hintPenalty, 5);
    assert.equal(play(hint, hint, solve).breakdown.hintPenalty, 15);
    assert.equal(play(hint, hint, hint, solve).breakdown.hintPenalty, 35);
  });

  it("floors the total at zero when hints cost more than was earned", () => {
    const hint: SessionEvent = { type: "HINT_REVEALED" };
    const score = play(hint, hint, hint);

    assert.equal(score.total, 0);
    assert.equal(score.breakdown.hintPenalty, 35);
  });
});
