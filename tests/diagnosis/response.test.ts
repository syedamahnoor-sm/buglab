import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isDiagnosisResponse } from "@/lib/diagnosis/response";
import type { DiagnosisResponse, DiagnosisResponseStatus } from "@/types/diagnosis";
import {
  CORRECT_ID,
  WRONG_IDS,
  attemptCookieFrom,
  createTestHandler,
  post,
  submission,
} from "./fixtures";

const feedback = {
  headline: "headline",
  hints: ["one", "two"],
  evidenceSummary: { total: 3, logs: 2, network: 1 },
};
const attempts = { used: 1, limit: 3, remaining: 2, resetsAt: "2026-11-01T10:10:00.000Z" };

// Complete responses, typed against the union so they cannot drift from it.
const valid: { [S in DiagnosisResponseStatus]: Extract<DiagnosisResponse, { status: S }> } = {
  correct: { status: "correct", feedback, resolution: { summary: "fixed" }, attempts },
  incorrect: { status: "incorrect", feedback, attempts },
  invalid: { status: "invalid", errors: [{ field: "rootCauseId", message: "required" }] },
  "rate-limited": { status: "rate-limited", retryAfterSeconds: 60, attempts },
  error: { status: "error", message: "Something went wrong." },
};

type Kind = "string" | "number" | "object" | "array";

// Every field the contract requires, per status, with its type.
const required: Record<DiagnosisResponseStatus, [path: string, kind: Kind][]> = {
  correct: [
    ["feedback", "object"],
    ["feedback.headline", "string"],
    ["feedback.hints", "array"],
    ["feedback.evidenceSummary", "object"],
    ["feedback.evidenceSummary.total", "number"],
    ["feedback.evidenceSummary.logs", "number"],
    ["feedback.evidenceSummary.network", "number"],
    ["resolution", "object"],
    ["resolution.summary", "string"],
    ["attempts", "object"],
    ["attempts.used", "number"],
    ["attempts.limit", "number"],
    ["attempts.remaining", "number"],
  ],
  incorrect: [
    ["feedback", "object"],
    ["feedback.headline", "string"],
    ["feedback.hints", "array"],
    ["feedback.evidenceSummary", "object"],
    ["feedback.evidenceSummary.total", "number"],
    ["feedback.evidenceSummary.logs", "number"],
    ["feedback.evidenceSummary.network", "number"],
    ["attempts", "object"],
    ["attempts.used", "number"],
    ["attempts.limit", "number"],
    ["attempts.remaining", "number"],
  ],
  invalid: [["errors", "array"]],
  "rate-limited": [["retryAfterSeconds", "number"]],
  error: [["message", "string"]],
};

// Candidate wrong values, minus whichever one is right for the field's kind.
const candidates: [label: string, value: unknown, kind: Kind | null][] = [
  ["null", null, null],
  ["number", 42, "number"],
  ["string", "text", "string"],
  ["boolean", true, null],
  ["array", [], "array"],
  ["empty object", {}, null],
];

function withValue(response: object, path: string, value: unknown, remove = false) {
  const copy = structuredClone(response) as Record<string, unknown>;
  const keys = path.split(".");
  let target = copy;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const last = keys[keys.length - 1];
  if (remove) delete target[last];
  else target[last] = value;
  return copy;
}

describe("isDiagnosisResponse: complete responses", () => {
  for (const [status, response] of Object.entries(valid)) {
    test(`accepts a complete ${status} response`, () => {
      assert.equal(isDiagnosisResponse(response), true);
    });
  }

  test("accepts optional fields when absent", () => {
    assert.equal(isDiagnosisResponse(withValue(valid.correct, "attempts.resetsAt", 0, true)), true);
    assert.equal(isDiagnosisResponse(withValue(valid["rate-limited"], "attempts", 0, true)), true);
  });

  test("accepts empty hints and an empty error list", () => {
    assert.equal(isDiagnosisResponse(withValue(valid.incorrect, "feedback.hints", [])), true);
    assert.equal(isDiagnosisResponse(withValue(valid.invalid, "errors", [])), true);
  });

  test("tolerates extra properties so the server can add fields", () => {
    for (const response of Object.values(valid)) {
      assert.equal(isDiagnosisResponse({ ...response, extra: "ok" }), true);
    }
  });
});

describe("isDiagnosisResponse: the server's real responses", () => {
  test("accepts every response shape the handler actually produces", async () => {
    const { handler } = createTestHandler();
    const wrong = submission({ rootCauseId: WRONG_IDS[0] });
    const bodies: [string, Record<string, unknown>][] = [];

    const correct = await post(handler, { body: submission({ rootCauseId: CORRECT_ID }) });
    bodies.push(["correct", correct.json]);
    bodies.push(["invalid (bad field)", (await post(handler, { body: submission({ explanation: "" }) })).json]);
    bodies.push(["invalid (bad JSON)", (await post(handler, { rawBody: "{nope" })).json]);
    bodies.push(["error (415)", (await post(handler, { headers: { "content-type": "text/plain" } })).json]);
    bodies.push(["error (403)", (await post(handler, { headers: { origin: "https://evil.example" } })).json]);
    bodies.push(["error (404)", (await post(handler, { challengeId: "challenge-999" })).json]);
    bodies.push(["error (413)", (await post(handler, { rawBody: "x".repeat(20_000) })).json]);

    // A fresh handler so the attempt cookie and limits start clean.
    const limited = createTestHandler();
    let cookie = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await post(limited.handler, { body: wrong, headers: cookie ? { cookie } : {} });
      cookie = attemptCookieFrom(result.response) || cookie;
      bodies.push([`wrong attempt ${attempt + 1}`, result.json]);
    }

    const statuses = bodies.map(([, body]) => body.status);
    for (const status of ["correct", "incorrect", "invalid", "rate-limited", "error"]) {
      assert.ok(statuses.includes(status), `the handler produced no ${status} response`);
    }
    for (const [label, body] of bodies) {
      assert.equal(isDiagnosisResponse(body), true, label);
    }
  });

  test("accepts the IP-limit rate-limited shape, which has no attempts", () => {
    assert.equal(isDiagnosisResponse({ status: "rate-limited", retryAfterSeconds: 30 }), true);
  });
});

describe("isDiagnosisResponse: malformed values are rejected", () => {
  test("rejects a bare status of every kind", () => {
    for (const status of Object.keys(valid)) {
      assert.equal(isDiagnosisResponse({ status }), false, status);
    }
  });

  test("rejects values that are not objects", () => {
    for (const value of [null, undefined, "correct", 42, true, [], [valid.correct], () => valid.correct]) {
      assert.equal(isDiagnosisResponse(value), false, String(value));
    }
  });

  test("rejects an unknown, missing or mistyped status", () => {
    const base = valid.error;
    for (const status of ["accepted", "CORRECT", "Correct ", "", "constructor", "__proto__", "toString", 5, null, true, {}, []]) {
      assert.equal(isDiagnosisResponse({ ...base, status }), false, JSON.stringify(status));
    }
    assert.equal(isDiagnosisResponse({ message: "no status" }), false);
  });

  for (const [status, fields] of Object.entries(required)) {
    describe(`${status} response`, () => {
      const response = valid[status as DiagnosisResponseStatus];

      for (const [path, kind] of fields) {
        test(`rejects a missing ${path}`, () => {
          assert.equal(isDiagnosisResponse(withValue(response, path, 0, true)), false);
        });

        for (const [label, value, rightKind] of candidates) {
          if (rightKind === kind) continue;
          test(`rejects ${path} as ${label}`, () => {
            assert.equal(isDiagnosisResponse(withValue(response, path, value)), false);
          });
        }
      }
    });
  }

  test("rejects non-finite numbers", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.equal(isDiagnosisResponse(withValue(valid.correct, "attempts.used", value)), false);
      assert.equal(isDiagnosisResponse(withValue(valid["rate-limited"], "retryAfterSeconds", value)), false);
    }
  });

  test("rejects malformed optional fields instead of ignoring them", () => {
    for (const value of [null, 42, true, {}, []]) {
      assert.equal(isDiagnosisResponse(withValue(valid.correct, "attempts.resetsAt", value)), false);
    }
    for (const value of [null, "x", 42, {}, { used: 1 }]) {
      assert.equal(isDiagnosisResponse(withValue(valid["rate-limited"], "attempts", value)), false);
    }
  });

  test("rejects malformed list elements", () => {
    assert.equal(isDiagnosisResponse(withValue(valid.incorrect, "feedback.hints", ["ok", 1])), false);
    assert.equal(isDiagnosisResponse(withValue(valid.incorrect, "feedback.hints", [null])), false);
    for (const errors of [[null], ["x"], [{}], [{ message: "m" }], [{ field: "rootCauseId" }], [{ field: "nope", message: "m" }], [{ field: 1, message: "m" }]]) {
      assert.equal(isDiagnosisResponse({ status: "invalid", errors }), false, JSON.stringify(errors));
    }
  });

  test("rejects a response that carries another status's fields only", () => {
    assert.equal(isDiagnosisResponse({ status: "correct", message: "text" }), false);
    assert.equal(isDiagnosisResponse({ status: "error", feedback, attempts }), false);
    assert.equal(isDiagnosisResponse({ status: "incorrect", resolution: { summary: "s" }, attempts }), false);
  });

  test("never throws on hostile input", () => {
    const hostile = [Object.create(null), { status: Symbol("x") }, new Date(), new Map(), { get status() { return "correct"; } }];
    for (const value of hostile) assert.doesNotThrow(() => isDiagnosisResponse(value));
  });
});
