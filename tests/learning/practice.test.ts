/*
 * Observed solves and Apply: suggestions from public metadata, and a status
 * that is derived from confirmed solves, never awarded for a click.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { EMPTY_RECORD } from "@/lib/learning/model";
import { practiceFor, practiceStatus, recordPracticeOpened, relationReasons, suggestRelated } from "@/lib/learning/practice";
import { isSolved, recordObservedSolve } from "@/lib/learning/solves";

const published = listPublishedChallenges();
const at = (minute: number) => new Date(2026, 10, 5, 10, minute);
const byId = (id: string) => published.find((challenge) => challenge.id === id)!;

describe("observed solves", () => {
  test("a confirmed solve is recorded once per confirmation; solving again updates the same record", () => {
    let record = recordObservedSolve(EMPTY_RECORD, "challenge-001", at(0));
    assert.ok(isSolved(record, "challenge-001"));
    record = recordObservedSolve(record, "challenge-001", at(30));
    assert.deepEqual(record.solves["challenge-001"], {
      challengeId: "challenge-001",
      firstSolvedAt: at(0).toISOString(),
      lastSolvedAt: at(30).toISOString(),
      timesSolved: 2,
      source: "browser",
    });
  });

  test("nothing else creates a solve: an unsolved challenge stays unsolved", () => {
    assert.equal(isSolved(EMPTY_RECORD, "challenge-001"), false);
  });
});

describe("suggestions (public metadata only)", () => {
  const target = byId("challenge-016");

  test("never the challenge itself, always published, with reasons from its metadata", () => {
    const suggestion = suggestRelated(target, published)!;
    assert.notEqual(suggestion.challenge.id, target.id);
    assert.ok(published.some((challenge) => challenge.id === suggestion.challenge.id));
    assert.ok(suggestion.reasons.length > 0);
    assert.ok(suggestion.reasons.every((reason) => /^(Same category|Shared technologies|Shared topics): /.test(reason)));
  });

  test("the same for every learner, except that challenges already solved here are skipped", () => {
    const first = suggestRelated(target, published)!;
    const skipped = suggestRelated(target, published, new Set([first.challenge.id]))!;
    assert.notEqual(skipped.challenge.id, first.challenge.id);
    assert.deepEqual(suggestRelated(target, published), first, "deterministic");
  });

  test("reasons name the shared category, technologies and topics", () => {
    assert.deepEqual(relationReasons(target, target).slice(0, 1), ["Same category: Databases & Data Integrity"]);
  });

  test("returns null when nothing relates", () => {
    const lonely = { ...published[0], id: "x", category: "security" as const, technologies: ["Nothing"], tags: ["None"] };
    assert.equal(suggestRelated(lonely, [lonely]), null);
  });
});

describe("the Apply status is derived from facts", () => {
  const from = "challenge-016";
  const to = "challenge-019";

  test("shown but not opened: suggested", () => {
    assert.equal(practiceStatus(EMPTY_RECORD, from, to), "suggested");
  });

  test("opening the suggestion is recorded, but a click is only 'opened', never applied", () => {
    const record = recordPracticeOpened(EMPTY_RECORD, from, to, at(0));
    assert.equal(practiceStatus(record, from, to), "opened");
  });

  test("applied only after a confirmed solve of the suggested challenge that came after it was opened", () => {
    const opened = recordPracticeOpened(EMPTY_RECORD, from, to, at(10));
    assert.equal(practiceStatus(recordObservedSolve(opened, to, at(20)), from, to), "applied");
  });

  test("a solve from before the suggestion was opened does not count", () => {
    const solvedEarlier = recordObservedSolve(EMPTY_RECORD, to, at(0));
    assert.equal(practiceStatus(recordPracticeOpened(solvedEarlier, from, to, at(10)), from, to), "opened");
  });

  test("solving it again after opening does count", () => {
    let record = recordObservedSolve(EMPTY_RECORD, to, at(0));
    record = recordPracticeOpened(record, from, to, at(10));
    record = recordObservedSolve(record, to, at(20));
    assert.equal(practiceStatus(record, from, to), "applied");
  });

  test("an opened or applied case stays on show; it is not replaced by a fresh suggestion once solved", () => {
    const source = byId(from);
    const fresh = practiceFor(EMPTY_RECORD, source, published)!;
    assert.equal(fresh.status, "suggested");
    let record = recordPracticeOpened(EMPTY_RECORD, from, fresh.challenge.id, at(10));
    assert.deepEqual([practiceFor(record, source, published)!.challenge.id, practiceFor(record, source, published)!.status], [fresh.challenge.id, "opened"]);
    record = recordObservedSolve(record, fresh.challenge.id, at(20));
    const after = practiceFor(record, source, published)!;
    assert.deepEqual([after.challenge.id, after.status], [fresh.challenge.id, "applied"], "the applied case is still the one shown");
    assert.ok(after.reasons.length > 0);
  });

  test("without a practice link, the suggestion skips challenges already solved here", () => {
    const source = byId(from);
    const first = practiceFor(EMPTY_RECORD, source, published)!;
    const next = practiceFor(recordObservedSolve(EMPTY_RECORD, first.challenge.id, at(0)), source, published)!;
    assert.notEqual(next.challenge.id, first.challenge.id);
    assert.equal(next.status, "suggested");
  });

  test("re-opening keeps the first time, and a challenge cannot be practice for itself", () => {
    const once = recordPracticeOpened(EMPTY_RECORD, from, to, at(0));
    assert.equal(recordPracticeOpened(once, from, to, at(5)), once);
    assert.equal(recordPracticeOpened(EMPTY_RECORD, from, from, at(0)), EMPTY_RECORD);
  });
});
