/*
 * These tests render with React's server renderer, so they cover each unit's
 * INITIAL RENDER only. Effects, state updates, async work and unmounting never
 * run on the server renderer; anything that needs them (for example a diagnosis
 * response changing the status) needs a DOM or browser renderer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, type ComponentProps, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { challenge001 } from "@/data/challenge-001";
import { ChallengeSessionProvider } from "@/engine/client/ChallengeSessionProvider";
import { useChallengeSession } from "@/engine/client/useChallengeSession";
import { sessionConfigForChallenge } from "@/engine/session/config";

// Writes what the context exposes into data attributes so a test can assert on them.
function ContextProbe() {
  const { status, session, recordDiagnosisResponse } = useChallengeSession();
  return createElement("output", {
    "data-status": status,
    "data-session-status": session.status,
    "data-completion": session.completion,
    "data-diagnosed": String(session.diagnosed),
    "data-challenge-id": session.challengeId,
    "data-record": typeof recordDiagnosisResponse,
  });
}

function attributesOf(markup: string): Record<string, string> {
  return Object.fromEntries(
    [...markup.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
  );
}

const config = sessionConfigForChallenge(challenge001.challenge);

// createElement takes children as extra arguments (the react/no-children-prop rule
// forbids passing them as a prop), but the provider's props declare `children` as
// required. This view of the same component leaves it out of the props type.
const Provider = ChallengeSessionProvider as FunctionComponent<
  Omit<ComponentProps<typeof ChallengeSessionProvider>, "children">
>;

function renderInsideProvider(investigationStarted: boolean) {
  return attributesOf(
    renderToStaticMarkup(
      createElement(Provider, { config, investigationStarted }, createElement(ContextProbe)),
    ),
  );
}

describe("ChallengeSessionProvider: initial render", () => {
  it("starts Challenge 001 as an open diagnosis session, in-progress when investigation has started", () => {
    assert.deepEqual(renderInsideProvider(true), {
      status: "in-progress",
      "session-status": "in_progress",
      completion: "diagnosis",
      diagnosed: "false",
      "challenge-id": "challenge-001",
      record: "function",
    });
  });

  it("reports not-started when investigation has not started, with the same open session", () => {
    assert.deepEqual(renderInsideProvider(false), {
      status: "not-started",
      "session-status": "in_progress",
      completion: "diagnosis",
      diagnosed: "false",
      "challenge-id": "challenge-001",
      record: "function",
    });
  });

  it("lets investigationStarted change only the status, never the session", () => {
    const started = renderInsideProvider(true);
    const notStarted = renderInsideProvider(false);

    assert.notEqual(started.status, notStarted.status);
    assert.deepEqual({ ...started, status: "" }, { ...notStarted, status: "" });
  });

  it("starts with nothing solved or diagnosed, whatever the investigation signal", () => {
    for (const started of [true, false]) {
      const rendered = renderInsideProvider(started);

      assert.equal(rendered["session-status"], "in_progress");
      assert.equal(rendered.diagnosed, "false");
      assert.notEqual(rendered.status, "resolved");
      assert.notEqual(rendered.status, "submitted");
    }
  });
});

describe("useChallengeSession: initial render", () => {
  it("throws a clear error when used outside ChallengeSessionProvider", () => {
    assert.throws(
      () => renderToStaticMarkup(createElement(ContextProbe)),
      /useChallengeSession must be used inside ChallengeSessionProvider/,
    );
  });
});
