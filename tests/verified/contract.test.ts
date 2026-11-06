/*
 * The proposed GET /api/learner/completions contract (lib/verified/contract.ts):
 * fixtures for each response the frontend must handle, the HTTP source over a
 * fetch double, and checks against Habin's REAL session handlers, so the
 * fixtures' learner errors and completion fields match what that server builds.
 * No route is mounted; nothing here touches production pages.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { createLearnerSessionApi } from "@/lib/learner-session/api";
import { COMPLETIONS_PATH, completionOfSession, parseCompletionsResponse } from "@/lib/verified/contract";
import { createHttpCompletionsSource } from "@/lib/verified/http-source";
import { normaliseCompletions, toVerifiedCompletion } from "@/lib/verified/model";
import { notConnectedSource } from "@/lib/verified/source";
import { createAppServices } from "@/server/app-services";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { createChallengeSessionHandlers, createLearnerHandlers, REJECTIONS } from "@/server/session/handlers";

const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"));
const publishedIds = new Set(listPublishedChallenges().map((challenge) => challenge.id));
const parse = (status: number, body: unknown) => parseCompletionsResponse(status, body, publishedIds);

describe("responses, from fixtures", () => {
  test("a list: one entry per published challenge, earliest kept, nothing but the three fields", () => {
    const state = parse(200, fixture("completions.ready"));
    assert.equal(state.status, "ready");
    assert.ok(state.status === "ready");
    assert.deepEqual(state.completions, [
      { challengeId: "challenge-001", completedAt: "2026-11-02T09:14:05.120Z", contentVersion: "1+cb30a3cc594b" },
      { challengeId: "challenge-016", completedAt: "2026-11-05T18:40:00.000Z", contentVersion: "1+27d95cb26d40" },
    ]);
    const text = JSON.stringify(state);
    assert.ok(!text.includes("FIXTURE-ONLY"), "completion details (resolution, submission) are never kept");
    assert.ok(!text.includes("challenge-999"), "an unpublished challenge is dropped");
  });

  test("an empty list is ready, with nothing verified", () => {
    assert.deepEqual(parse(200, fixture("completions.empty")), { status: "ready", completions: [] });
  });

  test("missing learner, as a 401 or as the learner state", () => {
    assert.deepEqual(parse(401, fixture("error.learner-missing")), { status: "no-learner" });
    assert.deepEqual(parse(200, fixture("completions.learner-none")), { status: "no-learner" });
    assert.deepEqual(parse(401, null), { status: "no-learner" }, "a 401 without a reason is treated as no learner");
  });

  test("expired learner, as a 401 or as the learner state", () => {
    assert.deepEqual(parse(401, fixture("error.learner-expired")), { status: "expired" });
    assert.deepEqual(parse(200, fixture("completions.learner-expired")), { status: "expired" });
  });

  test("unavailable API: not mounted, refused, rate-limited, server error, or a body that is not the contract", () => {
    assert.deepEqual(parse(404, null), { status: "unavailable", reason: "not-found" });
    assert.deepEqual(parse(403, { code: "forbidden" }), { status: "unavailable", reason: "refused" });
    assert.deepEqual(parse(429, { code: "rate-limited" }), { status: "unavailable", reason: "rate-limited" });
    assert.deepEqual(parse(500, fixture("error.server")), { status: "unavailable", reason: "server" });
    assert.deepEqual(parse(503, null), { status: "unavailable", reason: "server" });
    for (const body of [null, "<html>", [], { completions: [] }, { learner: { state: "active" } }, { learner: { state: "admin" }, completions: [] }]) {
      assert.deepEqual(parse(200, body), { status: "unavailable", reason: "invalid-response" }, JSON.stringify(body));
    }
    assert.deepEqual(parse(302, null), { status: "unavailable", reason: "invalid-response" });
  });

  test("entries are checked field by field", () => {
    assert.equal(toVerifiedCompletion({ challengeId: "challenge-001", completedAt: "2026-11-02T09:14:05Z", contentVersion: "1+a" })?.challengeId, "challenge-001");
    for (const bad of [null, "x", { challengeId: "", completedAt: "2026-11-02T09:14:05Z", contentVersion: "1" }, { challengeId: "a", completedAt: "2026-13-40T99:00:00Z", contentVersion: "1" }, { challengeId: "a", completedAt: "2026-11-02T09:14:05Z" }]) {
      assert.equal(toVerifiedCompletion(bad), null, JSON.stringify(bad));
    }
  });

  test("duplicates keep the earliest, whatever order they arrive in", () => {
    const entries = [
      { challengeId: "challenge-005", completedAt: "2026-11-04T00:00:00.000Z", contentVersion: "2" },
      { challengeId: "challenge-005", completedAt: "2026-11-01T00:00:00.000Z", contentVersion: "1" },
      { challengeId: "challenge-005", completedAt: "2026-11-03T00:00:00.000Z", contentVersion: "2" },
    ];
    assert.deepEqual(normaliseCompletions(entries, publishedIds), [entries[1]]);
    assert.deepEqual(normaliseCompletions([...entries].reverse(), publishedIds), [entries[1]]);
  });
});

describe("the HTTP source, over a fetch double", () => {
  const respond = (status: number, body: unknown) => async () => new Response(body === undefined ? null : JSON.stringify(body), { status });

  test("a same-origin GET to the completions path, parsed to a state", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const source = createHttpCompletionsSource({
      publishedIds,
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return respond(200, fixture("completions.ready"))();
      }) as typeof fetch,
    });
    const state = await source.load();
    assert.equal(source.kind, "http");
    assert.equal(state.status, "ready");
    assert.deepEqual(calls.map((call) => [call.url, call.init?.method, call.init?.credentials]), [[COMPLETIONS_PATH, "GET", "same-origin"]]);
  });

  test("errors become states, never exceptions", async () => {
    const load = (fetchImpl: typeof fetch, timeoutMs?: number) => createHttpCompletionsSource({ publishedIds, fetch: fetchImpl, timeoutMs }).load();
    assert.deepEqual(await load(respond(401, fixture("error.learner-expired")) as typeof fetch), { status: "expired" });
    assert.deepEqual(await load(respond(404, undefined) as typeof fetch), { status: "unavailable", reason: "not-found" });
    assert.deepEqual(await load((async () => new Response("<html>not json</html>", { status: 200 })) as typeof fetch), { status: "unavailable", reason: "invalid-response" });
    assert.deepEqual(await load((async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch), { status: "unavailable", reason: "network" });
    const hang = ((_: unknown, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    assert.deepEqual(await load(hang, 20), { status: "unavailable", reason: "timeout" });
  });

  test("the caller's own abort is rethrown, as the other clients do", async () => {
    const controller = new AbortController();
    const hang = ((_: unknown, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    const pending = createHttpCompletionsSource({ publishedIds, fetch: hang }).load(controller.signal);
    controller.abort();
    await assert.rejects(pending);
  });

  test("the not-connected source answers at once and never fetches", async () => {
    const original = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error("must not fetch");
    }) as typeof fetch;
    try {
      assert.deepEqual(await notConnectedSource.load(), { status: "not-connected" });
      assert.equal(notConnectedSource.kind, "not-connected");
      assert.equal(fetched, false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("against the real session handlers (no route mounted)", () => {
  const APP = "https://buglab.example";
  function backend() {
    const services = createAppServices({ challenges: createDefaultChallengeRegistry(), appOrigin: APP, trustedProxyHops: 0 });
    const learner = createLearnerHandlers({ service: services.service, appOrigin: APP });
    const session = createChallengeSessionHandlers({ service: services.service, appOrigin: APP });
    const jar = new Map<string, string>();
    const bodies: { path: string; status: number; body: unknown }[] = [];
    const browserFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), APP);
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      headers.set("sec-fetch-site", "same-origin");
      if (method !== "GET") headers.set("origin", APP);
      if (jar.size) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
      const request = new Request(url, { method, headers, body: init.body, signal: init.signal });
      const match = url.pathname.match(/^\/api\/challenges\/([^/]+)\/(session|diagnosis)$/);
      const context = { params: Promise.resolve({ challengeId: decodeURIComponent(match?.[1] ?? "") }) };
      let response: Response;
      if (url.pathname === "/api/learner") response = await (method === "POST" ? learner.POST(request) : learner.GET(request));
      else if (match?.[2] === "session") response = await (method === "POST" ? session.POST(request, context) : session.GET(request, context));
      else if (match?.[2] === "diagnosis") response = await services.diagnosis(request, context);
      else response = new Response(null, { status: 404 });
      const cookie = response.headers.get("set-cookie");
      if (cookie) {
        const [pair] = cookie.split(";");
        jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
      }
      bodies.push({ path: url.pathname, status: response.status, body: await response.clone().json().catch(() => null) });
      return response;
    }) as typeof fetch;
    return { api: createLearnerSessionApi({ fetch: browserFetch }), fetch: browserFetch, bodies };
  }

  test("the learner errors in the fixtures are the server's own", async () => {
    assert.deepEqual(fixture("error.learner-missing"), { status: "error", code: "learner-missing", message: REJECTIONS["learner-missing"].message });
    assert.deepEqual(fixture("error.learner-expired"), { status: "error", code: "learner-expired", message: REJECTIONS["learner-expired"].message });
    assert.equal(REJECTIONS["learner-missing"].status, 401);
    assert.equal(REJECTIONS["learner-expired"].status, 401);

    // A browser with no learner asks for a session: the real 401 body parses as "no learner".
    const { api, bodies } = backend();
    await api.getSession("challenge-001");
    const real = bodies.at(-1)!;
    assert.equal(real.status, 401);
    assert.deepEqual(parse(real.status, real.body), { status: "no-learner" });
    assert.deepEqual(real.body, fixture("error.learner-missing"));
  });

  test("a completed session becomes exactly one verified completion, without its completion details", async () => {
    const { api } = backend();
    await api.startLearner();
    await api.startSession("challenge-001");
    const answer = await api.submitDiagnosis(
      "challenge-001",
      { rootCauseId: provisionalAnswerKey.correctRootCauseId, explanation: "Login signs the cookie but the middleware reads it as unsigned.", evidence: [{ kind: "log", logId: challenge001.logs[0].id }] },
      { idempotencyKey: crypto.randomUUID() },
    );
    assert.ok(answer.kind === "response" && answer.response.status === "correct");
    const read = await api.getSession("challenge-001");
    assert.ok(read.ok && read.data.state === "active" && read.data.session.status === "completed");
    const session = read.data.session;

    const entry = completionOfSession(session)!;
    assert.deepEqual(Object.keys(entry).sort(), ["challengeId", "completedAt", "contentVersion"]);
    // The endpoint may send the whole session view; only the three fields survive.
    const state = parse(200, { learner: { state: "active" }, completions: [{ ...session }] });
    assert.deepEqual(state, { status: "ready", completions: [entry] });
    assert.ok(!JSON.stringify(state).includes(provisionalAnswerKey.resolutionSummary.slice(0, 40)), "no answer-key text");

    // The fixtures use the same formats the server produces.
    const sample = (fixture("completions.ready") as { completions: { contentVersion: string; completedAt: string }[] }).completions[0];
    const shape = (value: string) => value.replace(/[0-9a-f]/g, "x");
    assert.equal(shape(sample.contentVersion).length, shape(entry.contentVersion).length);
    assert.match(entry.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.match(sample.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("an unfinished session is not a completion", async () => {
    const { api } = backend();
    await api.startLearner();
    const started = await api.startSession("challenge-002");
    assert.ok(started.ok && started.data.session.status === "active");
    assert.equal(completionOfSession(started.data.session), null);
  });

  test("today the completions route does not exist: the HTTP source reports it unavailable, not empty", async () => {
    const { fetch: browserFetch } = backend();
    assert.deepEqual(await createHttpCompletionsSource({ publishedIds, fetch: browserFetch }).load(), { status: "unavailable", reason: "not-found" });
  });
});
