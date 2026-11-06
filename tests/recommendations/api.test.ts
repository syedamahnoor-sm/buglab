import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRecommendationHandler } from "@/lib/recommendations/server/handler";
import { recommendationCatalog } from "@/lib/recommendations/server/catalog";
import { MAX_REQUEST_BYTES, isDay, isInstant, parseRecommendationRequest } from "@/lib/recommendations/validation";
import { loadRecommendations } from "@/lib/recommendations/client";
import { projectBrowserSignals } from "@/lib/recommendations/adapters/browser";
import type { RecommendationPlan } from "@/lib/recommendations/types";
import { candidate, NOW, privateRecord, request as payload, TODAY } from "./fixtures";
const url = "http://localhost/api/recommendations/v1";
const post = (body: unknown, headers = {}) => new Request(url,{ method: "POST",headers: { "Content-Type": "application/json",...headers },body: JSON.stringify(body) });
const handler = (extra: Parameters<typeof createRecommendationHandler>[0] = {}) => createRecommendationHandler({ catalog: () => [candidate(),candidate({ id: "challenge-b",number: "002" })], now: () => new Date(NOW),...extra });

describe("recommendation API v1 and integration boundaries", () => {
  test("GET works without any learner route and returns a no-store cold start", async () => {
    const response = await handler()(new Request(url));
    const plan = await response.json();
    assert.equal(response.status,200); assert.equal(plan.version,1); assert.equal(plan.evidence.verified,"not-connected");
    assert.match(response.headers.get("cache-control")!,/private.*no-store/);
    assert.equal(response.headers.get("set-cookie"),null);
    assert.equal(plan.next.challenge.id,"challenge-a");
  });
  test("real catalog projection contains public metadata only", () => {
    const all = recommendationCatalog(); assert.equal(all.length,30);
    for (const c of all) assert.deepEqual(Object.keys(c).sort(),["id","number","title","description","difficulty","category","tags","technologies","estimatedMinutes","publication","completion","available"].sort());
  });
  test("invalid/overposted private and verified fields are rejected before resolving history", async () => {
    let calls = 0; const handle = handler({ verified: async () => { calls++; return { status: "unavailable" }; } });
    for (const bad of [{ ...payload(),verified: { status: "ready",completions: [] } },{ ...payload(),learnerId: "someone-else" },{ ...payload(),catalog: [] },{ ...payload(),local: { ...payload().local,reflections: "PRIVATE_WRITING" } },{ ...payload(),version: 2 }]) {
      const response = await handle(post(bad)); assert.equal(response.status,400); assert.equal(JSON.stringify(await response.json()).includes("PRIVATE_WRITING"),false);
    }
    assert.equal(calls,0);
  });
  test("strict nested shapes, sizes, real dates and query parameters", async () => {
    assert.equal(isDay("2026-02-30"),false); assert.equal(isDay("2024-02-29"),true);
    assert.equal(isInstant("2026-02-30T00:00:00Z"),false);
    for (const bad of [{ ...payload(),today: "2026-99-01" },{ ...payload(),preferences: { ...payload().preferences,minutes: -1 } },{ ...payload(),local: { ...payload().local,solves: Array.from({ length: 301 },() => ({ challengeId: "a",lastSolvedAt: NOW })) } }]) assert.equal(parseRecommendationRequest(bad).ok,false);
    for (const query of ["?verified=1","?category=api&category=frontend","?today=2026-02-30","?stretch=true","?minutes=NaN"]) assert.equal((await handler()(new Request(url+query))).status,400);
    assert.equal((await handler()(new Request(url+"?category=api&difficulty=beginner&minutes=15&stretch=1&today="+TODAY))).status,200);
  });
  test("local solves affect eligibility but can never claim verification", async () => {
    const p = payload(); p.local.solves = [{ challengeId: "challenge-a",lastSolvedAt: NOW }];
    const plan = await (await handler()(post(p))).json();
    assert.equal(plan.next.challenge.id,"challenge-b"); assert.equal(plan.evidence.verified,"not-connected");
    assert.equal(plan.path.some((c: { challenge: { id: string } }) => c.challenge.id === "challenge-a"),false);
  });
  test("sequential and concurrent learner providers share no cached recommendations", async () => {
    const handle = handler({ verified: async (r) => ({ status: "ready",coverage: "complete",completions: [{ challengeId: r.headers.get("x-test-subject") === "a" ? "challenge-a" : "challenge-b",completedAt: NOW,contentVersion: "v1" }] }) });
    const [a,b] = await Promise.all([handle(post(payload(),{ "x-test-subject": "a" })),handle(post(payload(),{ "x-test-subject": "b" }))]);
    assert.equal((await a.json()).next.challenge.id,"challenge-b"); assert.equal((await b.json()).next.challenge.id,"challenge-a");
    assert.equal((await (await handle(post(payload(),{ "x-test-subject": "a" }))).json()).next.challenge.id,"challenge-b");
  });
  test("provider failure stays unavailable, malformed records stay partial, private fields never escape", async () => {
    const failure = await (await handler({ verified: async () => { throw new Error("PRIVATE_PROVIDER_SECRET"); } })(post(payload()))).json();
    assert.equal(failure.evidence.verified,"unavailable"); assert.equal(JSON.stringify(failure).includes("PRIVATE_PROVIDER_SECRET"),false);
    const handle = handler({ verified: async () => ({ status: "ready",coverage: "complete",completions: [{ challengeId: "challenge-a",completedAt: NOW,contentVersion: "v1",resolution: "PRIVATE_KEY_TEXT" },{}] } as never) });
    const text = JSON.stringify(await (await handle(post(payload()))).json());
    assert.ok(text.includes("partial-verified-history")); assert.equal(text.includes("PRIVATE_KEY_TEXT"),false);
  });
  test("origin/media/method/body protections are bounded and sanitized", async () => {
    const handle = handler();
    assert.equal((await handle(post(payload(),{ origin: "https://other.example" }))).status,403);
    assert.equal((await handle(post(payload(),{ "sec-fetch-site": "cross-site" }))).status,403);
    assert.equal((await handle(new Request(url,{ method: "PUT" }))).status,405);
    assert.equal((await handle(new Request(url,{ method: "POST",body: "hello" }))).status,415);
    assert.equal((await handle(new Request(url,{ method: "POST",headers: { "Content-Type": "application/json" },body: "PRIVATE_BAD_JSON" }))).status,400);
    assert.equal((await handle(post(payload(),{ "content-length": String(MAX_REQUEST_BYTES+1) }))).status,413);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES+1)); controller.close(); } });
    const streamed = new Request(url,{ method: "POST",headers: { "Content-Type": "application/json" },body: stream,duplex: "half" } as RequestInit & { duplex: "half" });
    assert.equal((await handle(streamed)).status,413);
    const error = await handler({ catalog: () => { throw new Error("PRIVATE_CATALOG_SECRET"); } })(post(payload()));
    assert.equal(error.status,503); assert.equal(JSON.stringify(await error.json()).includes("PRIVATE_CATALOG_SECRET"),false);
  });
  test("read-only browser adapter uses existing schedules and never transmits writing", async () => {
    const record = privateRecord(); const before = JSON.stringify(record);
    const local = projectBrowserSignals(record,TODAY,"ready",new Set(["challenge-a"]));
    assert.equal(local.recalls[0].dueOn,TODAY); assert.deepEqual(local.practiceRequests,["challenge-a"]);
    assert.equal(JSON.stringify(local).includes("PRIVATE"),false); assert.equal(JSON.stringify(record),before);
    const handle = handler();
    const fetcher = (async (path,init) => {
      assert.equal(path,"/api/recommendations/v1"); assert.equal(init?.credentials,"omit"); assert.equal(init?.cache,"no-store");
      assert.equal(String(init?.body).includes("PRIVATE"),false);
      return handle(new Request(url,init));
    }) as typeof fetch;
    const result = await loadRecommendations(payload({ local }),new AbortController().signal,fetcher);
    assert.equal(result.recalls.length,1); assert.equal(result.next?.challenge.id,"challenge-b");
  });
  test("browser projection does not send unknown or unpublished challenge IDs", () => {
    const record = privateRecord();
    record.solves["unpublished-case"] = { ...record.solves["challenge-a"],challengeId: "unpublished-case" };
    record.reflections["unpublished-case"] = { ...record.reflections["challenge-a"],challengeId: "unpublished-case" };
    const signals = projectBrowserSignals(record,TODAY,"ready",new Set(["challenge-a"]));
    assert.equal(JSON.stringify(signals).includes("unpublished-case"),false);
    assert.deepEqual(signals.solves.map((s) => s.challengeId),["challenge-a"]);
    assert.equal(JSON.stringify(signals).includes("PRIVATE"),false);
  });
  test("client rejects malformed responses instead of rendering unvalidated data", async () => {
    const fetcher = (async () => Response.json({ version: 1,strategy: "deterministic-v1" })) as typeof fetch;
    await assert.rejects(loadRecommendations(payload(),new AbortController().signal,fetcher));
    const empty = await (await handler({ catalog: () => [] })(new Request(url))).json() as RecommendationPlan;
    assert.equal(empty.next,null); assert.deepEqual(empty.path,[]);
  });
});