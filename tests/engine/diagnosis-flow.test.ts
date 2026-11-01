/*
 * End to end below the React layer: the real client (submitDiagnosis), the real
 * server handler with its real limiters, and the engine progress transition the
 * workspace runs through its onResponse callback. Only the network is stubbed.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { submitDiagnosis } from "@/lib/diagnosis/client";
import { applyDiagnosisResponse, createProgress, progressStatus } from "@/engine/session/progress";
import type { LearnerProgress } from "@/engine/session/progress";
import type { DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";
import {
  CHALLENGE_ID,
  CORRECT_ID,
  WRONG_IDS,
  attemptCookieFrom,
  createTestHandler,
  submission,
} from "../diagnosis/fixtures";
import { makeDiagnosisConfig } from "./fixtures";

const realFetch = globalThis.fetch;
let handler: ReturnType<typeof createTestHandler>["handler"];
let cookie = "";
let offline = false;
let forcedBody: { value: unknown; status: number } | null = null;
let lastServerText = "";

beforeEach(() => {
  ({ handler } = createTestHandler());
  cookie = "";
  offline = false;
  forcedBody = null;
  lastServerText = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (offline) throw new TypeError("fetch failed");
    if (forcedBody) {
      return new Response(JSON.stringify(forcedBody.value), {
        status: forcedBody.status,
        headers: { "content-type": "application/json" },
      });
    }
    const request = new Request(`http://localhost:3000${String(input)}`, {
      method: init?.method,
      body: init?.body,
      headers: { ...(init?.headers as Record<string, string>), host: "localhost:3000", cookie },
    });
    const response = await handler(request, { params: Promise.resolve({ challengeId: CHALLENGE_ID }) });
    cookie = attemptCookieFrom(response) || cookie;
    lastServerText = await response.clone().text();
    return response;
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// What the workspace does: the hook's submit() gets this response, then calls onResponse.
async function submitAndRecord(progress: LearnerProgress, body: DiagnosisSubmission) {
  const response = await submitDiagnosis(CHALLENGE_ID, body);
  return { response, progress: applyDiagnosisResponse(progress, response) };
}

const start = createProgress(makeDiagnosisConfig());
const wrong = () => submission({ rootCauseId: WRONG_IDS[0] });
const right = () => submission({ rootCauseId: CORRECT_ID });
const status = (progress: LearnerProgress) => progressStatus(progress, true);

describe("diagnosis submission flow into the engine session", () => {
  it("a correct answer solves the session and resolves the status", async () => {
    const { response, progress } = await submitAndRecord(start, right());

    assert.equal(response.status, "correct");
    assert.equal(progress.session.status, "solved");
    assert.equal(status(progress), "resolved");
  });

  it("an incorrect answer leaves the session untouched but becomes submitted", async () => {
    const { response, progress } = await submitAndRecord(start, wrong());

    assert.equal(response.status, "incorrect");
    assert.equal(progress.session, start.session);
    assert.equal(status(progress), "submitted");
  });

  it("an invalid submission changes neither session nor progress", async () => {
    const { response, progress } = await submitAndRecord(start, submission({ explanation: "" }));

    assert.equal(response.status, "invalid");
    assert.equal(progress, start);
  });

  it("a network failure changes neither session nor progress", async () => {
    offline = true;
    const { response, progress } = await submitAndRecord(start, wrong());

    assert.equal(response.status, "error");
    assert.equal(progress, start);
  });

  it("the server's attempt limit is rate-limited, never counted by the engine", async () => {
    let progress = start;
    const statuses: string[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await submitAndRecord(progress, wrong());
      progress = result.progress;
      statuses.push(result.response.status);
    }

    assert.deepEqual(statuses, ["incorrect", "incorrect", "incorrect", "rate-limited"]);
    assert.equal(progress.session, start.session);
    assert.equal(status(progress), "submitted");
  });

  it("a blocked correct answer is rate-limited and does not solve the session", async () => {
    let progress = start;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      progress = (await submitAndRecord(progress, wrong())).progress;
    }
    const blocked = await submitAndRecord(progress, right());

    assert.equal(blocked.response.status, "rate-limited");
    assert.equal(blocked.progress, progress);
    assert.equal(status(blocked.progress), "submitted");
  });

  it("a correct answer after an incorrect one resolves the status", async () => {
    const first = await submitAndRecord(start, wrong());
    const second = await submitAndRecord(first.progress, right());

    assert.equal(status(first.progress), "submitted");
    assert.equal(second.response.status, "correct");
    assert.equal(status(second.progress), "resolved");
  });

  it("a valid response reaches the engine exactly as the server sent it", async () => {
    for (const body of [wrong(), right()]) {
      const { response } = await submitAndRecord(start, body);

      assert.deepEqual(response, JSON.parse(lastServerText));
    }
  });

  it("a malformed server response is an error and can never resolve the challenge", async () => {
    const malformed = [
      { status: "correct" },
      { status: "correct", feedback: null, resolution: null, attempts: null },
      { status: "correct", feedback: { headline: "Diagnosis confirmed." } },
      { status: "incorrect" },
      { status: "rate-limited" },
      { status: "accepted" },
      { ok: true },
      "correct",
      [],
      null,
    ];

    for (const value of malformed) {
      forcedBody = { value, status: 200 };
      const { response, progress } = await submitAndRecord(start, right());

      assert.equal(response.status, "error", JSON.stringify(value));
      assert.match(response.status === "error" ? response.message : "", /Unexpected response/);
      assert.equal(progress, start, JSON.stringify(value));
      assert.equal(status(progress), "in-progress");
      assert.equal(progress.session.status, "in_progress");
    }
  });

  it("a malformed response after a rejected attempt keeps the submitted status", async () => {
    const first = await submitAndRecord(start, wrong());
    forcedBody = { value: { status: "correct" }, status: 200 };
    const second = await submitAndRecord(first.progress, right());

    assert.equal(second.response.status, "error");
    assert.equal(second.progress, first.progress);
    assert.equal(status(second.progress), "submitted");
  });

  it("the engine does not modify the response it is given", async () => {
    const response: DiagnosisResponse = await submitDiagnosis(CHALLENGE_ID, right());
    const before = structuredClone(response);

    applyDiagnosisResponse(start, response);

    assert.deepEqual(response, before);
  });
});
