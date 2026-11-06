/*
 * Browser-observed and server-verified completions together: classification,
 * conflicts, recommendation eligibility, and what must NOT change (the browser
 * record, the activity calendar, streaks and the timeline).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LearningActions, LearningState } from "@/components/journal/useLearning";
import { ProgressView } from "@/components/progress/ProgressView";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { EMPTY_RECORD, type LearningRecord } from "@/lib/learning/model";
import { saveReflection } from "@/lib/learning/schedule";
import { recordObservedSolve } from "@/lib/learning/solves";
import { learningActivity } from "@/lib/progress/activity";
import { activityByDay, streaks } from "@/lib/progress/calendar";
import { isCompleted, isVerified, mergeCompletions } from "@/lib/progress/completions";
import { continueLearning } from "@/lib/progress/next-steps";
import { progressOverview } from "@/lib/progress/overview";
import { skillBreakdown } from "@/lib/progress/skills";
import { browserProgress } from "@/lib/progress/source";
import type { VerifiedCompletion, VerifiedState } from "@/lib/verified/model";

const published = listPublishedChallenges();
const byId = new Map(published.map((challenge) => [challenge.id, challenge]));
const TODAY = "2026-11-05";
const at = (day: number, hour = 10) => new Date(2026, 10, day, hour);
const done = (challengeId: string, completedAt = "2026-11-03T09:00:00.000Z", contentVersion = "1+aaaaaaaaaaaa"): VerifiedCompletion => ({ challengeId, completedAt, contentVersion });
const ready = (...completions: VerifiedCompletion[]): VerifiedState => ({ status: "ready", completions });

/** Browser: 001 solved and reflected, 002 solved. */
function record(): LearningRecord {
  let value = recordObservedSolve(EMPTY_RECORD, "challenge-001", at(1));
  value = saveReflection(value, "challenge-001", { takeaway: "Check which cookie the middleware reads." }, at(1, 11));
  return recordObservedSolve(value, "challenge-002", at(4));
}
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

describe("classification", () => {
  test("without a connected server, every browser solve is browser-only and nothing is verified", () => {
    for (const verified of [undefined, { status: "not-connected" }, { status: "loading" }, { status: "no-learner" }, { status: "expired" }, { status: "unavailable", reason: "network" }] as (VerifiedState | undefined)[]) {
      const summary = mergeCompletions(browserProgress(record(), verified), published);
      assert.deepEqual([summary.completed, summary.verified, summary.browserOnly, summary.verificationAvailable], [2, 0, 2, false], JSON.stringify(verified));
      assert.ok(!isVerified(summary, "challenge-001"));
    }
  });

  test("a browser solve is never promoted: an empty verified list leaves it browser-only", () => {
    const summary = mergeCompletions(browserProgress(record(), ready()), published);
    assert.equal(summary.verificationAvailable, true);
    assert.equal(summary.verified, 0);
    assert.equal(summary.byId.get("challenge-001")!.classification, "browser-only");
  });

  test("verified, verified elsewhere, and browser-only side by side, each origin's data kept as it came", () => {
    const solves = record();
    const summary = mergeCompletions(browserProgress(solves, ready(done("challenge-001", "2026-11-01T08:00:00.000Z"), done("challenge-016"))), published);
    const one = summary.byId.get("challenge-001")!;
    assert.equal(one.classification, "verified");
    assert.equal(one.browser, solves.solves["challenge-001"], "the browser solve is the record's own entry");
    assert.equal(one.server!.completedAt, "2026-11-01T08:00:00.000Z", "different times are both kept, neither overwritten");
    assert.equal(summary.byId.get("challenge-016")!.classification, "verified-elsewhere");
    assert.equal(summary.byId.get("challenge-016")!.browser, null);
    assert.equal(summary.byId.get("challenge-002")!.classification, "browser-only", "a browser solve the server does not list stays unverified");
    assert.deepEqual([summary.completed, summary.verified, summary.browserOnly, summary.verifiedElsewhere], [3, 2, 1, 1]);
    assert.ok(isCompleted(summary, "challenge-016") && isVerified(summary, "challenge-016"));
  });

  test("duplicates keep the earliest; unpublished challenges are ignored", () => {
    const summary = mergeCompletions(browserProgress(EMPTY_RECORD, ready(done("challenge-005", "2026-11-04T00:00:00.000Z"), done("challenge-005", "2026-11-02T00:00:00.000Z"), done("challenge-999"))), published);
    assert.equal(summary.completed, 1);
    assert.equal(summary.byId.get("challenge-005")!.server!.completedAt, "2026-11-02T00:00:00.000Z");
    assert.ok(!summary.byId.has("challenge-999"));
  });

  test("the browser record is never changed", () => {
    const original = record();
    const frozen = deepFreeze(structuredClone(original));
    const source = browserProgress(frozen, ready(done("challenge-001"), done("challenge-016")));
    assert.doesNotThrow(() => {
      mergeCompletions(source, published);
      progressOverview(source, published, TODAY);
      skillBreakdown(source, published);
      continueLearning(source, published, TODAY);
    });
    assert.deepEqual(frozen, original);
  });
});

describe("progress with verified completions", () => {
  const source = browserProgress(record(), ready(done("challenge-001"), done("challenge-016")));

  test("overview: completed by either origin, split into verified and browser-only", () => {
    const overview = progressOverview(source, published, TODAY);
    assert.deepEqual([overview.solved, overview.verified, overview.browserOnly, overview.verificationAvailable], [3, 2, 1, true]);
    assert.equal(overview.awaitingReflection, 1, "only browser solves can be reflected on (002); 016 was verified elsewhere");
    const categories = new Set(["challenge-001", "challenge-002", "challenge-016"].map((id) => byId.get(id)!.category));
    assert.equal(overview.categoriesExplored, categories.size);
  });

  test("not connected: the overview is exactly what it was", () => {
    const overview = progressOverview(browserProgress(record()), published, TODAY);
    assert.deepEqual([overview.solved, overview.verified, overview.browserOnly, overview.verificationAvailable], [2, 0, 2, false]);
  });

  test("skills: verified-elsewhere counts as solved, marked verified, and is never the next challenge", () => {
    const category = byId.get("challenge-016")!.category;
    const entry = skillBreakdown(source, published).find((item) => item.id === category)!;
    const item = entry.challenges.find((c) => c.challenge.id === "challenge-016")!;
    assert.deepEqual([item.solved, item.completion], [true, "verified-elsewhere"]);
    assert.ok(entry.verified >= 1);
    assert.notEqual(entry.next?.id, "challenge-016");
  });

  test("continue learning: a challenge completed by either origin is never recommended", () => {
    const verifiedOnly = browserProgress(EMPTY_RECORD, ready(...published.slice(0, 20).map((c) => done(c.id))));
    for (const scenario of [source, verifiedOnly]) {
      const summary = mergeCompletions(scenario, published);
      const suggested = continueLearning(scenario, published, TODAY).filter((step) => step.kind === "explore" || (step.kind === "apply" && step.status === "suggested"));
      assert.ok(suggested.length > 0);
      for (const step of suggested) assert.ok(!isCompleted(summary, step.challenge.id), step.challenge.id);
    }
  });

  test("continue learning: verified completions never create recall or reflection steps", () => {
    const steps = continueLearning(browserProgress(EMPTY_RECORD, ready(done("challenge-001"), done("challenge-002"))), published, TODAY);
    assert.ok(steps.every((step) => step.kind === "explore"), steps.map((step) => step.kind).join());
    assert.ok(steps.every((step) => step.kind !== "explore" || !step.firstSolve), "a verified completion means it is not the learner's first");
  });

  test("the activity calendar, streaks and timeline stay browser-only and unchanged", () => {
    const local = browserProgress(record());
    const withServer = browserProgress(record(), ready(done("challenge-016", "2026-11-05T09:00:00.000Z"), done("challenge-001", "2026-10-20T09:00:00.000Z")));
    assert.deepEqual([...activityByDay(withServer, TODAY)], [...activityByDay(local, TODAY)]);
    assert.deepEqual(streaks(activityByDay(withServer, TODAY), TODAY), streaks(activityByDay(local, TODAY), TODAY));
    assert.deepEqual(learningActivity(withServer), learningActivity(local));
  });
});

describe("status line and markers", () => {
  const ok = () => ({ ok: true as const });
  const actions: LearningActions = { recordSolve: ok, saveReflection: ok, deleteReflection: ok, clearReflections: ok, recordRecall: ok, recordPracticeOpened: ok, exportData: () => "{}" };
  const state: LearningState = { status: "ready", record: record(), origin: "stored", hasLegacyJournal: false, problems: [], recoveryKeys: [] };
  const render = (verified?: VerifiedState) => renderToStaticMarkup(createElement(ProgressView, { state, published, actions, today: TODAY, verified }))
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");

  test("each verification state says what is shown", () => {
    assert.ok(render().includes("Browser progress only: server-verified completions are not connected yet."));
    assert.ok(render({ status: "loading" }).includes("Checking server-verified completions"));
    assert.ok(render({ status: "no-learner" }).includes("No learner session, so nothing is server-verified yet. Showing progress from this browser."));
    assert.ok(render({ status: "expired" }).includes("Your learner session has expired"));
    assert.ok(render({ status: "unavailable", reason: "not-found" }).includes("Verified completions couldn't be loaded. Showing progress from this browser."));
  });

  test("with verified completions: counts split, and verified challenges marked in the breakdown", () => {
    const text = render(ready(done("challenge-001"), done("challenge-016")));
    assert.ok(text.includes("2 verified by BugLab's server · 1 challenge completed in this browser only."));
    assert.ok(text.includes("Challenges solved 3 of 30 2 verified · 1 in this browser only"));
    assert.match(text, /Revenue Too Good to Be True Verified/);
    assert.match(text, new RegExp(`${byId.get("challenge-002")!.title} Solved`), "a browser-only solve is not marked verified");
  });

  test("a browser-only page never claims verification", () => {
    const text = render();
    assert.doesNotMatch(text.replace("Browser progress only: server-verified completions are not connected yet.", ""), /verified/i);
  });
});

describe("boundaries", () => {
  const ROOT = fileURLToPath(new URL("../../src/", import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(join(ROOT, dir)).flatMap((name) => (statSync(join(ROOT, dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));
  const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

  test("no page or component uses the HTTP source: production stays not connected", () => {
    const users = [...files("app"), ...files("components"), ...files("lib")].filter((path) => /http-source/.test(source(path)) && !path.replace(/\\/g, "/").startsWith("lib/verified/"));
    assert.deepEqual(users, []);
    assert.match(source("components/progress/ProgressView.tsx"), /useVerifiedCompletions\(\)/, "the screen uses the default, not-connected source");
  });

  test("verified code holds no server code, answer keys, scenario data or browser storage", () => {
    for (const path of files("lib/verified")) {
      const code = source(path);
      assert.doesNotMatch(code, /@\/server\/|answer-key|@\/data\/challenge-|localStorage|sessionStorage|indexedDB/, path);
    }
  });

  test("verified completions are never written into the learning record, and nothing is sent to the server", () => {
    for (const path of [...files("lib/verified"), ...files("lib/progress"), ...files("components/progress")]) {
      const code = source(path);
      assert.doesNotMatch(code, /learningActions\.(recordSolve|saveReflection)|recordObservedSolve|saveReflection\(|method: "POST"/, path);
    }
  });
});
