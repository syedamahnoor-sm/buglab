import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EMPTY_JOURNAL, JOURNAL_VERSION, LIMITS, listEntries, parseJournal, serializeJournal, type Journal } from "@/lib/journal/model";
import { daysUntilDue, deleteEntry, dueEntries, INTERVAL_DAYS, isDue, recordRecall, ReflectionError, saveReflection } from "@/lib/journal/schedule";

const PUBLISHED = new Set(["challenge-001", "challenge-002", "challenge-003"]);
const NOW = new Date("2026-11-05T10:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const reflection = { evidence: "The 401s after login", cause: "Signed cookie read as unsigned", lookFor: "Where the cookie is read", takeaway: "Check which cookie jar the middleware reads." };
const withEntry = (): Journal => saveReflection(EMPTY_JOURNAL, "challenge-001", reflection, NOW);

describe("parsing stored journals safely", () => {
  test("nothing stored is an empty journal, not an error", () => {
    assert.deepEqual(parseJournal(null, PUBLISHED), { journal: EMPTY_JOURNAL, discarded: 0, corrupt: false });
    assert.deepEqual(parseJournal("", PUBLISHED), { journal: EMPTY_JOURNAL, discarded: 0, corrupt: false });
  });

  test("unreadable data, a non-object or an unknown version gives an empty journal marked corrupt", () => {
    for (const text of ["{not json", "[]", "42", JSON.stringify({ version: 2, entries: {} }), JSON.stringify({ version: 1 })]) {
      const result = parseJournal(text, PUBLISHED);
      assert.equal(result.corrupt, true, text);
      assert.deepEqual(result.journal.entries, {}, text);
    }
  });

  test("a saved journal round-trips exactly", () => {
    const journal = withEntry();
    assert.deepEqual(parseJournal(serializeJournal(journal), PUBLISHED), { journal, discarded: 0, corrupt: false });
  });

  test("entries for challenges that are not published are dropped and counted", () => {
    const journal = saveReflection(withEntry(), "challenge-002", reflection, NOW);
    const result = parseJournal(serializeJournal(journal), new Set(["challenge-001"]));
    assert.deepEqual(Object.keys(result.journal.entries), ["challenge-001"]);
    assert.equal(result.discarded, 1);
  });

  test("invalid entries are dropped: wrong id, bad dates, missing takeaway, bad stage", () => {
    const good = withEntry().entries["challenge-001"];
    const stored = {
      version: JOURNAL_VERSION,
      entries: {
        "challenge-001": good,
        "challenge-002": { ...good, challengeId: "challenge-003" },
        "challenge-003": { ...good, challengeId: "challenge-003", reflectedAt: "yesterday" },
        "../etc": { ...good, challengeId: "../etc" },
        __proto__: { ...good },
      },
    };
    const parsed = parseJournal(JSON.stringify(stored), PUBLISHED);
    assert.deepEqual(Object.keys(parsed.journal.entries), ["challenge-001"]);
    for (const broken of [{ ...good, reflection: { ...good.reflection, takeaway: "   " } }, { ...good, recall: { ...good.recall, stage: -1 } }, { ...good, recall: { ...good.recall, stage: 1.5 } }]) {
      const result = parseJournal(JSON.stringify({ version: 1, entries: { "challenge-001": broken } }), PUBLISHED);
      assert.deepEqual(result.journal.entries, {});
      assert.equal(result.discarded, 1);
    }
  });

  test("stored text is trimmed and cut to the limits; unknown fields are not kept", () => {
    const good = withEntry().entries["challenge-001"];
    const long = { ...good, extra: "x", reflection: { ...good.reflection, evidence: "e".repeat(5000), takeaway: ` ${"t".repeat(1000)} `, injected: "<script>" } };
    const entry = parseJournal(JSON.stringify({ version: 1, entries: { "challenge-001": long } }), PUBLISHED).journal.entries["challenge-001"];
    assert.equal(entry.reflection.evidence.length, LIMITS.answerLength);
    assert.equal(entry.reflection.takeaway.length, LIMITS.takeawayLength);
    assert.deepEqual(Object.keys(entry).sort(), ["challengeId", "recall", "reflectedAt", "reflection", "updatedAt"]);
    assert.deepEqual(Object.keys(entry.reflection).sort(), ["cause", "evidence", "lookFor", "takeaway"]);
  });

  test("recall attempts are validated and capped", () => {
    const good = withEntry().entries["challenge-001"];
    const attempts = [...Array.from({ length: 30 }, (_, i) => ({ at: at(i).toISOString(), response: "got-it" })), { at: "nope", response: "got-it" }, { at: NOW.toISOString(), response: "mastered" }];
    const entry = parseJournal(JSON.stringify({ version: 1, entries: { "challenge-001": { ...good, recall: { ...good.recall, attempts } } } }), PUBLISHED).journal.entries["challenge-001"];
    assert.equal(entry.recall.attempts.length, LIMITS.attempts);
    assert.ok(entry.recall.attempts.every((attempt) => attempt.response === "got-it" || attempt.response === "need-practice"));
  });

  test("the stored shape holds only the learner's words, dates and self-reported responses", () => {
    const text = serializeJournal(recordRecall(withEntry(), "challenge-001", "got-it", at(1)));
    for (const forbidden of ["correctRootCauseId", "resolution", "keyObservations", "hints", "score", "token", "cookie", "password"]) {
      assert.ok(!text.includes(`"${forbidden}`), forbidden);
    }
  });

  test("entries are listed newest reflection first", () => {
    const journal = saveReflection(withEntry(), "challenge-002", reflection, at(1));
    assert.deepEqual(listEntries(journal).map((entry) => entry.challengeId), ["challenge-002", "challenge-001"]);
  });
});

describe("the recall schedule: 1, 3, then 7 days", () => {
  test("a new reflection is due 1 day later", () => {
    const entry = withEntry().entries["challenge-001"];
    assert.deepEqual(INTERVAL_DAYS, [1, 3, 7]);
    assert.equal(entry.recall.stage, 0);
    assert.equal(entry.recall.dueAt, at(1).toISOString());
    assert.equal(isDue(entry, NOW), false);
    assert.equal(isDue(entry, at(1)), true);
    assert.equal(daysUntilDue(entry, NOW), 1);
  });

  test("Got it moves to 3 days, then 7, and stays at 7", () => {
    let journal = withEntry();
    journal = recordRecall(journal, "challenge-001", "got-it", at(1));
    assert.equal(journal.entries["challenge-001"].recall.dueAt, at(4).toISOString());
    journal = recordRecall(journal, "challenge-001", "got-it", at(4));
    assert.equal(journal.entries["challenge-001"].recall.dueAt, at(11).toISOString());
    journal = recordRecall(journal, "challenge-001", "got-it", at(11));
    assert.equal(journal.entries["challenge-001"].recall.dueAt, at(18).toISOString());
    assert.deepEqual(journal.entries["challenge-001"].recall.attempts.map((attempt) => attempt.response), ["got-it", "got-it", "got-it"]);
  });

  test("days until due are rounded for display: a clock read minutes earlier does not add a day", () => {
    const journal = recordRecall(withEntry(), "challenge-001", "got-it", NOW);
    const entry = journal.entries["challenge-001"];
    assert.equal(daysUntilDue(entry, new Date(NOW.getTime() - 5 * 60_000)), 3);
    assert.equal(daysUntilDue(entry, at(2.9)), 1, "less than a day left still reads as 1 day");
    assert.equal(daysUntilDue(entry, at(3)), 0);
  });

  test("Need practice goes back to 1 day", () => {
    let journal = recordRecall(withEntry(), "challenge-001", "got-it", at(1));
    journal = recordRecall(journal, "challenge-001", "need-practice", at(4));
    assert.equal(journal.entries["challenge-001"].recall.stage, 0);
    assert.equal(journal.entries["challenge-001"].recall.dueAt, at(5).toISOString());
  });

  test("Review now works on an entry that is not due yet, and reschedules from now", () => {
    const journal = recordRecall(withEntry(), "challenge-001", "got-it", NOW);
    assert.equal(journal.entries["challenge-001"].recall.dueAt, at(3).toISOString());
  });

  test("editing a reflection keeps its schedule and history", () => {
    const recalled = recordRecall(withEntry(), "challenge-001", "got-it", at(1));
    const edited = saveReflection(recalled, "challenge-001", { ...reflection, takeaway: "Updated" }, at(2));
    assert.equal(edited.entries["challenge-001"].reflection.takeaway, "Updated");
    assert.deepEqual(edited.entries["challenge-001"].recall, recalled.entries["challenge-001"].recall);
    assert.equal(edited.entries["challenge-001"].reflectedAt, NOW.toISOString());
    assert.equal(edited.entries["challenge-001"].updatedAt, at(2).toISOString());
  });

  test("a takeaway is required, and the journal has a size limit", () => {
    assert.throws(() => saveReflection(EMPTY_JOURNAL, "challenge-001", { ...reflection, takeaway: "  " }, NOW), ReflectionError);
    let journal: Journal = EMPTY_JOURNAL;
    for (let i = 0; i < LIMITS.entries; i++) journal = saveReflection(journal, `challenge-${i}`, reflection, NOW);
    assert.throws(() => saveReflection(journal, "challenge-extra", reflection, NOW), /up to 100 entries/);
  });

  test("due entries come longest overdue first; delete removes one", () => {
    let journal = saveReflection(withEntry(), "challenge-002", reflection, at(-5));
    assert.deepEqual(dueEntries(journal, at(2)).map((entry) => entry.challengeId), ["challenge-002", "challenge-001"]);
    journal = deleteEntry(journal, "challenge-002");
    assert.deepEqual(Object.keys(journal.entries), ["challenge-001"]);
    assert.equal(deleteEntry(journal, "challenge-999"), journal);
  });

  test("recording a recall for a missing entry changes nothing", () => {
    const journal = withEntry();
    assert.equal(recordRecall(journal, "challenge-999", "got-it", NOW), journal);
  });
});
