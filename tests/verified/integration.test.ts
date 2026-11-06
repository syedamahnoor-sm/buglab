/*
 * Sprint 14B: the configured verified-completions source, end to end over mock
 * HTTP, into Learning Progress. Activation is off by default and impossible in
 * production builds; when on, every server answer is reconciled with real
 * browser records without changing them, and only the server's own list can
 * make a challenge verified.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LearningActions, LearningState } from "@/components/journal/useLearning";
import { ProgressView } from "@/components/progress/ProgressView";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { EMPTY_RECORD, serializeRecord, type LearningRecord } from "@/lib/learning/model";
import { recordRecall, saveReflection } from "@/lib/learning/schedule";
import { recordObservedSolve } from "@/lib/learning/solves";
import { activityByDay, streaks } from "@/lib/progress/calendar";
import { mergeCompletions } from "@/lib/progress/completions";
import { continueLearning } from "@/lib/progress/next-steps";
import { progressOverview } from "@/lib/progress/overview";
import { browserProgress } from "@/lib/progress/source";
import { BUILD_CONFIG, buildVerifiedSource, createVerifiedSource, resolveVerifiedSourceConfig } from "@/lib/verified/config";
import { COMPLETIONS_PATH } from "@/lib/verified/contract";
import type { VerifiedState } from "@/lib/verified/model";
import { notConnectedSource } from "@/lib/verified/source";

const published = listPublishedChallenges();
const publishedIds = new Set(published.map((challenge) => challenge.id));
const TODAY = "2026-11-05";
const at = (day: number, hour = 10) => new Date(2026, 10, day, hour);
const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"));

/** A real browser record: 001 solved, reflected and reviewed; 002 solved; 016 solved. */
function browserRecord(): LearningRecord {
  let record = recordObservedSolve(EMPTY_RECORD, "challenge-001", at(1));
  record = saveReflection(record, "challenge-001", { takeaway: "Check which cookie the middleware reads." }, at(1, 11));
  record = recordRecall(record, "challenge-001", "got-it", at(2, 9));
  record = recordObservedSolve(record, "challenge-002", at(3));
  return recordObservedSolve(record, "challenge-016", at(4));
}

/** A mock server: answers GET /api/learner/completions as told, and records every request. */
function mockServer(answer: (request: Request) => Response | Promise<Response>) {
  const requests: { method: string; path: string; credentials: RequestCredentials | undefined; body: unknown }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = new Request(new URL(String(input), "https://buglab.example"), { method: init.method, signal: init.signal });
    requests.push({ method: request.method, path: new URL(request.url).pathname, credentials: init.credentials, body: init.body });
    return answer(request);
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const enabled = resolveVerifiedSourceConfig({ flag: "enabled", nodeEnv: "development" });
const load = (server: ReturnType<typeof mockServer>, timeoutMs?: number) =>
  createVerifiedSource(enabled, { publishedIds, fetch: server.fetch, timeoutMs }).load();

describe("activation", () => {
  test("disabled by default, and impossible in a production build whatever the flag says", () => {
    assert.deepEqual(resolveVerifiedSourceConfig({ flag: undefined, nodeEnv: "development" }), { mode: "disconnected", reason: "flag-off" });
    for (const flag of ["", "true", "1", "yes", "Enabled", "enabled ", "on"]) {
      assert.equal(resolveVerifiedSourceConfig({ flag, nodeEnv: "development" }).mode, "disconnected", JSON.stringify(flag));
    }
    assert.deepEqual(resolveVerifiedSourceConfig({ flag: "enabled", nodeEnv: "production" }), { mode: "disconnected", reason: "production-build" });
    assert.deepEqual(resolveVerifiedSourceConfig({ flag: "enabled", nodeEnv: "development" }), { mode: "http" });
    assert.deepEqual(resolveVerifiedSourceConfig({ flag: "enabled", nodeEnv: "test" }), { mode: "http" });
  });

  test("this build (tests run without the flag) is disconnected, and the app's source is the not-connected one", () => {
    assert.equal(BUILD_CONFIG.mode, "disconnected");
    assert.equal(buildVerifiedSource({ publishedIds }), notConnectedSource);
  });

  test("the build-time switch has the same rule as resolveVerifiedSourceConfig", () => {
    const code = readFileSync(fileURLToPath(new URL("../../src/lib/verified/config.ts", import.meta.url)), "utf8");
    assert.match(code, /const BUILD_ALLOWS_HTTP = process\.env\.NODE_ENV !== "production" && process\.env\.NEXT_PUBLIC_BUGLAB_VERIFIED_COMPLETIONS === "enabled";/);
  });

  test("a disconnected configuration never makes a request", async () => {
    const server = mockServer(() => json(200, fixture("completions.ready")));
    const source = createVerifiedSource({ mode: "disconnected", reason: "flag-off" }, { publishedIds, fetch: server.fetch });
    assert.equal(source, notConnectedSource);
    assert.deepEqual(await source.load(), { status: "not-connected" });
    assert.equal(server.requests.length, 0);
  });

  test("an enabled source only ever reads: one same-origin GET, no body", async () => {
    const server = mockServer(() => json(200, fixture("completions.ready")));
    await load(server);
    assert.deepEqual(server.requests, [{ method: "GET", path: COMPLETIONS_PATH, credentials: "same-origin", body: undefined }]);
  });
});

describe("mock HTTP responses", () => {
  test("success", async () => {
    const state = await load(mockServer(() => json(200, fixture("completions.ready"))));
    assert.equal(state.status, "ready");
    assert.deepEqual(state.status === "ready" && state.completions.map((c) => c.challengeId), ["challenge-001", "challenge-016"]);
  });

  test("unauthorized: no learner, expired learner, and a 401 that gives no reason", async () => {
    assert.deepEqual(await load(mockServer(() => json(401, fixture("error.learner-missing")))), { status: "no-learner" });
    assert.deepEqual(await load(mockServer(() => json(401, fixture("error.learner-expired")))), { status: "expired" });
    assert.deepEqual(await load(mockServer(() => new Response(null, { status: 401 }))), { status: "no-learner" });
  });

  test("malformed responses are never trusted", async () => {
    const bodies: (() => Response)[] = [
      () => new Response("<!doctype html><title>Not JSON</title>", { status: 200, headers: { "content-type": "text/html" } }),
      () => json(200, { completions: [{ challengeId: "challenge-001", completedAt: "2026-11-02T09:14:05.120Z", contentVersion: "1" }] }),
      () => json(200, { learner: { state: "active" }, completions: { "challenge-001": true } }),
      () => json(200, { learner: { state: "superuser" }, completions: [] }),
      () => json(200, null),
    ];
    for (const body of bodies) assert.deepEqual(await load(mockServer(body)), { status: "unavailable", reason: "invalid-response" });
    // Entries that are wrong one by one are dropped; the rest still count.
    const partly = await load(mockServer(() => json(200, { learner: { state: "active" }, completions: [{ challengeId: "challenge-001" }, { challengeId: "challenge-002", completedAt: "2026-11-02T09:14:05.120Z", contentVersion: "1+7b6dabf138c6" }] })));
    assert.deepEqual(partly.status === "ready" && partly.completions.map((c) => c.challengeId), ["challenge-002"]);
  });

  test("timeouts and network failures", async () => {
    const hang = mockServer((request) => new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason))));
    assert.deepEqual(await load(hang, 25), { status: "unavailable", reason: "timeout" });
    assert.deepEqual(await load(mockServer(() => Promise.reject(new TypeError("Failed to fetch")))), { status: "unavailable", reason: "network" });
  });

  test("server errors, rate limiting, refusal and a route that is not mounted", async () => {
    assert.deepEqual(await load(mockServer(() => json(500, fixture("error.server")))), { status: "unavailable", reason: "server" });
    assert.deepEqual(await load(mockServer(() => new Response("Bad gateway", { status: 502 }))), { status: "unavailable", reason: "server" });
    assert.deepEqual(await load(mockServer(() => json(429, { status: "error", code: "rate-limited" }, { "retry-after": "30" }))), { status: "unavailable", reason: "rate-limited" });
    assert.deepEqual(await load(mockServer(() => json(403, { status: "error", code: "forbidden" }))), { status: "unavailable", reason: "refused" });
    assert.deepEqual(await load(mockServer(() => new Response(null, { status: 404 }))), { status: "unavailable", reason: "not-found" });
  });
});

describe("reconciliation with real browser records", () => {
  const serverSays = (completions: unknown[]) => mockServer(() => json(200, { learner: { state: "active" }, completions }));
  const entry = (challengeId: string, completedAt: string, contentVersion = "1+aaaaaaaaaaaa") => ({ challengeId, completedAt, contentVersion });

  test("only challenges on the server's list become verified; the server's times and the browser's are both kept", async () => {
    const record = browserRecord();
    const before = serializeRecord(record);
    const state = await load(serverSays([entry("challenge-001", "2026-10-30T12:00:00.000Z"), entry("challenge-020", "2026-11-02T08:00:00.000Z")]));
    const summary = mergeCompletions(browserProgress(record, state), published);

    assert.equal(summary.byId.get("challenge-001")!.classification, "verified");
    assert.equal(summary.byId.get("challenge-001")!.server!.completedAt, "2026-10-30T12:00:00.000Z");
    assert.equal(summary.byId.get("challenge-001")!.browser!.firstSolvedAt, at(1).toISOString());
    assert.equal(summary.byId.get("challenge-002")!.classification, "browser-only", "solved here, not on the server's list: not verified");
    assert.equal(summary.byId.get("challenge-016")!.classification, "browser-only");
    assert.equal(summary.byId.get("challenge-020")!.classification, "verified-elsewhere");
    assert.deepEqual([summary.completed, summary.verified, summary.browserOnly], [4, 2, 2]);
    assert.equal(serializeRecord(record), before, "the browser record is unchanged");
  });

  test("no browser solve is verified without the server listing it: every non-ready answer leaves all of them browser-only", async () => {
    const record = browserRecord();
    const answers: (() => Response | Promise<Response>)[] = [
      () => json(401, fixture("error.learner-missing")),
      () => json(401, fixture("error.learner-expired")),
      () => json(500, fixture("error.server")),
      () => new Response(null, { status: 404 }),
      () => json(200, { learner: { state: "active" } }),
      () => json(200, fixture("completions.empty")),
      () => Promise.reject(new TypeError("Failed to fetch")),
    ];
    for (const answer of answers) {
      const summary = mergeCompletions(browserProgress(record, await load(mockServer(answer))), published);
      assert.equal(summary.verified, 0);
      assert.equal(summary.browserOnly, 3, "browser solves stay counted, as browser-only");
    }
  });

  test("duplicates and unpublished challenges on the server's list", async () => {
    const state = await load(serverSays([entry("challenge-002", "2026-11-04T00:00:00.000Z"), entry("challenge-002", "2026-11-01T00:00:00.000Z"), entry("challenge-999", "2026-11-01T00:00:00.000Z"), entry("draft-challenge", "2026-11-01T00:00:00.000Z")]));
    assert.deepEqual(state.status === "ready" && state.completions, [entry("challenge-002", "2026-11-01T00:00:00.000Z")]);
    const summary = mergeCompletions(browserProgress(browserRecord(), state), published);
    assert.ok(!summary.byId.has("challenge-999") && !summary.byId.has("draft-challenge"), "nothing about an unpublished challenge reaches progress");
  });

  test("an expired learner with local solves: browser progress, reflections, recall and streaks all as before", async () => {
    const record = browserRecord();
    const local = browserProgress(record);
    const expired = browserProgress(record, await load(mockServer(() => json(401, fixture("error.learner-expired")))));
    assert.deepEqual(progressOverview(expired, published, TODAY), progressOverview(local, published, TODAY));
    assert.deepEqual(continueLearning(expired, published, TODAY), continueLearning(local, published, TODAY));
    assert.deepEqual([...activityByDay(expired, TODAY)], [...activityByDay(local, TODAY)]);
  });

  test("a ready list changes eligibility but never the browser's history or streaks", async () => {
    const record = browserRecord();
    const local = browserProgress(record);
    const ready = browserProgress(record, await load(serverSays([entry("challenge-006", "2026-11-05T08:00:00.000Z"), entry("challenge-011", "2026-11-05T08:30:00.000Z")])));
    assert.deepEqual(streaks(activityByDay(ready, TODAY), TODAY), streaks(activityByDay(local, TODAY), TODAY));
    const recommended = continueLearning(ready, published, TODAY).map((step) => step.challenge.id);
    assert.ok(!recommended.includes("challenge-006") && !recommended.includes("challenge-011"), "completed on the server: not recommended again");
    assert.ok(continueLearning(local, published, TODAY).some((step) => ["challenge-006", "challenge-011"].includes(step.challenge.id)), "they were recommended before");
  });

  test("the page shows each outcome honestly", async () => {
    const ok = () => ({ ok: true as const });
    const actions: LearningActions = { recordSolve: ok, saveReflection: ok, deleteReflection: ok, clearReflections: ok, recordRecall: ok, recordPracticeOpened: ok, exportData: () => "{}" };
    const state: LearningState = { status: "ready", record: browserRecord(), origin: "stored", hasLegacyJournal: false, problems: [], recoveryKeys: [] };
    const render = (verified: VerifiedState) =>
      renderToStaticMarkup(createElement(ProgressView, { state, published, actions, today: TODAY, verified })).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

    const ready = render(await load(serverSays([entry("challenge-001", "2026-10-30T12:00:00.000Z")])));
    assert.ok(ready.includes("1 verified by BugLab's server · 2 challenges completed in this browser only."));
    assert.ok(render(await load(mockServer(() => json(401, fixture("error.learner-expired"))))).includes("Your learner session has expired"));
    assert.ok(render(await load(mockServer(() => new Response(null, { status: 404 })))).includes("Verified completions couldn't be loaded. Showing progress from this browser."));
  });
});
