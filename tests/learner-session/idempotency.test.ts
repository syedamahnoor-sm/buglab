import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSubmissionKeys, randomUuid, submissionFingerprint } from "@/lib/learner-session/idempotency";
import type { DiagnosisSubmission } from "@/types/diagnosis";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const base: DiagnosisSubmission = {
  rootCauseId: "opt-a",
  explanation: "The cookie is not sent with the follow-up requests.",
  evidence: [
    { kind: "log", logId: "log-01" },
    { kind: "network", requestId: "req-02" },
  ],
};

/** Keys from a counter, so tests can tell them apart. */
function keys() {
  let n = 0;
  return createSubmissionKeys(() => `key-${++n}`);
}

describe("one key per logical submission", () => {
  test("a retry of the same submission reuses its key", () => {
    const tracker = keys();
    const first = tracker.keyFor(base);
    assert.equal(tracker.keyFor(structuredClone(base)), first);
    assert.equal(tracker.keyFor(base), first);
  });

  test("any real change gets a new key", () => {
    const tracker = keys();
    const first = tracker.keyFor(base);
    const changed = [
      { ...base, rootCauseId: "opt-b" },
      { ...base, explanation: base.explanation + " More detail." },
      { ...base, evidence: [base.evidence[0]] },
      { ...base, evidence: [...base.evidence, { kind: "log", logId: "log-03" } as const] },
    ];
    const seen = new Set([first]);
    for (const submission of changed) {
      const key = tracker.keyFor(submission);
      assert.ok(!seen.has(key), JSON.stringify(submission));
      seen.add(key);
    }
  });

  test("going back to an earlier submission is a new submission, with a new key", () => {
    const tracker = keys();
    const first = tracker.keyFor(base);
    tracker.keyFor({ ...base, rootCauseId: "opt-b" });
    assert.notEqual(tracker.keyFor(base), first);
  });

  test("what the server treats as the same submission keeps the key", () => {
    const tracker = keys();
    const first = tracker.keyFor(base);
    // Evidence order and duplicates, CRLF line ends and surrounding whitespace do not change it.
    assert.equal(tracker.keyFor({ ...base, evidence: [...base.evidence].reverse() }), first);
    assert.equal(tracker.keyFor({ ...base, evidence: [...base.evidence, base.evidence[0]] }), first);
    assert.equal(tracker.keyFor({ ...base, explanation: `  ${base.explanation}\r\n` }), first);
  });

  test("reset forgets the key, so the next submission is new even if identical", () => {
    const tracker = keys();
    const first = tracker.keyFor(base);
    tracker.reset();
    assert.notEqual(tracker.keyFor(base), first);
  });

  test("the fingerprint is the server's notion of sameness: cause, normalised explanation, evidence set", () => {
    assert.equal(
      submissionFingerprint({ ...base, explanation: "a\r\nb  " }),
      submissionFingerprint({ ...base, explanation: "a\nb" }),
    );
    assert.notEqual(submissionFingerprint(base), submissionFingerprint({ ...base, rootCauseId: "x" }));
  });
});

describe("randomUuid", () => {
  test("is a version-4 UUID, different each time", () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomUuid()));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.match(id, UUID);
  });

  test("falls back to getRandomValues when randomUUID is missing", (t) => {
    const original = globalThis.crypto;
    t.after(() => Object.defineProperty(globalThis, "crypto", { value: original, configurable: true }));
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: (array: Uint8Array) => original.getRandomValues(array) },
      configurable: true,
    });
    assert.match(randomUuid(), UUID);
  });

  test("the default tracker uses UUIDs the server accepts", () => {
    assert.match(createSubmissionKeys().keyFor(base), UUID);
  });
});
