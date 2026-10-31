import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_BODY_BYTES } from "@/server/diagnosis/handler";
import {
  CORRECT_ID,
  CORRECT_LABEL,
  RESOLUTION,
  WRONG_IDS,
  attemptCookieFrom,
  createTestHandler,
  post,
  submission,
} from "./fixtures";

function assertNoAnswer(text: string) {
  assert.equal(text.includes(CORRECT_ID), false, "response leaks the correct option id");
  assert.equal(text.includes(CORRECT_LABEL), false, "response leaks the correct option label");
  assert.equal(text.includes(RESOLUTION), false, "response leaks the resolution");
}

describe("POST /api/challenges/:id/diagnosis: request checks", () => {
  test("rejects non-JSON content types with 415", async () => {
    const { handler } = createTestHandler();
    const { response, json } = await post(handler, { headers: { "content-type": "text/plain" } });
    assert.equal(response.status, 415);
    assert.equal(json.status, "error");
  });

  test("rejects cross-origin submissions with 403", async () => {
    const { handler } = createTestHandler();
    const { response } = await post(handler, { headers: { origin: "https://evil.example" } });
    assert.equal(response.status, 403);
    const sameOrigin = await post(handler, { headers: { origin: "http://localhost:3000" } });
    assert.equal(sameOrigin.response.status, 200);
  });

  test("rejects unknown challenges with 404", async () => {
    const { handler } = createTestHandler();
    const { response, text } = await post(handler, { challengeId: "challenge-999" });
    assert.equal(response.status, 404);
    assertNoAnswer(text);
  });

  test("rejects oversized bodies with 413", async () => {
    const { handler } = createTestHandler();
    const rawBody = JSON.stringify({ ...submission(), padding: "x".repeat(MAX_BODY_BYTES) });
    const { response } = await post(handler, { rawBody });
    assert.equal(response.status, 413);
  });

  test("rejects malformed JSON with 400", async () => {
    const { handler } = createTestHandler();
    const { response, json } = await post(handler, { rawBody: "{not json" });
    assert.equal(response.status, 400);
    assert.equal(json.status, "invalid");
  });

  test("rejects invalid submissions with 400 and field errors, without counting an attempt", async () => {
    const { handler } = createTestHandler();
    for (let index = 0; index < 5; index += 1) {
      const { response, json, text } = await post(handler, {
        body: { rootCauseId: "nope", explanation: "short", evidence: [{ kind: "log", logId: "log-99" }] },
      });
      assert.equal(response.status, 400);
      const fields = (json.errors as { field: string }[]).map((error) => error.field);
      assert.deepEqual(fields, ["rootCauseId", "explanation", "evidence"]);
      assertNoAnswer(text);
    }
    // Invalid requests did not use up attempts.
    const { response } = await post(handler);
    assert.equal(response.status, 200);
  });

  test("requires at least one evidence reference", async () => {
    const { handler } = createTestHandler();
    const { response } = await post(handler, { body: submission({ evidence: [] }) });
    assert.equal(response.status, 400);
  });
});

describe("POST /api/challenges/:id/diagnosis: evaluation", () => {
  test("incorrect diagnoses get generic feedback and attempt counts, never the answer", async () => {
    const { handler } = createTestHandler();
    const { response, json, text } = await post(handler, { body: submission({ rootCauseId: WRONG_IDS[0] }) });
    assert.equal(response.status, 200);
    assert.equal(json.status, "incorrect");
    assert.deepEqual(json.attempts, {
      used: 1,
      limit: 3,
      remaining: 2,
      resetsAt: "2026-10-31T10:10:00.000Z",
    });
    assert.equal("resolution" in json, false);
    assertNoAnswer(text);
  });

  test("correct diagnoses return the resolution summary", async () => {
    const { handler } = createTestHandler();
    const { response, json } = await post(handler, { body: submission({ rootCauseId: CORRECT_ID }) });
    assert.equal(response.status, 200);
    assert.equal(json.status, "correct");
    assert.deepEqual(json.resolution, { summary: RESOLUTION });
    assert.equal("score" in json, false);
  });

  test("a client-supplied correctness flag is ignored", async () => {
    const { handler } = createTestHandler();
    const { json, text } = await post(handler, {
      body: { ...submission({ rootCauseId: WRONG_IDS[1] }), correct: true, status: "correct" },
    });
    assert.equal(json.status, "incorrect");
    assertNoAnswer(text);
  });

  test("responses are never cached and issue an HttpOnly attempt cookie", async () => {
    const { handler } = createTestHandler();
    const { response } = await post(handler);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^buglab_attempt=[0-9a-f-]{36}; Path=\/api; Max-Age=86400; HttpOnly; SameSite=Strict$/);
  });
});

describe("POST /api/challenges/:id/diagnosis: attempt limiting", () => {
  test("blocks after 3 wrong attempts, without revealing whether the next guess is right", async () => {
    const { handler, advance } = createTestHandler();
    const first = await post(handler, { body: submission({ rootCauseId: WRONG_IDS[0] }) });
    const cookie = attemptCookieFrom(first.response);

    for (const rootCauseId of [WRONG_IDS[1], WRONG_IDS[2]]) {
      const { json } = await post(handler, { body: submission({ rootCauseId }), headers: { cookie } });
      assert.equal(json.status, "incorrect");
    }

    // The correct answer is now blocked exactly like a wrong one.
    const blockedCorrect = await post(handler, { body: submission({ rootCauseId: CORRECT_ID }), headers: { cookie } });
    const blockedWrong = await post(handler, { body: submission({ rootCauseId: WRONG_IDS[3] }), headers: { cookie } });
    for (const { response, json, text } of [blockedCorrect, blockedWrong]) {
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("retry-after"), "600");
      assert.equal(json.status, "rate-limited");
      assertNoAnswer(text);
    }
    assert.equal(blockedCorrect.text, blockedWrong.text);

    advance(10 * 60_000);
    const afterWindow = await post(handler, { body: submission({ rootCauseId: CORRECT_ID }), headers: { cookie } });
    assert.equal(afterWindow.json.status, "correct");
  });

  test("a forged attempt cookie is replaced, not trusted", async () => {
    const { handler } = createTestHandler();
    const { response } = await post(handler, { headers: { cookie: "buglab_attempt=../../admin" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie") ?? "", /^buglab_attempt=[0-9a-f-]{36};/);
  });

  test("X-Forwarded-For is ignored without a trusted proxy configuration", async () => {
    const { handler } = createTestHandler({ trustedProxyHops: 0 });
    for (let index = 0; index < 12; index += 1) {
      // New attempt cookie every time, same claimed IP: no IP limit applies.
      const { response } = await post(handler, { headers: { "x-forwarded-for": "198.51.100.7" } });
      assert.equal(response.status, 200);
    }
  });

  test("with a trusted proxy, the client IP is limited even when cookies are discarded", async () => {
    const { handler } = createTestHandler({ trustedProxyHops: 1 });
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const { response } = await post(handler, {
        // Rotating spoofed left-most entries must not create new buckets.
        headers: { "x-forwarded-for": `10.0.0.${index}, 198.51.100.7` },
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429);
  });
});
