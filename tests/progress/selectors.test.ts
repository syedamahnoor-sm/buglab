/*
 * Learning Progress selectors: every count, step and event is derived from the
 * version 2 learning record and the published catalog, and nothing else.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CATEGORIES } from "@/data/catalog/categories";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { EMPTY_RECORD, type LearningRecord } from "@/lib/learning/model";
import { practiceFor, recordPracticeOpened } from "@/lib/learning/practice";
import { recordRecall, saveReflection } from "@/lib/learning/schedule";
import { recordObservedSolve } from "@/lib/learning/solves";
import { learningActivity } from "@/lib/progress/activity";
import { continueLearning } from "@/lib/progress/next-steps";
import { progressOverview, reviewDays } from "@/lib/progress/overview";
import { skillBreakdown } from "@/lib/progress/skills";
import { browserProgress } from "@/lib/progress/source";

const published = listPublishedChallenges();
const byId = new Map(published.map((challenge) => [challenge.id, challenge]));
const TODAY = "2026-11-05";
const at = (day: number, hour = 10, minute = 0) => new Date(2026, 10, day, hour, minute);

/** Two reflected solves (one due, one not yet), one solve awaiting a reflection. */
function populated(): LearningRecord {
  let record = recordObservedSolve(EMPTY_RECORD, "challenge-001", at(1));
  record = saveReflection(record, "challenge-001", { takeaway: "Check which cookie the middleware reads." }, at(1, 11));
  record = recordObservedSolve(record, "challenge-016", at(5));
  record = saveReflection(record, "challenge-016", { takeaway: "Joins repeat order totals." }, at(5, 10, 30));
  record = recordObservedSolve(record, "challenge-002", at(5, 11));
  return record;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

describe("source", () => {
  test("the only source today is this browser's learning record; server verification is not connected", () => {
    const source = browserProgress(EMPTY_RECORD);
    assert.deepEqual(source.verified, { status: "not-connected" });
    assert.equal(source.record, EMPTY_RECORD, "the record is read, never copied into a store of its own");
  });
});

describe("overview", () => {
  test("an empty record counts nothing, out of the whole published catalog", () => {
    const overview = progressOverview(browserProgress(EMPTY_RECORD), published, TODAY);
    assert.equal(overview.total, published.length);
    assert.equal(overview.total, 30);
    assert.equal(overview.categoriesTotal, 6);
    assert.deepEqual(
      [overview.solved, overview.reflections, overview.awaitingReflection, overview.reviewsDone, overview.reviewsDue, overview.categoriesExplored, overview.unlisted],
      [0, 0, 0, 0, 0, 0, 0],
    );
    assert.equal(overview.nextReviewOn, null);
  });

  test("solves, reflections, due reviews and explored categories come straight from the record", () => {
    const record = populated();
    const overview = progressOverview(browserProgress(record), published, TODAY);
    assert.equal(overview.solved, 3);
    assert.equal(overview.reflections, 2);
    assert.equal(overview.awaitingReflection, 1);
    assert.equal(overview.reviewsDue, 1, "the 1 Nov reflection is due; the 5 Nov one is due tomorrow");
    assert.equal(overview.reviewsDone, 0);
    const categories = new Set(["challenge-001", "challenge-016", "challenge-002"].map((id) => byId.get(id)!.category));
    assert.equal(overview.categoriesExplored, categories.size);
  });

  test("with nothing due, the next review day is given", () => {
    let record = populated();
    record = recordRecall(record, "challenge-001", "got-it", at(5, 12));
    const overview = progressOverview(browserProgress(record), published, TODAY);
    assert.equal(overview.reviewsDue, 0);
    assert.equal(overview.nextReviewOn, "2026-11-06");
  });

  test("several reviews of one takeaway on the same day count once, as the Journal schedules them", () => {
    let record = populated();
    record = recordRecall(record, "challenge-001", "need-practice", at(5, 12));
    record = recordRecall(record, "challenge-001", "got-it", at(5, 12, 5));
    assert.equal(progressOverview(browserProgress(record), published, TODAY).reviewsDone, 1);
    record = recordRecall(record, "challenge-001", "got-it", at(7, 9));
    assert.equal(progressOverview(browserProgress(record), published, "2026-11-07").reviewsDone, 2);
    assert.equal(reviewDays([{ day: "2026-11-05" }, { day: "2026-11-05" }, { day: "2026-11-06" }]), 2);
  });

  test("solves for challenges no longer published are kept but not counted", () => {
    const record = recordObservedSolve(populated(), "challenge-999", at(4));
    const overview = progressOverview(browserProgress(record), published, TODAY);
    assert.equal(overview.solved, 3);
    assert.equal(overview.unlisted, 1);
  });

  test("selectors never change the record", () => {
    const record = deepFreeze(populated());
    const source = browserProgress(record);
    assert.doesNotThrow(() => {
      progressOverview(source, published, TODAY);
      skillBreakdown(source, published);
      continueLearning(source, published, TODAY);
      learningActivity(source);
    });
  });
});

describe("skill breakdown", () => {
  test("every category with published challenges, counted from the catalog, no scores", () => {
    const categories = skillBreakdown(browserProgress(EMPTY_RECORD), published);
    assert.deepEqual(categories.map((category) => category.id), CATEGORIES.map((category) => category.id));
    assert.equal(categories.reduce((sum, category) => sum + category.total, 0), published.length);
    for (const category of categories) {
      assert.equal(category.explored, false);
      assert.equal(category.solved, 0);
      assert.equal(category.total, published.filter((challenge) => challenge.category === category.id).length);
      assert.ok(category.next && category.next.category === category.id);
      assert.deepEqual(Object.keys(category).sort(), ["challenges", "description", "explored", "id", "label", "next", "solved", "total", "verified"]);
    }
  });

  test("a solve marks its category explored, and the next suggestion there is unsolved", () => {
    const record = populated();
    const category = byId.get("challenge-001")!.category;
    const entry = skillBreakdown(browserProgress(record), published).find((item) => item.id === category)!;
    assert.equal(entry.explored, true);
    assert.equal(entry.solved, ["challenge-001", "challenge-016", "challenge-002"].filter((id) => byId.get(id)!.category === category).length);
    assert.ok(entry.challenges.find((item) => item.challenge.id === "challenge-001")!.solved);
    assert.ok(entry.next && !(entry.next.id in record.solves));
  });

  test("a fully solved category has no next challenge", () => {
    const category = CATEGORIES[0].id;
    let record = EMPTY_RECORD;
    for (const challenge of published.filter((item) => item.category === category)) record = recordObservedSolve(record, challenge.id, at(2));
    const entry = skillBreakdown(browserProgress(record), published).find((item) => item.id === category)!;
    assert.equal(entry.solved, entry.total);
    assert.equal(entry.next, null);
  });
});

describe("activity", () => {
  test("an empty record has no activity: nothing is invented", () => {
    assert.deepEqual(learningActivity(browserProgress(EMPTY_RECORD)), []);
  });

  test("solves and reflections, newest first, each at the time the record holds", () => {
    const events = learningActivity(browserProgress(populated()));
    assert.deepEqual(
      events.map((event) => [event.kind, event.challengeId, event.at]),
      [
        ["solved", "challenge-002", at(5, 11).toISOString()],
        ["solved", "challenge-016", at(5).toISOString()],
        ["reflected", "challenge-016", at(5, 10, 30).toISOString()],
        ["reflected", "challenge-001", at(1, 11).toISOString()],
        ["solved", "challenge-001", at(1).toISOString()],
      ].sort((a, b) => b[2].localeCompare(a[2])),
    );
  });

  test("a repeat solve shows once, as the latest, with the total; repeats in between are not invented", () => {
    let record = recordObservedSolve(EMPTY_RECORD, "challenge-003", at(1));
    record = recordObservedSolve(record, "challenge-003", at(2));
    record = recordObservedSolve(record, "challenge-003", at(3));
    const events = learningActivity(browserProgress(record));
    assert.deepEqual(
      events.map((event) => event.kind),
      ["solved-again", "solved"],
    );
    assert.deepEqual(events[0], { kind: "solved-again", at: at(3).toISOString(), challengeId: "challenge-003", timesSolved: 3 });
  });

  test("recall reviews show one per day, with that day's last answer; edits and practice are listed", () => {
    let record = populated();
    record = recordRecall(record, "challenge-001", "need-practice", at(5, 12));
    record = recordRecall(record, "challenge-001", "got-it", at(5, 12, 5));
    record = saveReflection(record, "challenge-001", { takeaway: "Check which cookie collection the middleware reads." }, at(5, 13));
    const target = practiceFor(record, byId.get("challenge-001")!, published)!.challenge;
    record = recordPracticeOpened(record, "challenge-001", target.id, at(5, 14));
    const events = learningActivity(browserProgress(record));
    const recalls = events.filter((event) => event.kind === "recalled");
    assert.equal(recalls.length, 1);
    assert.deepEqual(recalls[0], { kind: "recalled", at: at(5, 12, 5).toISOString(), challengeId: "challenge-001", response: "got-it", reviewsThatDay: 2 });
    assert.deepEqual(events.slice(0, 2).map((event) => event.kind), ["practice-opened", "reflection-edited"]);
    assert.deepEqual(events[0], { kind: "practice-opened", at: at(5, 14).toISOString(), challengeId: target.id, fromChallengeId: "challenge-001" });
  });
});

describe("continue learning", () => {
  test("with nothing solved, the steps are starting points in different categories from the catalog", () => {
    const steps = continueLearning(browserProgress(EMPTY_RECORD), published, TODAY);
    assert.equal(steps.length, 4);
    for (const step of steps) {
      assert.equal(step.kind, "explore");
      assert.equal(step.basis, "catalog");
      if (step.kind === "explore") assert.ok(step.firstSolve && step.newCategory);
    }
    assert.equal(new Set(steps.map((step) => step.challenge.category)).size, 4, "one per category");
  });

  test("due recall first, then a missing reflection, then practice, then new ground", () => {
    const steps = continueLearning(browserProgress(populated()), published, TODAY);
    assert.deepEqual(steps.map((step) => step.kind), ["recall", "reflect", "apply", "explore"]);
    const [recall, reflect, apply, explore] = steps;
    assert.equal(recall.challenge.id, "challenge-001");
    assert.equal(recall.basis, "your-record");
    if (recall.kind === "recall") assert.deepEqual([recall.dueOn, recall.more], ["2026-11-02", 0]);
    assert.equal(reflect.challenge.id, "challenge-002");
    if (apply.kind === "apply") {
      assert.equal(apply.from.id, "challenge-016", "the newest reflection's practice case");
      assert.equal(apply.status, "suggested");
      assert.deepEqual(apply.challenge, practiceFor(populated(), byId.get("challenge-016")!, published)!.challenge, "the Journal's own suggestion");
    }
    if (explore.kind === "explore") {
      const solvedCategories = new Set(["challenge-001", "challenge-016", "challenge-002"].map((id) => byId.get(id)!.category));
      assert.ok(!solvedCategories.has(explore.category), "a category not explored yet");
      assert.equal(explore.basis, "catalog");
    }
  });

  test("a review done today leaves the recall step, and an opened practice case stays until solved after opening", () => {
    let record = recordRecall(populated(), "challenge-001", "got-it", at(5, 12));
    let steps = continueLearning(browserProgress(record), published, TODAY);
    assert.ok(!steps.some((step) => step.kind === "recall"));

    const apply = steps.find((step) => step.kind === "apply")!;
    assert.ok(apply.kind === "apply");
    record = recordPracticeOpened(record, apply.from.id, apply.challenge.id, at(5, 13));
    const opened = continueLearning(browserProgress(record), published, TODAY).find((step) => step.kind === "apply");
    assert.ok(opened?.kind === "apply" && opened.status === "opened" && opened.challenge.id === apply.challenge.id);

    record = recordObservedSolve(record, apply.challenge.id, at(5, 15));
    steps = continueLearning(browserProgress(record), published, TODAY);
    assert.ok(!steps.some((step) => step.kind === "apply" && step.from.id === apply.from.id && step.challenge.id === apply.challenge.id), "applied: done");
  });

  test("more due reviews are counted on the one recall step", () => {
    const steps = continueLearning(browserProgress(populated()), published, "2026-11-08");
    const recall = steps[0];
    assert.ok(recall.kind === "recall");
    assert.equal(recall.challenge.id, "challenge-001", "longest overdue first");
    assert.equal(recall.more, 1);
  });

  test("with every category explored, the next unsolved challenges keep the list useful", () => {
    let record = EMPTY_RECORD;
    for (const category of CATEGORIES) record = recordObservedSolve(record, published.find((item) => item.category === category.id)!.id, at(2));
    const steps = continueLearning(browserProgress(record), published, TODAY);
    const explores = steps.filter((step) => step.kind === "explore");
    assert.ok(explores.length >= 1);
    for (const step of explores) {
      assert.ok(step.kind === "explore" && !step.newCategory && !step.firstSolve);
      assert.ok(!(step.challenge.id in record.solves));
    }
  });

  test("with everything solved, reflected and reviewed, nothing is invented", () => {
    let record = EMPTY_RECORD;
    for (const challenge of published) {
      record = recordObservedSolve(record, challenge.id, at(1));
      record = saveReflection(record, challenge.id, { takeaway: `Takeaway ${challenge.id}` }, at(1));
      record = recordRecall(record, challenge.id, "got-it", at(5, 9));
    }
    assert.deepEqual(continueLearning(browserProgress(record), published, TODAY), []);
  });
});
