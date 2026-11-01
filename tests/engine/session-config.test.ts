import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { challenge001 } from "@/data/challenge-001";
import { createSession } from "@/engine/session/reducer";
import { sessionConfigForChallenge } from "@/engine/session/config";

describe("sessionConfigForChallenge", () => {
  it("builds a diagnosis-mode config for Challenge 001", () => {
    assert.deepEqual(sessionConfigForChallenge(challenge001.challenge), {
      challengeId: "challenge-001",
      completion: "diagnosis",
    });
  });

  it("creates an open diagnosis session for Challenge 001", () => {
    const session = createSession(sessionConfigForChallenge(challenge001.challenge));

    assert.equal(session.challengeId, "challenge-001");
    assert.equal(session.completion, "diagnosis");
    assert.equal(session.status, "in_progress");
    assert.equal(session.diagnosed, false);
    assert.deepEqual(session.files, {});
  });

  it("refuses a Fix Mode challenge instead of pretending Fix Mode exists", () => {
    assert.throws(
      () => sessionConfigForChallenge({ ...challenge001.challenge, completion: "fix" }),
      /Fix Mode is not implemented/,
    );
  });
});
