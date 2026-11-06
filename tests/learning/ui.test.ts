/*
 * The Learning Loop's UI and boundaries. Rendered with React's server renderer,
 * so these cover each state's markup; the browser journey is checked separately.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JournalView } from "@/components/journal/JournalView";
import { PracticeCard } from "@/components/journal/PracticeCard";
import { RecallCard } from "@/components/journal/RecallCard";
import { ReflectionPanel } from "@/components/journal/ReflectionPanel";
import type { LearningActions, LearningState } from "@/components/journal/useLearning";
import { AppHeader } from "@/components/layout/AppHeader";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { EMPTY_RECORD, type LearningRecord } from "@/lib/learning/model";
import { suggestRelated } from "@/lib/learning/practice";
import { saveReflection } from "@/lib/learning/schedule";
import { recordObservedSolve } from "@/lib/learning/solves";
import { AUTHORED_CHALLENGES } from "@/server/content";

const published = listPublishedChallenges();
const TODAY = "2026-11-05";
const at = (day: number, hour = 10) => new Date(2026, 10, day, hour);
const ok = () => ({ ok: true as const });
const actions: LearningActions = {
  recordSolve: ok,
  saveReflection: ok,
  deleteReflection: ok,
  clearReflections: ok,
  recordRecall: ok,
  recordPracticeOpened: ok,
  exportData: () => "{}",
};
const DUE_TAKEAWAY = "Check which cookie collection the middleware reads.";

function populated(): LearningRecord {
  let record = recordObservedSolve(EMPTY_RECORD, "challenge-001", at(1));
  record = saveReflection(record, "challenge-001", { takeaway: DUE_TAKEAWAY, evidence: "401 after login", misunderstanding: "Thought the token expired" }, at(1));
  record = recordObservedSolve(record, "challenge-016", at(5));
  record = saveReflection(record, "challenge-016", { takeaway: "Joining items repeats order totals." }, at(5));
  record = recordObservedSolve(record, "challenge-002", at(5, 11));
  return record;
}
const ready = (record: LearningRecord, extra: Partial<Extract<LearningState, { status: "ready" }>> = {}): LearningState => ({
  status: "ready",
  record,
  origin: "stored",
  hasLegacyJournal: false,
  problems: [],
  recoveryKeys: [],
  ...extra,
});
const view = (state: LearningState, today: string | null = TODAY) => renderToStaticMarkup(createElement(JournalView, { state, published, actions, today }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const section = (markup: string, heading: string) => {
  const start = markup.indexOf(`>${heading}`);
  assert.ok(start >= 0, `section ${heading}`);
  return markup.slice(start, markup.indexOf("</section>", start));
};
const ROOT = fileURLToPath(new URL("../../src/", import.meta.url));
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("journal states", () => {
  test("loading until the browser has read storage and knows the learner's day", () => {
    assert.match(view({ status: "loading", record: EMPTY_RECORD }), /aria-busy="true"[^>]*>Loading your journal/);
    assert.match(view(ready(populated()), null), /Loading your journal/);
  });

  test("unavailable storage is explained, and says what still works", () => {
    const markup = view({ status: "unavailable", record: EMPTY_RECORD });
    assert.ok(markup.includes("Your journal is unavailable in this browser"));
    assert.ok(markup.includes("Challenges still work"));
  });

  test("empty: what the loop is, and the way to start", () => {
    const markup = view(ready(EMPTY_RECORD));
    assert.ok(markup.includes("Your journal starts with a solved case"));
    assert.ok(markup.includes("after 1, 3 and 7 days"));
    assert.match(markup, /href="\/challenges"[^>]*>Browse Challenges/);
  });
});

describe("a populated journal", () => {
  const markup = view(ready(populated()));

  test("recall comes first and opens the longest-overdue review, without revealing its takeaway", () => {
    assert.ok(markup.indexOf(">Recall<") < markup.indexOf(">Reflections ("), "recall before history");
    const recall = section(markup, "Recall");
    assert.ok(recall.includes("1 review due today"));
    assert.match(recall, /<ul aria-label="Due for recall"/);
    assert.ok(recall.includes("Before you look: what caused this bug"));
    assert.ok(!recall.includes(DUE_TAKEAWAY), "the takeaway stays hidden until the learner has tried");
    assert.match(recall, /<button type="submit" disabled=""[^>]*>Reveal my takeaway<\/button>/);
  });

  test("a solved challenge without a reflection can still be reflected on", () => {
    const awaiting = section(markup, "Solved, not yet reflected");
    assert.ok(awaiting.includes("Reports Visible to Everyone"));
    assert.ok(awaiting.includes(">Write a reflection<"));
  });

  test("each reflection shows its due day and offers recall, edit and delete", () => {
    const history = section(markup, "Reflections (2)");
    assert.ok(history.includes(DUE_TAKEAWAY));
    assert.ok(history.includes("Overdue by 3 days"), "reflected 1 Nov, due 2 Nov, today 5 Nov");
    assert.ok(history.includes("Due tomorrow"));
    assert.equal(history.match(/>Edit</g)?.length, 2);
    assert.equal(history.match(/>Delete</g)?.length, 2);
    assert.ok(history.includes(">Start recall<") && history.includes(">Review now<"));
    assert.ok(history.includes("Your notes (2)"), "notes count only the prompts answered");
  });

  test("Apply suggests related practice with reasons, an honest status and the rule for 'applied'", () => {
    const practice = section(markup, "Apply: practise next");
    assert.ok(practice.includes("opening it is not enough"));
    assert.ok(practice.includes(">Suggested<"));
    assert.match(practice, /Same category: |Shared technologies: |Shared topics: /);
    assert.ok(!practice.includes("Applied ·"), "nothing is applied without a later confirmed solve");
  });

  test("nothing is scored, streaked or called mastered", () => {
    assert.doesNotMatch(text(markup), /\bscore|streak|master|accuracy|\d+ ?%|achievement|badge/i);
  });

  test("the learner's data can be downloaded, and clearing asks first", () => {
    assert.ok(markup.includes(">Download a copy<"));
    assert.ok(markup.includes(">Delete all reflections<"));
  });
});

describe("notices: nothing changes silently", () => {
  test("data that could not be read is reported, kept, and downloadable", () => {
    const markup = view(ready(populated(), { problems: [{ kind: "unreadable", detail: "not valid JSON" }] }));
    assert.match(markup, /role="alert"[^>]*><span[^>]*>Some saved journal data could not be read\./);
    assert.ok(markup.includes("Nothing has been deleted"));
  });

  test("an upgraded earlier journal is announced, with the original kept", () => {
    assert.ok(view(ready(populated(), { hasLegacyJournal: true })).includes("The original is kept unchanged in this browser"));
  });

  test("entries for unpublished challenges are kept, not shown, and mentioned", () => {
    const record = saveReflection(recordObservedSolve(populated(), "challenge-999", at(2)), "challenge-999", { takeaway: "Gone" }, at(2));
    const markup = view(ready(record));
    assert.ok(markup.includes("1 saved entry is for a challenge that is no longer available"));
    assert.ok(!markup.includes(">Gone<"));
  });
});

describe("recall card", () => {
  const record = populated();
  const challenge = published.find((item) => item.id === "challenge-001")!;
  const markup = renderToStaticMarkup(createElement(RecallCard, { entry: record.reflections["challenge-001"], challenge, today: TODAY, onRecord: ok }));

  test("asks for an attempt first; the takeaway stays hidden and nothing typed is saved", () => {
    assert.ok(!markup.includes(DUE_TAKEAWAY));
    assert.match(markup, /<label for="[^"]+"[^>]*>Before you look: what caused this bug/);
    assert.ok(markup.includes("is not saved"));
  });

  test("responses are self-reported and say so", () => {
    const card = source("components/journal/RecallCard.tsx");
    assert.match(card, /Your own judgement, not a grade/);
    assert.match(card, />\s*Got it\s*</);
    assert.match(card, />\s*Need practice\s*</);
  });
});

describe("practice card", () => {
  const from = published.find((item) => item.id === "challenge-016")!;
  const suggestion = suggestRelated(from, published)!;
  const render = (status: "suggested" | "opened" | "applied") => renderToStaticMarkup(createElement(PracticeCard, { from, suggestion, status, onOpen: () => {} }));

  test("each status says exactly what happened", () => {
    assert.ok(render("suggested").includes(">Suggested<"));
    assert.ok(render("opened").includes("Opened · not solved yet"));
    assert.ok(render("applied").includes("Applied · confirmed solve after opening"));
  });

  test("opening only records that it was opened", () => {
    assert.match(source("components/journal/JournalView.tsx"), /onOpen=\{\(\) => actions\.recordPracticeOpened\(from\.id, suggestion\.challenge\.id\)\}/);
  });
});

describe("solve and reflect only after a confirmed correct diagnosis", () => {
  const result = source("components/workspace/diagnosis/DiagnosisResult.tsx");

  test("the solve recorder and reflection live only in the correct branch of the result", () => {
    const correct = result.slice(result.indexOf('response?.status === "correct"'), result.indexOf('response?.status === "incorrect"'));
    assert.match(correct, /<Reflect confirmation=\{response\} \/>/);
    assert.equal(result.match(/<Reflect /g)?.length, 1);
    assert.equal(result.match(/<SolveRecorder /g)?.length, 1);
  });

  test("each confirmation records one solve, however often it re-renders", () => {
    const recorder = source("components/journal/SolveRecorder.tsx");
    assert.match(recorder, /const recorded = new WeakSet<object>\(\);/);
    assert.match(recorder, /if \(recorded\.has\(confirmation\)\) return;\s*recorded\.add\(confirmation\);\s*learningActions\.recordSolve\(challengeId\);/);
  });

  test("the reflection panel renders nothing on the server (storage is read in the browser)", () => {
    assert.equal(renderToStaticMarkup(createElement(ReflectionPanel, { challengeId: "challenge-001" })), "");
  });

  test("saving learning data never calls the diagnosis API", () => {
    for (const path of ["components/journal/ReflectionPanel.tsx", "components/journal/useLearning.ts", "components/journal/SolveRecorder.tsx", "lib/learning/schedule.ts", "lib/learning/solves.ts"]) {
      assert.doesNotMatch(source(path), /fetch\(|\/api\/|submitDiagnosis|recordDiagnosisResponse/, path);
    }
  });
});

describe("boundaries", () => {
  const files = (dir: string): string[] =>
    readdirSync(join(ROOT, dir)).flatMap((name) => (statSync(join(ROOT, dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));

  test("learning code imports no server code, answer keys or scenario data, and no learner-session API", () => {
    for (const path of [...files("lib/learning"), ...files("components/journal")]) {
      assert.doesNotMatch(source(path), /@\/server\/|answer-key|@\/data\/challenge-|@\/data\/catalog["']|learner-session/, path);
    }
  });

  test("no answer-key text appears in the journal", () => {
    const markup = view(ready(populated()));
    for (const authored of AUTHORED_CHALLENGES) {
      assert.ok(!markup.includes(authored.evaluation.resolutionSummary.slice(0, 50)), authored.scenario.challenge.id);
    }
  });

  test("journal components use theme tokens only", () => {
    for (const path of files("components/journal").filter((file) => /\.tsx?$/.test(file))) {
      assert.doesNotMatch(source(path), /#[0-9a-f]{3,8}\b|rgb\(/i, path);
    }
  });

  test("the page states plainly that the journal is browser-only and sends no reminders", () => {
    const page = source("components/journal/JournalPage.tsx");
    assert.match(page, /Saved in this browser only\./);
    assert.match(page, /not synced to other\s+devices/);
    assert.match(page, /No reminders are sent\./);
  });

  test("the header marks the journal as the current page there", () => {
    const markup = renderToStaticMarkup(createElement(AppHeader, { current: "journal" }));
    assert.match(markup, /<a[^>]*aria-current="page"[^>]*href="\/journal"[^>]*>Journal<|<a[^>]*href="\/journal"[^>]*aria-current="page"[^>]*>Journal</);
  });
});
