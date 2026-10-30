import { describe, expect, it } from "vitest";
import {
  makeChallenge,
  passingAllReport,
  passingVisibleReport,
  visibleOnlyPassReport,
} from "../test-fixtures";
import type { SessionEvent } from "../types";
import { createSession, sessionReducer } from "./reducer";
import { computeScore, maxScore } from "./scoring";

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
    expect(maxScore(rules)).toBe(100);
  });
});

describe("computeScore", () => {
  it("scores zero for a session with no progress", () => {
    expect(play()).toEqual({
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

    expect(score.total).toBe(100);
    expect(score.breakdown).toEqual({
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

    expect(score.total).toBe(55);
  });

  it("keeps visible credit when the player later gives up", () => {
    const score = play(
      { type: "RUN_COMPLETED", report: passingVisibleReport() },
      { type: "REVEALED" },
    );

    expect(score.total).toBe(25);
  });

  it("subtracts each wrong diagnosis from the diagnosis points", () => {
    const score = play(
      { type: "DIAGNOSIS_CHECKED", correct: false },
      { type: "DIAGNOSIS_CHECKED", correct: false },
      { type: "DIAGNOSIS_CHECKED", correct: true },
    );

    expect(score.breakdown.diagnosis).toBe(20);
  });

  it("never lets the diagnosis points go negative", () => {
    const wrong: SessionEvent = { type: "DIAGNOSIS_CHECKED", correct: false };
    const score = play(
      ...Array.from({ length: 10 }, () => wrong),
      { type: "DIAGNOSIS_CHECKED", correct: true },
    );

    expect(score.breakdown.diagnosis).toBe(0);
  });

  it("charges hint costs in reveal order", () => {
    const hint: SessionEvent = { type: "HINT_REVEALED" };
    const solve: SessionEvent = { type: "RUN_COMPLETED", report: passingAllReport() };

    expect(play(solve).total).toBe(70);
    expect(play(hint, solve).breakdown.hintPenalty).toBe(5);
    expect(play(hint, hint, solve).breakdown.hintPenalty).toBe(15);
    expect(play(hint, hint, hint, solve).breakdown.hintPenalty).toBe(35);
  });

  it("floors the total at zero when hints cost more than was earned", () => {
    const hint: SessionEvent = { type: "HINT_REVEALED" };
    const score = play(hint, hint, hint);

    expect(score.total).toBe(0);
    expect(score.breakdown.hintPenalty).toBe(35);
  });
});
