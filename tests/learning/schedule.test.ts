/*
 * Calendar-day recall: 1, 3, then 7 local days; overdue reviews; repeated
 * reviews on one day; reflection gating, editing and deleting.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, daysBetween, localDay } from "@/lib/learning/days";
import { EMPTY_RECORD, LIMITS, type LearningRecord } from "@/lib/learning/model";
import {
  clearReflections,
  deleteReflection,
  dueReflections,
  INTERVAL_DAYS,
  isDue,
  nextUpcoming,
  recordRecall,
  ReflectionError,
  saveReflection,
} from "@/lib/learning/schedule";
import { recordObservedSolve } from "@/lib/learning/solves";

const at = (day: number, hour = 10, minute = 0) => new Date(2026, 10, day, hour, minute);
const reflection = { takeaway: "Aggregate after the join.", cause: "A join repeated rows" };
const solved = (id = "challenge-001", when = at(5)): LearningRecord => recordObservedSolve(EMPTY_RECORD, id, when);
const reflected = (when = at(5)) => saveReflection(solved(), "challenge-001", reflection, when);
const recall = (record: LearningRecord) => record.reflections["challenge-001"].recall;

describe("calendar days", () => {
  test("a local day is the calendar date where the learner is", () => {
    assert.equal(localDay(at(5, 23, 59)), "2026-11-05");
    assert.equal(localDay(at(6, 0, 1)), "2026-11-06");
  });

  test("adding days crosses month, year and leap-day boundaries by the calendar", () => {
    assert.equal(addDays("2026-11-30", 1), "2026-12-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });

  test("daylight-saving changes cannot shift a day", () => {
    // Late March and late October change the clocks in many zones; days are counted by date, not hours.
    assert.equal(addDays("2026-03-28", 3), "2026-03-31");
    assert.equal(addDays("2026-10-24", 3), "2026-10-27");
    assert.equal(daysBetween("2026-03-28", "2026-03-31"), 3);
    assert.equal(daysBetween("2026-11-07", "2026-11-05"), -2);
  });
});

describe("the recall schedule", () => {
  test("a reflection written late at night is due the next morning, not 24 hours later", () => {
    const record = reflected(at(5, 23, 50));
    assert.deepEqual(INTERVAL_DAYS, [1, 3, 7]);
    assert.equal(recall(record).dueOn, "2026-11-06");
    assert.equal(isDue(record.reflections["challenge-001"], "2026-11-05"), false);
    assert.equal(isDue(record.reflections["challenge-001"], "2026-11-06"), true);
  });

  test("Got it moves to 3 days, then 7, and stays at 7", () => {
    let record = reflected();
    record = recordRecall(record, "challenge-001", "got-it", at(6));
    assert.equal(recall(record).dueOn, "2026-11-09");
    record = recordRecall(record, "challenge-001", "got-it", at(9));
    assert.equal(recall(record).dueOn, "2026-11-16");
    record = recordRecall(record, "challenge-001", "got-it", at(16));
    assert.equal(recall(record).dueOn, "2026-11-23");
    assert.equal(recall(record).stage, 2);
  });

  test("Need practice goes back to 1 day", () => {
    let record = recordRecall(reflected(), "challenge-001", "got-it", at(6));
    record = recordRecall(record, "challenge-001", "need-practice", at(9));
    assert.equal(recall(record).stage, 0);
    assert.equal(recall(record).dueOn, "2026-11-10");
  });

  test("an overdue review is scheduled from the day it is done, not from the missed day", () => {
    const record = recordRecall(reflected(), "challenge-001", "got-it", at(20));
    assert.equal(recall(record).dueOn, "2026-11-23");
  });

  test("several reviews on one day count once: the latest response replaces the earlier one", () => {
    let record = reflected();
    record = recordRecall(record, "challenge-001", "got-it", at(6, 9));
    record = recordRecall(record, "challenge-001", "got-it", at(6, 18));
    assert.equal(recall(record).stage, 1, "two Got its on one day advance once");
    assert.equal(recall(record).dueOn, "2026-11-09");
    record = recordRecall(record, "challenge-001", "need-practice", at(6, 20));
    assert.equal(recall(record).stage, 0, "changing your mind the same day replaces that day's outcome");
    assert.equal(recall(record).dueOn, "2026-11-07");
    assert.equal(recall(record).attempts.length, 3, "every attempt is kept in the history");
  });

  test("Review now works before an entry is due, and reschedules from today", () => {
    const record = recordRecall(reflected(), "challenge-001", "got-it", at(5, 12));
    assert.equal(recall(record).dueOn, "2026-11-08");
  });

  test("due reviews come longest overdue first; the next upcoming one is known when none is due", () => {
    let record = saveReflection(recordObservedSolve(reflected(at(1)), "challenge-002", at(3)), "challenge-002", reflection, at(3));
    assert.deepEqual(dueReflections(record, "2026-11-05").map((entry) => entry.challengeId), ["challenge-001", "challenge-002"]);
    record = recordRecall(recordRecall(record, "challenge-001", "got-it", at(5)), "challenge-002", "got-it", at(5));
    assert.deepEqual(dueReflections(record, "2026-11-05"), []);
    assert.equal(nextUpcoming(record, "2026-11-05")?.recall.dueOn, "2026-11-08");
  });

  test("attempt history is capped", () => {
    let record = reflected();
    for (let day = 6; day < 6 + LIMITS.attempts + 5; day++) record = recordRecall(record, "challenge-001", "got-it", new Date(2026, 10, day));
    assert.equal(recall(record).attempts.length, LIMITS.attempts);
  });
});

describe("reflections", () => {
  test("can only be written after a confirmed solve of that challenge", () => {
    assert.throws(() => saveReflection(EMPTY_RECORD, "challenge-001", reflection, at(5)), ReflectionError);
    assert.throws(() => saveReflection(solved("challenge-002"), "challenge-001", reflection, at(5)), /confirmed solve/);
  });

  test("need a takeaway; the guided prompts are optional", () => {
    assert.throws(() => saveReflection(solved(), "challenge-001", { cause: "x", takeaway: "   " }, at(5)), /takeaway/);
    const record = saveReflection(solved(), "challenge-001", { takeaway: "Only this" }, at(5));
    assert.deepEqual(record.reflections["challenge-001"].reflection, { cause: "", evidence: "", misunderstanding: "", nextTime: "", takeaway: "Only this" });
  });

  test("editing keeps the schedule and history and records the edit time", () => {
    const reviewed = recordRecall(reflected(), "challenge-001", "got-it", at(6));
    const edited = saveReflection(reviewed, "challenge-001", { ...reflection, takeaway: "Updated" }, at(7));
    const entry = edited.reflections["challenge-001"];
    assert.equal(entry.reflection.takeaway, "Updated");
    assert.deepEqual(entry.recall, recall(reviewed));
    assert.equal(entry.reflectedAt, at(5).toISOString());
    assert.equal(entry.updatedAt, at(7).toISOString());
  });

  test("deleting a reflection keeps the observed solve; clearing keeps solves and practice", () => {
    const record = reflected();
    const deleted = deleteReflection(record, "challenge-001");
    assert.deepEqual(deleted.reflections, {});
    assert.ok(deleted.solves["challenge-001"]);
    assert.equal(deleteReflection(deleted, "challenge-001"), deleted, "deleting a missing entry changes nothing");
    const cleared = clearReflections({ ...record, practice: [{ fromChallengeId: "challenge-001", toChallengeId: "challenge-002", openedAt: at(5).toISOString() }] });
    assert.deepEqual(cleared.reflections, {});
    assert.equal(cleared.practice.length, 1);
    assert.ok(cleared.solves["challenge-001"]);
  });

  test("the journal has a size limit", () => {
    let record: LearningRecord = EMPTY_RECORD;
    for (let i = 0; i < LIMITS.reflections; i++) {
      record = saveReflection(recordObservedSolve(record, `challenge-${i}`, at(5)), `challenge-${i}`, reflection, at(5));
    }
    assert.throws(() => saveReflection(recordObservedSolve(record, "challenge-extra", at(5)), "challenge-extra", reflection, at(5)), /up to 100/);
  });

  test("recording a recall for a missing reflection changes nothing", () => {
    const record = solved();
    assert.equal(recordRecall(record, "challenge-001", "got-it", at(5)), record);
  });
});
