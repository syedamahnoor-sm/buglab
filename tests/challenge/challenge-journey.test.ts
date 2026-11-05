/*
 * The learner journey around one challenge: an honest status and the links
 * offered after a confirmed diagnosis. Rendered with React's server renderer,
 * so these cover the initial render; the transitions themselves are the
 * engine's deriveInvestigationStatus, driven here with the journey's signals.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChallengeJourney, hasRecordedWork, useChallengeJourney, type ChallengeLink } from "@/components/challenge/ChallengeJourney";
import { challenge001 } from "@/data/challenge-001";
import { useChallengeSession } from "@/engine/client/useChallengeSession";
import { deriveInvestigationStatus } from "@/engine/session/status";

function Probe() {
  const { status } = useChallengeSession();
  const journey = useChallengeJourney();
  return createElement("output", {
    "data-status": status,
    "data-library": journey?.libraryHref,
    "data-next": journey?.next?.href ?? "none",
    "data-mark": typeof journey?.markInvestigationStarted,
  });
}

const Journey = ChallengeJourney as FunctionComponent<{ challenge: typeof challenge001.challenge; libraryHref: string; next: ChallengeLink | null; children?: ReactNode }>;
const render = (next: ChallengeLink | null) =>
  renderToStaticMarkup(createElement(Journey, { challenge: challenge001.challenge, libraryHref: "/challenges", next }, createElement(Probe)));
const attr = (markup: string, name: string) => markup.match(new RegExp(`data-${name}="([^"]*)"`))?.[1];

describe("investigation status", () => {
  test("opening a challenge is not investigating it", () => {
    assert.equal(attr(render(null), "status"), "not-started");
  });

  test("recording evidence, a hypothesis or an observation starts it; nothing else does", () => {
    const none = { evidence: [], hypotheses: [], observations: [] };
    assert.equal(hasRecordedWork(none), false);
    assert.equal(hasRecordedWork({ ...none, evidence: [{}] }), true);
    assert.equal(hasRecordedWork({ ...none, hypotheses: [{}] }), true);
    assert.equal(hasRecordedWork({ ...none, observations: [{}] }), true);
  });

  test("not started, then investigating, then submitted after a wrong diagnosis, then resolved", () => {
    const unsolved = { status: "in_progress", diagnosed: false } as const;
    assert.equal(deriveInvestigationStatus(unsolved, { investigationStarted: false, diagnosisSubmitted: false }), "not-started");
    assert.equal(deriveInvestigationStatus(unsolved, { investigationStarted: true, diagnosisSubmitted: false }), "in-progress");
    assert.equal(deriveInvestigationStatus(unsolved, { investigationStarted: true, diagnosisSubmitted: true }), "submitted");
    assert.equal(deriveInvestigationStatus({ status: "solved", diagnosed: true }, { investigationStarted: true, diagnosisSubmitted: true }), "resolved");
  });

  test("nothing is stored: the journey keeps no browser storage and the status restarts on every page load", () => {
    const source = readFileSync(new URL("../../src/components/challenge/ChallengeJourney.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(/);
  });
});

describe("links after a confirmed diagnosis", () => {
  test("offer the library and the next challenge", () => {
    const markup = render({ href: "/challenges/challenge-002", number: "002", title: "Reports Visible to Everyone" });
    assert.equal(attr(markup, "library"), "/challenges");
    assert.equal(attr(markup, "next"), "/challenges/challenge-002");
    assert.equal(attr(markup, "mark"), "function");
  });

  test("the last challenge has no next link", () => {
    assert.equal(attr(render(null), "next"), "none");
  });

  test("the result panel shows them only for a correct diagnosis, below the resolution", () => {
    const source = readFileSync(new URL("../../src/components/workspace/diagnosis/DiagnosisResult.tsx", import.meta.url), "utf8");
    const correct = source.slice(source.indexOf('response?.status === "correct"'), source.indexOf('response?.status === "incorrect"'));
    assert.ok(correct.indexOf("resolution.summary") < correct.indexOf("<NextSteps />"), "resolution first, then next steps");
    assert.equal(source.match(/<NextSteps \/>/g)?.length, 1, "only in the correct branch");
    assert.match(source, /<nav aria-label="Next steps"/);
    assert.match(source, /That was the last challenge in the library\./);
  });
});
