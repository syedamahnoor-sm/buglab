import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSession, sessionReducer } from "@/engine/session/reducer";
import {
  deriveInvestigationStatus,
  type WorkspaceSignals,
} from "@/engine/session/status";
import { makeDiagnosisConfig, makeFixConfig, passingAllReport } from "./fixtures";

const none: WorkspaceSignals = { investigationStarted: false, diagnosisSubmitted: false };
const started: WorkspaceSignals = { investigationStarted: true, diagnosisSubmitted: false };
const submitted: WorkspaceSignals = { investigationStarted: true, diagnosisSubmitted: true };

const open = createSession(makeDiagnosisConfig());
const solved = sessionReducer(open, { type: "DIAGNOSIS_ACCEPTED" });

describe("deriveInvestigationStatus", () => {
  it("is not-started before the learner has begun", () => {
    assert.equal(deriveInvestigationStatus(open, none), "not-started");
  });

  it("is in-progress once investigating, with nothing submitted", () => {
    assert.equal(deriveInvestigationStatus(open, started), "in-progress");
  });

  it("is submitted once a diagnosis was evaluated and not accepted", () => {
    assert.equal(deriveInvestigationStatus(open, submitted), "submitted");
  });

  it("is resolved for a solved session with an accepted diagnosis", () => {
    assert.equal(deriveInvestigationStatus(solved, submitted), "resolved");
  });

  it("is resolved from the session alone, whatever the workspace signals say", () => {
    for (const signals of [none, started, submitted]) {
      assert.equal(deriveInvestigationStatus(solved, signals), "resolved");
    }
  });

  it("treats a diagnosis submission as progress even if started was never set", () => {
    assert.equal(
      deriveInvestigationStatus(open, { investigationStarted: false, diagnosisSubmitted: true }),
      "submitted",
    );
  });

  it("does not resolve a Fix Mode session on a diagnosis alone", () => {
    const diagnosed = sessionReducer(createSession(makeFixConfig()), {
      type: "DIAGNOSIS_ACCEPTED",
    });

    assert.equal(deriveInvestigationStatus(diagnosed, started), "in-progress");
  });

  it("does not resolve a Fix Mode session solved without an accepted diagnosis", () => {
    const fixedOnly = sessionReducer(createSession(makeFixConfig()), {
      type: "RUN_COMPLETED",
      report: passingAllReport(),
    });

    assert.equal(fixedOnly.status, "solved");
    assert.equal(deriveInvestigationStatus(fixedOnly, started), "in-progress");
  });

  it("is a pure function of its inputs", () => {
    const before = structuredClone({ open, started });

    deriveInvestigationStatus(open, started);

    assert.deepEqual({ open, started }, before);
  });
});
