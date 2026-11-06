/*
 * The learning record (version 2) and the non-destructive upgrade from the
 * Sprint 9B journal (version 1). Migrations run against frozen copies, so a
 * migration that modified its input would fail here.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { localDay } from "@/lib/learning/days";
import { migrateJournalV1 } from "@/lib/learning/migrate";
import { EMPTY_RECORD, LEARNING_VERSION, LIMITS, listReflections, parseRecord, serializeRecord, type LearningRecord } from "@/lib/learning/model";
import { recordRecall, saveReflection } from "@/lib/learning/schedule";
import { recordObservedSolve } from "@/lib/learning/solves";

const NOW = new Date(2026, 10, 5, 10, 0, 0);
const reflection = { cause: "Signed cookie read as unsigned", evidence: "The 401s after login", misunderstanding: "I blamed the token expiry", nextTime: "Check which cookie jar the middleware reads", takeaway: "Check which cookie jar the middleware reads." };
const solved = (id = "challenge-001", at = NOW): LearningRecord => recordObservedSolve(EMPTY_RECORD, id, at);
const withReflection = (): LearningRecord => saveReflection(solved(), "challenge-001", reflection, NOW);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A Sprint 9B journal exactly as 9B stored it. */
const V1_ENTRY = {
  challengeId: "challenge-016",
  reflection: { evidence: "The figures that disagreed with settlement.", cause: "A join repeated each order row", lookFor: "Sums across joins", takeaway: "Aggregate after the join, not across it." },
  reflectedAt: "2026-11-01T22:50:00.000Z",
  updatedAt: "2026-11-02T08:00:00.000Z",
  recall: { stage: 1, dueAt: "2026-11-05T09:00:00.000Z", attempts: [{ at: "2026-11-02T09:00:00.000Z", response: "got-it" }] },
};
const v1Text = (entries: Record<string, unknown> = { "challenge-016": V1_ENTRY }) => JSON.stringify({ version: 1, entries });

describe("reading the version 2 record", () => {
  test("nothing stored is an empty record with no problems", () => {
    assert.deepEqual(parseRecord(null), { record: EMPTY_RECORD, problems: [] });
    assert.deepEqual(parseRecord(""), { record: EMPTY_RECORD, problems: [] });
  });

  test("a saved record round-trips exactly", () => {
    const record = recordRecall(withReflection(), "challenge-001", "got-it", new Date(2026, 10, 6, 9));
    assert.deepEqual(parseRecord(serializeRecord(record)), { record, problems: [] });
  });

  test("unreadable text and unknown versions are reported, never mistaken for an empty journal", () => {
    assert.equal(parseRecord("{not json").problems[0].kind, "unreadable");
    for (const text of ["[]", "42", JSON.stringify({ version: 3 }), JSON.stringify({ version: 1, entries: {} })]) {
      const result = parseRecord(text);
      assert.equal(result.problems[0].kind, "unknown-version", text);
      assert.deepEqual(result.record, EMPTY_RECORD);
    }
  });

  test("an invalid entry is reported instead of silently dropped; the valid ones are kept", () => {
    const record = withReflection();
    const broken = JSON.parse(serializeRecord(record));
    broken.reflections["challenge-002"] = { challengeId: "challenge-002", reflection: { takeaway: "x" }, reflectedAt: "yesterday" };
    const result = parseRecord(JSON.stringify(broken));
    assert.deepEqual(Object.keys(result.record.reflections), ["challenge-001"]);
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0].kind, "invalid-entry");
  });

  test("entries for challenges that are no longer published are kept (the UI decides what to show)", () => {
    const record = saveReflection(solved("challenge-999"), "challenge-999", reflection, NOW);
    assert.deepEqual(Object.keys(parseRecord(serializeRecord(record)).record.reflections), ["challenge-999"]);
  });

  test("text is trimmed and cut to the limits; unknown fields are not kept", () => {
    const record = withReflection();
    const raw = JSON.parse(serializeRecord(record));
    raw.reflections["challenge-001"].reflection.evidence = "e".repeat(5000);
    raw.reflections["challenge-001"].reflection.injected = "<script>";
    raw.reflections["challenge-001"].extra = "x";
    const entry = parseRecord(JSON.stringify(raw)).record.reflections["challenge-001"];
    assert.equal(entry.reflection.evidence.length, LIMITS.answerLength);
    assert.deepEqual(Object.keys(entry.reflection).sort(), ["cause", "evidence", "misunderstanding", "nextTime", "takeaway"]);
    assert.deepEqual(Object.keys(entry).sort(), ["challengeId", "recall", "reflectedAt", "reflection", "updatedAt"]);
  });

  test("the stored shape holds only the learner's words, dates, self-reported responses and IDs", () => {
    const text = serializeRecord(recordRecall(withReflection(), "challenge-001", "got-it", new Date(2026, 10, 6)));
    for (const forbidden of ["correctRootCauseId", "resolution", "keyObservations", "hints", "score", "token", "cookie\"", "password", "streak", "mastery"]) {
      assert.ok(!text.includes(`"${forbidden}`), forbidden);
    }
  });

  test("observed solves are labelled as browser observations", () => {
    assert.equal(solved().solves["challenge-001"].source, "browser");
  });

  test("reflections are listed newest first", () => {
    const later = saveReflection(recordObservedSolve(withReflection(), "challenge-002", NOW), "challenge-002", reflection, new Date(2026, 10, 6));
    assert.deepEqual(listReflections(later).map((entry) => entry.challengeId), ["challenge-002", "challenge-001"]);
  });
});

describe("upgrading a Sprint 9B journal (version 1)", () => {
  test("every word the learner wrote is carried over, and the input is not modified", () => {
    const input = deepFreeze(JSON.parse(v1Text()));
    const text = JSON.stringify(input);
    const result = migrateJournalV1(text);
    assert.equal(result.migrated, 1);
    assert.deepEqual(result.problems, []);
    const entry = result.record.reflections["challenge-016"];
    assert.deepEqual(entry.reflection, {
      cause: V1_ENTRY.reflection.cause,
      evidence: V1_ENTRY.reflection.evidence,
      misunderstanding: "",
      nextTime: V1_ENTRY.reflection.lookFor,
      takeaway: V1_ENTRY.reflection.takeaway,
    });
    assert.equal(entry.reflectedAt, V1_ENTRY.reflectedAt);
    assert.equal(entry.updatedAt, V1_ENTRY.updatedAt);
    assert.equal(JSON.stringify(input), text, "input unchanged");
  });

  test("due times become local due days, and recall history is kept", () => {
    const entry = migrateJournalV1(v1Text()).record.reflections["challenge-016"];
    assert.equal(entry.recall.stage, 1);
    assert.equal(entry.recall.dueOn, localDay(new Date(V1_ENTRY.recall.dueAt)));
    assert.deepEqual(entry.recall.attempts, [{ at: "2026-11-02T09:00:00.000Z", day: localDay(new Date("2026-11-02T09:00:00.000Z")), response: "got-it" }]);
    assert.equal(entry.recall.lastReviewedOn, entry.recall.attempts[0].day);
  });

  test("each version 1 entry becomes an observed solve dated when it was written", () => {
    const solve = migrateJournalV1(v1Text()).record.solves["challenge-016"];
    assert.deepEqual(solve, { challengeId: "challenge-016", firstSolvedAt: V1_ENTRY.reflectedAt, lastSolvedAt: V1_ENTRY.reflectedAt, timesSolved: 1, source: "browser" });
  });

  test("the result is a valid version 2 record", () => {
    const record = migrateJournalV1(v1Text()).record;
    assert.equal(record.version, LEARNING_VERSION);
    assert.deepEqual(parseRecord(serializeRecord(record)), { record, problems: [] });
  });

  test("migration is repeatable: the same input gives the same record", () => {
    assert.deepEqual(migrateJournalV1(v1Text()), migrateJournalV1(v1Text()));
  });

  test("entries for unpublished challenges are migrated too, not dropped", () => {
    const result = migrateJournalV1(v1Text({ "challenge-777": { ...V1_ENTRY, challengeId: "challenge-777" } }));
    assert.deepEqual(Object.keys(result.record.reflections), ["challenge-777"]);
  });

  test("unreadable or invalid version 1 entries are reported, not silently dropped", () => {
    assert.equal(migrateJournalV1("{oops").problems[0].kind, "unreadable");
    assert.equal(migrateJournalV1(JSON.stringify({ version: 2 })).problems[0].kind, "unknown-version");
    const result = migrateJournalV1(v1Text({ "challenge-016": V1_ENTRY, "challenge-002": { challengeId: "challenge-002", reflection: { takeaway: "" } } }));
    assert.equal(result.migrated, 1);
    assert.deepEqual(result.problems.map((problem) => problem.kind), ["invalid-entry"]);
  });

  test("a stage beyond the version 2 schedule is clamped to its last interval", () => {
    const result = migrateJournalV1(v1Text({ "challenge-016": { ...V1_ENTRY, recall: { ...V1_ENTRY.recall, stage: 7 } } }));
    assert.equal(result.record.reflections["challenge-016"].recall.stage, 2);
  });
});
