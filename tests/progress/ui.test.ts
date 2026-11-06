/*
 * Learning Progress UI and boundaries, rendered with React's server renderer.
 * The browser journey (live updates, themes, widths) is checked separately.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JournalView } from "@/components/journal/JournalView";
import type { LearningActions, LearningState } from "@/components/journal/useLearning";
import { ProgressPage } from "@/components/progress/ProgressPage";
import { ProgressView } from "@/components/progress/ProgressView";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { journalSection, JOURNAL_SECTIONS } from "@/lib/challenge-routes";
import { EMPTY_RECORD, type LearningRecord } from "@/lib/learning/model";
import { saveReflection } from "@/lib/learning/schedule";
import { recordObservedSolve } from "@/lib/learning/solves";
import { AUTHORED_CHALLENGES } from "@/server/content";

const ROOT = fileURLToPath(new URL("../../src/", import.meta.url));
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => (statSync(join(ROOT, dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));

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

function populated(): LearningRecord {
  let record = recordObservedSolve(EMPTY_RECORD, "challenge-001", at(1));
  record = saveReflection(record, "challenge-001", { takeaway: "Check which cookie the middleware reads." }, at(1, 11));
  record = recordObservedSolve(record, "challenge-016", at(5));
  record = saveReflection(record, "challenge-016", { takeaway: "Joins repeat order totals." }, at(5, 11));
  record = recordObservedSolve(record, "challenge-002", at(5, 12));
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
const view = (state: LearningState, today: string | null = TODAY) => renderToStaticMarkup(createElement(ProgressView, { state, published, actions, today }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const title = (id: string) => published.find((challenge) => challenge.id === id)!.title;

describe("states", () => {
  test("loading until the browser has read storage and knows the day", () => {
    assert.match(view({ status: "loading", record: EMPTY_RECORD }), /aria-busy="true"/);
    assert.match(view(ready(populated()), null), /aria-busy="true"/);
  });

  test("blocked storage says so plainly", () => {
    const markup = view({ status: "unavailable", record: EMPTY_RECORD });
    assert.ok(markup.includes("Progress is unavailable in this browser"));
  });

  test("an empty record gets a starting point, the whole catalog and an honest empty timeline", () => {
    const markup = view(ready(EMPTY_RECORD));
    assert.ok(markup.includes("Your progress starts with your first solved challenge"));
    assert.ok(markup.includes('href="/challenges"'));
    assert.ok(text(markup).includes("Challenges solved 0 of 30"));
    assert.ok(text(markup).includes("Current streak 0 days"));
    assert.match(markup, /role="grid"/, "the calendar shows, empty, from the start");
    assert.ok(markup.includes("No activity yet"));
    assert.equal(markup.match(/>Not explored yet</g)?.length, 6);
    assert.equal(markup.match(/>Explore</g)?.length, 4, "four catalog starting points");
  });

  test("unreadable saved data is flagged and sent to the Journal, not hidden", () => {
    const markup = view(ready(populated(), { problems: [{ kind: "invalid-entry", detail: "x" } as never] }));
    assert.ok(markup.includes("Some saved learning data could not be read"));
  });
});

describe("a record with activity", () => {
  const markup = view(ready(populated()));
  const plain = text(markup);

  test("the four sections, in order", () => {
    const order = ["Learning overview", "Continue learning", "Skill breakdown", "Learning activity"].map((heading) => markup.indexOf(`>${heading}<`));
    assert.ok(order.every((index) => index > 0), String(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(!markup.includes("Your progress starts with"), "no getting-started panel once there is activity");
  });

  test("overview counts with an explanation for each", () => {
    assert.ok(plain.includes("Challenges solved 3 of 30"));
    assert.ok(plain.includes("Current streak 1 day") && plain.includes("Active days 2 days"));
    for (const label of ["Challenges solved", "Reflections written", "Recall reviews", "Categories explored"]) assert.ok(markup.includes(`>${label}<`), label);
    assert.ok(plain.includes("1 review due now"));
    assert.ok(plain.includes("1 solved without a takeaway yet"));
    assert.ok(plain.includes("Completed in this browser"));
    assert.ok(plain.includes("coverage, not skill level"));
    assert.equal(markup.match(/<dd class="mt-auto/g)?.length, 4, "every metric is explained");
  });

  test("continue learning links to the Journal sections and the challenge routes", () => {
    assert.ok(markup.includes(`href="${journalSection("recall")}"`));
    assert.ok(markup.includes(`href="${journalSection("awaiting")}"`));
    assert.ok(plain.includes(`Recall your takeaway from ${title("challenge-001")}`));
    assert.ok(plain.includes(`Write a takeaway for ${title("challenge-002")}`));
    assert.ok(plain.includes("Overdue by 3 days"));
    assert.ok(plain.includes("From your journal") && plain.includes("From the catalog"));
    assert.ok(plain.includes("Nothing here is personalised"));
  });

  test("skill breakdown: every category, counts, links to its challenges and its library filter", () => {
    for (const id of ["authentication", "api", "frontend", "database", "security", "performance"]) {
      assert.ok(markup.includes(`href="/challenges?category=${id}"`), id);
    }
    assert.ok(markup.match(/of \d+ solved/g)!.length >= 6);
    assert.equal(markup.match(/href="\/challenges\/challenge-\d{3}"/g)!.length >= 30, true, "every challenge is reachable");
  });

  test("activity lists only what the record holds", () => {
    assert.equal(markup.match(/<time /g)?.length, 5, "three solves and two reflections");
    assert.ok(plain.includes(`Solved ${title("challenge-002")}`));
    assert.ok(plain.includes(`Wrote a takeaway for ${title("challenge-016")}`));
  });

  test("nothing is scored, verified or called mastered (streaks count days, nothing more)", () => {
    // With no server connected, the only mention of verification is the status line saying it is not connected.
    const status = "Browser progress only: server-verified completions are not connected yet.";
    assert.ok(plain.includes(status));
    assert.doesNotMatch(plain.replace(status, ""), /\bscore|master|accuracy|\d+ ?%|achievement|badge|verified|synced|leaderboard|rank\b/i);
  });

  test("no answer-key text appears", () => {
    for (const authored of AUTHORED_CHALLENGES) {
      assert.ok(!markup.includes(authored.evaluation.resolutionSummary.slice(0, 50)), authored.scenario.challenge.id);
    }
  });
});

describe("page", () => {
  test("states the browser-only scope next to the heading, and links to the Journal", () => {
    const markup = renderToStaticMarkup(createElement(ProgressPage, { challenges: published }));
    assert.match(markup, /<h1[^>]*>See your learning take shape\.<\/h1>/);
    assert.ok(text(markup).includes("Not linked to an account or shared across devices"));
    assert.ok(markup.includes('href="/journal"'));
    assert.match(markup, /aria-current="page"[^>]*>Progress</);
  });

  test("the Journal's sections have the fixed anchors progress links to", () => {
    const markup = renderToStaticMarkup(createElement(JournalView, { state: ready(populated()), published, actions, today: TODAY }));
    for (const anchor of [JOURNAL_SECTIONS.recall, JOURNAL_SECTIONS.awaiting, JOURNAL_SECTIONS.practice]) assert.ok(markup.includes(`id="${anchor}"`), anchor);
  });
});

describe("boundaries", () => {
  const progressFiles = [...files("lib/progress"), ...files("components/progress")];

  test("progress reads the learning record only: no storage of its own, no network, no server code", () => {
    for (const path of progressFiles) {
      const code = source(path);
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB/, `${path}: no second copy of the record`);
      assert.doesNotMatch(code, /fetch\(|\/api\/|@\/server\/|answer-key|@\/data\/challenge-|learner-session/, path);
    }
  });

  test("selectors are pure: no React, no clock (stored instants are only converted to local days)", () => {
    for (const path of files("lib/progress")) {
      assert.doesNotMatch(source(path), /from "react"|new Date\(\)|Date\.now/, path);
    }
  });

  test("progress components use theme tokens only", () => {
    for (const path of files("components/progress")) {
      assert.doesNotMatch(source(path), /#[0-9a-f]{3,8}\b|rgb\(/i, path);
    }
  });
});
