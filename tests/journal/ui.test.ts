/*
 * The Learning Loop's UI and boundaries. Rendered with React's server renderer,
 * so these cover initial renders; the browser journey is checked separately.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JournalView, type JournalActions } from "@/components/journal/JournalView";
import { RecallCard } from "@/components/journal/RecallCard";
import { ReflectionPanel } from "@/components/journal/ReflectionPanel";
import { AppHeader } from "@/components/layout/AppHeader";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { EMPTY_JOURNAL } from "@/lib/journal/model";
import { relationReasons, suggestRelated } from "@/lib/journal/related";
import { saveReflection } from "@/lib/journal/schedule";
import { AUTHORED_CHALLENGES } from "@/server/content";
import type { JournalState } from "@/components/journal/useJournal";

const published = listPublishedChallenges();
const NOW = new Date("2026-11-05T10:00:00.000Z");
const ok = () => ({ ok: true as const });
const actions: JournalActions = { saveReflection: ok, recordRecall: ok, deleteEntry: ok, clear: ok };
const TAKEAWAY = "Check which cookie collection the middleware reads.";
const journal = saveReflection(
  saveReflection(EMPTY_JOURNAL, "challenge-001", { takeaway: TAKEAWAY, evidence: "401 after login" }, new Date(NOW.getTime() - 3 * 86_400_000)),
  "challenge-016",
  { takeaway: "Joining items repeats order totals." },
  NOW,
);
const view = (state: JournalState) => renderToStaticMarkup(createElement(JournalView, { state, published, actions, now: NOW }));
const ROOT = fileURLToPath(new URL("../../src/", import.meta.url));
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("journal page states", () => {
  test("loading and unavailable are explicit, and say what still works", () => {
    assert.ok(view({ status: "loading", journal: EMPTY_JOURNAL }).includes("Loading your journal"));
    const unavailable = view({ status: "unavailable", journal: EMPTY_JOURNAL });
    assert.ok(unavailable.includes("Your journal is unavailable in this browser"));
    assert.ok(unavailable.includes("Challenges still"));
  });

  test("empty: an explanation of the loop and a way to the library", () => {
    const markup = view({ status: "ready", journal: EMPTY_JOURNAL, discarded: 0, corrupt: false });
    assert.ok(markup.includes("No reflections yet"));
    assert.match(markup, /href="\/challenges"/);
    assert.ok(markup.includes("after 1, 3 and 7"));
  });

  test("populated: due entries offer recall, every entry has Review now, Edit and Delete, and nothing is graded", () => {
    const markup = view({ status: "ready", journal, discarded: 0, corrupt: false });
    assert.match(markup, /<ul aria-label="Due for recall"/);
    assert.equal(markup.match(/>Start recall</g)?.length, 1, "only the entry from 3 days ago is due");
    assert.equal(markup.match(/>Review now</g)?.length, 2);
    assert.equal(markup.match(/>Edit</g)?.length, 2);
    assert.equal(markup.match(/>Delete</g)?.length, 2);
    assert.ok(markup.includes(">Clear journal<"));
    assert.ok(markup.includes("Due for recall now") && markup.includes("Next recall in 1 day"));
    assert.ok(markup.includes(TAKEAWAY));
    assert.match(markup, /href="\/challenges\/challenge-001"/);
    assert.doesNotMatch(markup, /score|streak|mastered|accuracy|%/i);
  });

  test("corrupt and discarded data are explained, not hidden", () => {
    const markup = view({ status: "ready", journal: EMPTY_JOURNAL, discarded: 2, corrupt: true });
    assert.ok(markup.includes("could not be read, so it is starting fresh"));
    assert.ok(markup.includes("2 saved entries were for challenges that are no longer available"));
  });

  test("the page states plainly that the journal is saved in this browser only", () => {
    const page = source("components/journal/JournalPage.tsx");
    assert.match(page, /Saved in this browser only\./);
    assert.match(page, /not linked to an account/);
  });
});

describe("recall", () => {
  const entry = journal.entries["challenge-001"];
  const challenge = published.find((item) => item.id === "challenge-001")!;

  test("the takeaway is hidden until the learner has written a recall attempt", () => {
    const markup = renderToStaticMarkup(
      createElement(RecallCard, { entry, challenge, published, reflectedIds: new Set(["challenge-001"]), onRecord: ok }),
    );
    assert.ok(!markup.includes(TAKEAWAY), "the saved takeaway is not shown before recall");
    assert.match(markup, /<label for="[^"]+"[^>]*>Before you look: what caused this bug/);
    assert.match(markup, /<button type="submit" disabled=""[^>]*>Reveal my takeaway<\/button>/);
    assert.ok(markup.includes("is not saved"));
  });

  test("Got it and Need practice are self-reported, and say so", () => {
    const card = source("components/journal/RecallCard.tsx");
    assert.match(card, /Your own judgement, not a grade/);
    assert.match(card, />\s*Got it\s*</);
    assert.match(card, />\s*Need practice\s*</);
  });
});

describe("apply: a related published challenge", () => {
  test("never the challenge itself, always published, preferring one not yet reflected on", () => {
    const target = published.find((item) => item.id === "challenge-016")!;
    const first = suggestRelated(target, published)!;
    assert.notEqual(first.challenge.id, target.id);
    assert.ok(published.some((item) => item.id === first.challenge.id));
    const skipped = suggestRelated(target, published, new Set([first.challenge.id]))!;
    assert.notEqual(skipped.challenge.id, first.challenge.id);
  });

  test("explains the relationship with public metadata", () => {
    const target = published.find((item) => item.id === "challenge-016")!;
    const suggestion = suggestRelated(target, published)!;
    assert.ok(suggestion.reasons.length > 0);
    assert.ok(suggestion.reasons.every((reason) => /^(Same category|Shared technologies|Shared topics): /.test(reason)));
    assert.deepEqual(relationReasons(target, target).slice(0, 1), ["Same category: Databases & Data Integrity"]);
  });

  test("returns null when nothing relates", () => {
    const lonely = { ...published[0], id: "x", category: "security" as const, technologies: ["Nothing"], tags: ["None"] };
    assert.equal(suggestRelated(lonely, [lonely]), null);
  });
});

describe("reflection after a confirmed diagnosis only", () => {
  test("the panel lives only in the correct-diagnosis branch of the result", () => {
    const result = source("components/workspace/diagnosis/DiagnosisResult.tsx");
    const correct = result.slice(result.indexOf('response?.status === "correct"'), result.indexOf('response?.status === "incorrect"'));
    assert.match(correct, /<Reflect \/>/);
    assert.equal(result.match(/<Reflect \/>/g)?.length, 1);
  });

  test("it renders nothing on the server, and nothing without the published list", () => {
    assert.equal(renderToStaticMarkup(createElement(ReflectionPanel, { challengeId: "challenge-001", publishedIds: ["challenge-001"] })), "");
    const result = source("components/workspace/diagnosis/DiagnosisResult.tsx");
    assert.match(result, /if \(!journey\?\.publishedIds\) return null;/);
  });

  test("saving a reflection never calls the diagnosis API or changes the result", () => {
    for (const path of ["components/journal/ReflectionPanel.tsx", "components/journal/useJournal.ts", "lib/journal/schedule.ts"]) {
      assert.doesNotMatch(source(path), /fetch\(|\/api\/|submitDiagnosis|recordDiagnosisResponse/, path);
    }
  });
});

describe("boundaries", () => {
  const files = (dir: string): string[] =>
    readdirSync(join(ROOT, dir)).flatMap((name) => (statSync(join(ROOT, dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));

  test("journal code imports no server code, answer keys or scenario data", () => {
    for (const path of [...files("lib/journal"), ...files("components/journal")]) {
      assert.doesNotMatch(source(path), /@\/server\/|answer-key|@\/data\/challenge-|@\/data\/catalog["']/, path);
    }
  });

  test("no answer-key text appears in any journal or recall markup", () => {
    const markup = view({ status: "ready", journal, discarded: 0, corrupt: false });
    for (const authored of AUTHORED_CHALLENGES) {
      assert.ok(!markup.includes(authored.evaluation.resolutionSummary.slice(0, 50)), authored.scenario.challenge.id);
      assert.ok(!markup.includes(`"${authored.evaluation.correctRootCauseId}"`), authored.scenario.challenge.id);
    }
  });

  test("the header marks the journal as the current page there", () => {
    const markup = renderToStaticMarkup(createElement(AppHeader, { current: "journal" }));
    assert.match(markup, /<a aria-current="page"[^>]*href="\/journal"[^>]*>Journal<|<a[^>]*href="\/journal"[^>]*aria-current="page"[^>]*>Journal</);
  });
});
