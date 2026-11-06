import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listPublishedChallenges } from "@/lib/challenge-catalog";
import { recommend, eligibleCatalog, publicMetadata } from "@/lib/recommendations/engine";
import { WEIGHTS } from "@/lib/recommendations/types";
import { explainReason } from "@/lib/recommendations/reasons";
import { candidate, input, NOW } from "./fixtures";

const catalog = listPublishedChallenges().map((c) => ({ ...publicMetadata(c), publication: "published" as const, available: true, completion: c.completion }));
const completion = (challengeId: string, contentVersion = "v1") => ({ challengeId, contentVersion, completedAt: NOW });
function frozen<T>(value: T): T {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) frozen(child); }
  return value;
}
describe("deterministic recommendation engine", () => {
  test("cold start: published beginner work, five unique steps, honest unknown verification", () => {
    const plan = recommend(input({ catalog }));
    assert.equal(plan.mode,"cold-start");
    assert.equal(plan.next?.challenge.id,"challenge-002");
    assert.equal(plan.path.length,5);
    assert.equal(new Set(plan.path.map((r) => r.challenge.id)).size,5);
    assert.equal(new Set(plan.path.map((r) => r.challenge.category)).size,5,"Cold-start path should span practice areas when equally suitable work exists");
    assert.ok(plan.path.every((r) => r.challenge.difficulty === "beginner"));
    assert.equal(plan.evidence.verified,"not-connected");
    assert.ok(plan.notices.includes("completion-history-unavailable"));
    assert.equal(plan.availableCount,30);
  });
  test("input permutation, repeatability and immutable inputs", () => {
    const original = input({ catalog });
    const expected = recommend(frozen(structuredClone(original)));
    assert.deepEqual(recommend(original),expected);
    assert.deepEqual(recommend({ ...original, catalog: [...catalog].reverse() }),expected);
  });
  test("ties use numeric challenge number then ID, not source array order", () => {
    const a = candidate({ id: "challenge-z", number: "002" });
    const b = candidate({ id: "challenge-b", number: "010" });
    const c = candidate({ id: "challenge-a", number: "002" });
    assert.deepEqual(recommend(input({ catalog: [b,a,c] })).path.map((r) => r.challenge.id),[c.id,a.id,b.id]);
  });
  test("draft, archived, unavailable, unsupported and ambiguous entries are excluded", () => {
    const candidates = [candidate({ id: "draft", publication: "draft" }), candidate({ id: "archived", publication: "archived" }), candidate({ id: "offline", available: false }), candidate({ id: "future-fix", completion: "fix" }), candidate({ id: "duplicate" }), candidate({ id: "duplicate", title: "Conflict" }), candidate({ id: "valid" })];
    assert.deepEqual(eligibleCatalog(candidates).map((c) => c.id),["valid"]);
    const text = JSON.stringify(recommend(input({ catalog: candidates })));
    for (const hidden of ["draft","archived","offline","future-fix","duplicate","Conflict"]) assert.equal(text.includes(hidden),false);
  });
  test("verified completion exclusion survives local opt-out and older content versions", () => {
    const i = input({ catalog, verified: { status: "ready", coverage: "complete", completions: [completion("challenge-002","old-version")] } });
    i.preferences.useLocalSignals = false;
    assert.equal(recommend(i).path.some((r) => r.challenge.id === "challenge-002"),false);
    assert.equal(recommend(i).evidence.verified,"ready");
  });
  test("browser solves suppress work separately and never become verified", () => {
    const i = input({ catalog });
    i.local.solves = [{ challengeId: "challenge-002", lastSolvedAt: NOW }];
    let p = recommend(i);
    assert.equal(p.path.some((r) => r.challenge.id === "challenge-002"),false);
    assert.equal(p.evidence.verified,"not-connected");
    i.preferences.useLocalSignals = false;
    p = recommend(i);
    assert.equal(p.next?.challenge.id,"challenge-002");
    assert.equal(p.evidence.local,"disabled");
  });
  test("initial weights and bounded factor contributions are product heuristics", () => {
    assert.equal(Object.values(WEIGHTS).reduce((a,b) => a+b,0),100);
    const source = candidate({ id: "source", number: "002" });
    const i = input({ catalog: [source,candidate()] });
    i.local = { status: "ready", solves: [{ challengeId: "source", lastSolvedAt: NOW }], recalls: [], practiceRequests: ["source"] };
    i.preferences.category = "api"; i.preferences.minutes = 20;
    const result = recommend(i).next!;
    assert.deepEqual(result.factors,{ difficulty: 30,goal: 20,practice: 20,coverage: 7,continuity: 10,time: 5 });
    assert.equal(result.score,92);
    assert.ok(result.reasons.some((r) => r.code === "practice-request" && r.basis === "browser-local"));
    for (const reason of result.reasons) assert.ok(explainReason(reason,result).length > 0);
  });
  test("partial or unavailable history does not claim complete coverage", () => {
    const i = input({ catalog });
    i.local.status = "partial";
    i.verified = { status: "ready", coverage: "partial", completions: [] };
    const p = recommend(i);
    assert.ok(p.notices.includes("partial-verified-history"));
    assert.ok(p.notices.includes("partial-local-data"));
    assert.ok(p.path.every((r) => r.factors.coverage === 0));
    assert.equal(p.evidence.verified,"ready");
    assert.equal(recommend({ ...i, verified: { status: "unavailable" } }).evidence.verified,"unavailable");
  });
  test("sparse history never invents proficiency or historical difficulty", () => {
    const i = input({ catalog, verified: { status: "ready", coverage: "complete", completions: [completion("challenge-002"),completion("challenge-006"),completion("challenge-011")] } });
    i.preferences.allowStretch = true;
    assert.deepEqual(recommend(i).target,{ difficulty: "beginner",basis: "default" });
    if (i.verified.status === "ready") i.verified.difficultyEvidence = ["challenge-002","challenge-006","challenge-011"].map((challengeId) => ({ challengeId,contentVersion: "v1",difficulty: "beginner" }));
    assert.deepEqual(recommend(i).target,{ difficulty: "intermediate",basis: "verified-exposure" });
    assert.ok(recommend(i).path.every((r) => r.challenge.difficulty !== "advanced"),"A promotion must not stack with another tier of stretch");
    i.preferences.difficulty = "beginner";
    assert.equal(recommend(i).target.basis,"preference");
    assert.ok(recommend(i).path.every((r) => r.challenge.difficulty !== "advanced"));
  });
  test("mismatched evidence versions and repeated solves cannot promote difficulty", () => {
    const i = input({ catalog, verified: { status: "ready", coverage: "complete", completions: [completion("challenge-002")], difficultyEvidence: Array.from({ length: 3 },() => ({ challengeId: "challenge-002", contentVersion: "v2", difficulty: "intermediate" })) } });
    i.preferences.allowStretch = true;
    assert.equal(recommend(i).target.difficulty,"beginner");
  });
  test("conflicting duplicate completion/evidence records remain permutation invariant", () => {
    const completions = [completion("challenge-002","a"),completion("challenge-002","b"),completion("challenge-006","a"),completion("challenge-011","a")];
    const evidence = [
      { challengeId: "challenge-002",contentVersion: "a",difficulty: "beginner" as const },
      { challengeId: "challenge-002",contentVersion: "a",difficulty: "advanced" as const },
      { challengeId: "challenge-006",contentVersion: "a",difficulty: "beginner" as const },
      { challengeId: "challenge-011",contentVersion: "a",difficulty: "beginner" as const },
    ];
    const i = input({ catalog,verified: { status: "ready",coverage: "complete",completions,difficultyEvidence: evidence } });
    i.preferences.allowStretch = true;
    const expected = recommend(i);
    assert.equal(expected.target.difficulty,"beginner");
    assert.deepEqual(recommend({ ...i,verified: { status: "ready",coverage: "complete",completions: [...completions].reverse(),difficultyEvidence: [...evidence].reverse() } }),expected);
  });
  test("recall is oldest due first, distinct, and may refer to completed work", () => {
    const i = input({ catalog, verified: { status: "ready", coverage: "complete", completions: [completion("challenge-002")] } });
    i.local.recalls = [{ challengeId: "challenge-006",dueOn: "2026-11-06" },{ challengeId: "challenge-002",dueOn: "2026-11-01" },{ challengeId: "challenge-002",dueOn: "2026-11-02" },{ challengeId: "missing",dueOn: "2026-11-01" },{ challengeId: "challenge-011",dueOn: "2026-11-07" }];
    const p = recommend(i);
    assert.deepEqual(p.recalls.map((r) => [r.challenge.id,r.overdueDays]),[["challenge-002",5],["challenge-006",0]]);
    assert.equal(p.path.some((r) => r.challenge.id === "challenge-002"),false);
    assert.deepEqual(recommend({ ...i, local: { status: "ready",solves: [],recalls: [],practiceRequests: [] } }).recalls,[]);
  });
  test("recency compares actual UTC instants, including optional fractional seconds", () => {
    const older = candidate({ id: "older",number: "001",category: "api",tags: ["HTTP"] });
    const newer = candidate({ id: "newer",number: "002",category: "frontend",tags: ["React"] });
    const target = candidate({ id: "target",number: "003",category: "frontend",tags: ["React"] });
    const i = input({ catalog: [older,newer,target],verified: { status: "ready",coverage: "complete",completions: [
      { challengeId: "older",contentVersion: "v1",completedAt: "2026-11-06T11:00:00Z" },
      { challengeId: "newer",contentVersion: "v1",completedAt: "2026-11-06T11:00:00.001Z" },
    ] } });
    assert.equal(recommend(i).next?.factors.continuity,10);
  });
  test("calendar boundaries and no learner-local day", () => {
    const i = input(); i.today = "2024-03-01"; i.local.recalls = [{ challengeId: "challenge-a",dueOn: "2024-02-28" }];
    assert.equal(recommend(i).recalls[0].overdueDays,2);
    i.today = "2026-03-09"; i.local.recalls = [{ challengeId: "challenge-a",dueOn: "2026-03-08" }];
    assert.equal(recommend(i).recalls[0].overdueDays,1);
    assert.deepEqual(recommend({ ...i,today: null }).recalls,[]);
    assert.throws(() => recommend({ ...i,today: "2026-02-30" }));
  });
  test("path selection does not simulate completions and caps distinct new work at five", () => {
    const p = recommend(input({ catalog }));
    const ids = p.path.map((r) => r.challenge.id);
    assert.ok(p.practice.every((r) => ids.includes(r.challenge.id) && r.challenge.id !== p.next?.challenge.id));
    assert.ok(new Set([...ids,...p.practice.map((r) => r.challenge.id),p.next!.challenge.id]).size <= 5);
    assert.equal(p.next?.challenge.id,ids[0]);
    assert.ok(p.path.every((r) => r.factors.continuity === 0));
    assert.equal(recommend(input({ catalog: [] })).next,null);
  });
  test("public projection discards arbitrary private fields", () => {
    const dirty = { ...candidate(), answerKey: "DO_NOT_EXPOSE", reflection: "PRIVATE", userId: "ANOTHER_LEARNER" };
    const text = JSON.stringify(recommend(input({ catalog: [dirty] })));
    for (const value of ["DO_NOT_EXPOSE","PRIVATE","ANOTHER_LEARNER","answerKey","userId"]) assert.equal(text.includes(value),false);
  });
});