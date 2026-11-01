/*
 * These tests render with React's server renderer, so they cover the hook's
 * INITIAL RENDER only. Submitting, loading, retry, reset, duplicate-submission
 * handling and unmount/abort behaviour all depend on effects, state updates or
 * async work, which the server renderer never runs; they need a DOM or browser
 * renderer.
 */
import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useDiagnosisSubmission } from "@/components/workspace/diagnosis/useDiagnosisSubmission";
import type { DiagnosisResponse } from "@/types/diagnosis";

interface ProbeProps {
  onResponse?: (response: DiagnosisResponse) => void;
}

// Writes what the hook returns into data attributes so a test can assert on them.
function SubmissionProbe({ onResponse }: ProbeProps) {
  const { state, submit, retry, reset } = useDiagnosisSubmission("challenge-001", onResponse);
  return createElement("output", {
    "data-phase": state.phase,
    "data-state-keys": Object.keys(state).join(","),
    "data-actions": [typeof submit, typeof retry, typeof reset].join(","),
  });
}

function attributesOf(markup: string): Record<string, string> {
  return Object.fromEntries(
    [...markup.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
  );
}

describe("useDiagnosisSubmission: initial render", () => {
  test("starts in the idle phase with no response or retry time", () => {
    const rendered = attributesOf(renderToStaticMarkup(createElement(SubmissionProbe)));

    assert.equal(rendered.phase, "idle");
    assert.equal(rendered["state-keys"], "phase");
  });

  test("returns submit, retry and reset functions", () => {
    const rendered = attributesOf(renderToStaticMarkup(createElement(SubmissionProbe)));

    assert.equal(rendered.actions, "function,function,function");
  });

  test("does not call onResponse while rendering", () => {
    const received: DiagnosisResponse[] = [];

    const rendered = attributesOf(
      renderToStaticMarkup(
        createElement(SubmissionProbe, { onResponse: (response) => received.push(response) }),
      ),
    );

    assert.equal(rendered.phase, "idle");
    assert.equal(received.length, 0);
  });

  test("makes no network request while rendering", () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response("{}"));
    try {
      renderToStaticMarkup(createElement(SubmissionProbe));

      assert.equal(fetchMock.mock.callCount(), 0);
    } finally {
      fetchMock.mock.restore();
    }
  });
});
