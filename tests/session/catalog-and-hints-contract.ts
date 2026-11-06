/*
 * Two contracts that must hold on EVERY store, run over EVERY registered challenge (not just Challenge 001):
 *
 *   1. CATALOG COMPATIBILITY. The default composition serves each published challenge end to end, the publication gate
 *      treats each one the same way (strict 404, draft and archived included), history survives unpublishing and
 *      republishing, and nothing public carries an answer key.
 *   2. INVESTIGATION HINTS. A wrong diagnosis through the session service gets the very hints the live diagnosis endpoint
 *      gives (same provider, same selection), a replay gets them again, a replay never changes the outcome or the completion
 *      state, the provider is optional, and no hint or response leaks the answer.
 *
 * Not a test file (no `.test.ts`): tests/session/catalog-and-hints.test.ts runs it on the in-memory store and
 * tests/postgres/catalog-and-hints.test.ts on PostgreSQL. Nothing here knows how many challenges there are; adding one to
 * the catalog adds it to every check.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { REGISTERED_CHALLENGES } from "@/data/catalog";
import { createCatalog } from "@/lib/catalog/catalog";
import { type AppServices, type AppServicesOptions, type SessionStore } from "@/server/app-services";
import { AUTHORED_CHALLENGES, investigationHintsFor } from "@/server/content";
import { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { createDiagnosisHandler } from "@/server/diagnosis/handler";
import { publishedChallengeIds, restrictToPublished } from "@/server/diagnosis/published";
import { createDefaultRegistry } from "@/server/diagnosis/registry";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { createLearnerSessionService } from "@/server/session/service";
import type { DiagnosisSubmission } from "@/types/diagnosis";
import type { EvidenceRef } from "@/types/investigation";
import { CHALLENGE_ID, CORRECT_ID, RESOLUTION, WRONG_IDS, post } from "../diagnosis/fixtures";

export interface Harness {
  /** The store under test. */
  readonly store: SessionStore;
  /** A fresh application instance (a "deploy") over that same store. */
  compose(options?: Partial<AppServicesOptions>): AppServices;
}

const ORIGIN = "http://localhost:3000";
const EXPLANATION =
  "The evidence I collected points to this cause: the logs and requests show the failure happening exactly where this explains it.";
/** Room for every wrong option of a challenge in one session; the default window (three) is tested elsewhere. */
const ROOMY = { limit: 1000, windowMs: 10 * 60 * 1000 } as const;
const NOTHING: ReadonlySet<string> = new Set();
const uuid = (n: number) => `0a0b0c0d-2222-4000-8000-${String(n).padStart(12, "0")}`;

/** What one challenge looks like to a test: how to answer it right, how to answer it wrong, and what it must not leak. */
export interface Case {
  readonly id: string;
  readonly correct: string;
  readonly wrong: readonly string[];
  /** Evidence covering every key observation (for challenge 001, the one request its fixtures use). */
  readonly evidence: readonly EvidenceRef[];
  readonly logEvidence: EvidenceRef;
  readonly networkEvidence: EvidenceRef;
  readonly resolution: string;
  /** The challenge's own investigation hints, or undefined for the generic ones. */
  readonly hints: readonly string[] | undefined;
  readonly options: readonly { id: string; label: string }[];
}

export function allCases(): Case[] {
  const authored = new Map(AUTHORED_CHALLENGES.map((challenge) => [challenge.scenario.challenge.id, challenge]));
  return REGISTERED_CHALLENGES.map((entry) => {
    const { scenario } = entry;
    const id = scenario.challenge.id;
    const logEvidence: EvidenceRef = { kind: "log", logId: scenario.logs[0].id };
    const networkEvidence: EvidenceRef = { kind: "network", requestId: scenario.network[0].id };
    const options = scenario.rootCauseOptions.map((option) => ({ id: option.id, label: option.label }));
    const key = authored.get(id);
    if (key) {
      return {
        id,
        correct: key.evaluation.correctRootCauseId,
        wrong: options.filter((option) => option.id !== key.evaluation.correctRootCauseId).map((option) => option.id),
        evidence: key.evaluation.keyObservations.map((observation) => observation.refs[0]),
        logEvidence,
        networkEvidence,
        resolution: key.evaluation.resolutionSummary,
        hints: key.investigationHints,
        options,
      };
    }
    // Challenge 001 is the one challenge not authored with src/server/content; it has no hints of its own.
    assert.equal(id, CHALLENGE_ID, `${id} is registered but has no answer key in src/server/content`);
    return {
      id,
      correct: CORRECT_ID,
      wrong: WRONG_IDS,
      evidence: [{ kind: "network", requestId: "req-04" }],
      logEvidence,
      networkEvidence,
      resolution: RESOLUTION,
      hints: undefined,
      options,
    };
  });
}

const bodyFor = (c: Case, rootCauseId: string, evidence: readonly EvidenceRef[] = c.evidence): DiagnosisSubmission => ({
  rootCauseId,
  explanation: EXPLANATION,
  evidence: [...evidence],
});

/** The live diagnosis endpoint, composed exactly as its route composes it (with or without the hint provider). */
function liveEndpoint(withHints: boolean) {
  return createDiagnosisHandler({
    registry: restrictToPublished(createDefaultRegistry()),
    wrongAttempts: new FixedWindowLimiter({ limit: 1000, windowMs: 600_000 }),
    ipSubmissions: new FixedWindowLimiter({ limit: 1000, windowMs: 600_000 }),
    trustedProxyHops: 0,
    appOrigin: null,
    ...(withHints ? { investigationHints: investigationHintsFor } : {}),
  });
}

async function liveFeedback(handler: ReturnType<typeof liveEndpoint>, c: Case, body: DiagnosisSubmission) {
  const { response, json } = await post(handler, { challengeId: c.id, body });
  assert.equal(response.status, 200, c.id);
  return json;
}

async function newLearner(services: AppServices): Promise<string> {
  return (await services.service.startLearner(undefined)).cookie.value;
}

async function playing(services: AppServices, id: string): Promise<string> {
  const cookie = await newLearner(services);
  const started = await services.service.startChallenge(cookie, id);
  assert.equal(started.status, "ok", `${id} starts`);
  return cookie;
}

/** What the session service says to a diagnosis, reduced to what the contract is about. */
async function submit(services: AppServices, cookie: string, id: string, body: DiagnosisSubmission, submissionId?: string) {
  const result = await services.service.submitDiagnosis(cookie, id, body, submissionId ? { submissionId } : {});
  assert.equal(result.status, "ok", `${id} accepts a diagnosis`);
  if (result.status !== "ok") throw new Error("unreachable");
  return result;
}

/** The same submission through the mounted-shape session handler, to see the HTTP status of a replay. */
async function submitOverHttp(services: AppServices, cookie: string, id: string, body: DiagnosisSubmission, submissionId: string) {
  const request = new Request(`${ORIGIN}/api/challenges/${id}/diagnosis`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      cookie: `${LEARNER_COOKIE}=${cookie}`,
      "content-type": "application/json",
      origin: ORIGIN,
      "idempotency-key": submissionId,
    },
    body: JSON.stringify(body),
  });
  const response = await services.diagnosis(request, { params: Promise.resolve({ challengeId: id }) });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) as HttpDiagnosis };
}

interface Feedback {
  headline: string;
  hints: string[];
  evidenceSummary: { total: number; logs: number; network: number };
}
/** The body of a diagnosis response over HTTP, as far as these tests read it. */
interface HttpDiagnosis {
  status: string;
  code?: string;
  feedback: Feedback;
  attempts: unknown;
}
const feedbackOf = (response: unknown): Feedback => (response as { feedback: Feedback }).feedback;
const refusal = { status: "rejected", code: "unknown-challenge" };

export function catalogAndHintsContract(label: string, harness: () => Promise<Harness>, skip: string | false = false): void {
  const cases = allCases();

  describe(`${label}: the whole catalog`, { skip }, () => {
    test("there are many challenges, and the default composition publishes and serves all of them", async () => {
      const h = await harness();
      const published = publishedChallengeIds();
      assert.ok(cases.length >= 26, `${cases.length} registered challenges (Merge 7A has 26)`);
      assert.ok(cases.every((c) => published.has(c.id)), "every registered challenge is published today");
      const services = h.compose();
      assert.deepEqual(
        services.challenges.list().map((summary) => summary.id).sort(),
        cases.map((c) => c.id).sort(),
      );
      for (const c of cases) {
        assert.ok(services.challenges.getPublic(c.id), `${c.id} public view`);
        assert.ok(services.challenges.diagnosisRegistry.has(c.id), `${c.id} diagnosis entry`);
        const version = services.challengeVersion(c.id);
        assert.match(version, /^\d+\+[0-9a-f]{12}$/, c.id);
        assert.ok(c.id.length <= 128 && version.length <= 256, `${c.id}: id and version fit the schema's limits`);
      }
    });

    test("every challenge is playable end to end: start, a wrong diagnosis, the correct one, a completed session and its history", async () => {
      const h = await harness();
      const services = h.compose({ attemptWindow: ROOMY });
      for (const c of cases) {
        const cookie = await playing(services, c.id);
        const wrong = await submit(services, cookie, c.id, bodyFor(c, c.wrong[0]));
        assert.equal(wrong.response.status, "incorrect", c.id);
        assert.equal(wrong.replayed, false);
        const right = await submit(services, cookie, c.id, bodyFor(c, c.correct));
        assert.equal(right.response.status, "correct", c.id);
        assert.deepEqual((right.response as { resolution: unknown }).resolution, { summary: c.resolution }, c.id);

        const read = await services.service.getChallengeSession(cookie, c.id);
        assert.ok(read.status === "ok" && read.session);
        assert.equal(read.session.status, "completed", c.id);
        assert.equal(read.session.contentVersion, services.challengeVersion(c.id), "the session records this challenge's own version");
        const attempts = await services.service.listAttempts(cookie, c.id);
        assert.ok(attempts.status === "ok");
        assert.deepEqual(attempts.attempts.map((attempt) => attempt.result), ["incorrect", "correct"], c.id);
      }
    });

    test("unpublishing ANY one challenge is a strict 404 on every operation, and the others keep working", async () => {
      const h = await harness();
      const all = publishedChallengeIds();
      const cookie = await newLearner(h.compose());
      for (const [index, c] of cases.entries()) {
        const gated = h.compose({ publishedChallengeIds: new Set([...all].filter((id) => id !== c.id)) });
        assert.deepEqual(await gated.service.startChallenge(cookie, c.id), refusal, `${c.id} start`);
        assert.deepEqual(await gated.service.getChallengeSession(cookie, c.id), refusal, `${c.id} read`);
        assert.deepEqual(await gated.service.listAttempts(cookie, c.id), refusal, `${c.id} history`);
        assert.deepEqual(await gated.service.submitDiagnosis(cookie, c.id, bodyFor(c, c.correct)), refusal, `${c.id} diagnosis`);
        assert.equal(gated.challenges.getDiagnosis(c.id), undefined, `${c.id}: its answer key is not reachable`);
        assert.equal(gated.challenges.getPublic(c.id), undefined);
        assert.equal(gated.challenges.list().length, all.size - 1);
        const neighbour = cases[(index + 1) % cases.length];
        assert.equal((await gated.service.startChallenge(cookie, neighbour.id)).status, "ok", `${neighbour.id} is unaffected by ${c.id}`);
      }
    });

    test("draft and archived entries in the catalog are gated exactly like a challenge that does not exist", async () => {
      const h = await harness();
      const [draft, archived] = [cases[2], cases[9]];
      const entries = REGISTERED_CHALLENGES.map((entry) => {
        const id = entry.scenario.challenge.id;
        if (id === draft.id) return { ...entry, listing: { ...entry.listing, status: "draft" as const, publishedAt: undefined } };
        if (id === archived.id) return { ...entry, listing: { ...entry.listing, status: "archived" as const } };
        return entry;
      });
      const published = new Set(createCatalog(entries).listPublished().map((challenge) => challenge.id));
      assert.equal(published.has(draft.id) || published.has(archived.id), false);
      assert.equal(published.size, cases.length - 2);

      const services = h.compose({ publishedChallengeIds: published });
      const cookie = await newLearner(services);
      for (const hidden of [draft, archived, { ...cases[0], id: "challenge-999" }]) {
        assert.deepEqual(await services.service.startChallenge(cookie, hidden.id), refusal, hidden.id);
        assert.deepEqual(await services.service.getChallengeSession(cookie, hidden.id), refusal, hidden.id);
        assert.deepEqual(await services.service.listAttempts(cookie, hidden.id), refusal, hidden.id);
        assert.deepEqual(await services.service.submitDiagnosis(cookie, hidden.id, bodyFor(hidden, hidden.correct)), refusal, hidden.id);
        const http = await submitOverHttp(services, cookie, hidden.id, bodyFor(hidden, hidden.correct), uuid(1));
        assert.equal(http.status, 404, hidden.id);
        assert.equal(http.json.code, "unknown-challenge");
      }
      assert.equal((await services.service.startChallenge(cookie, cases[0].id)).status, "ok", "published challenges still play");
    });

    test("history is preserved for every challenge across unpublishing and republishing, and a replay still answers from what was stored", async () => {
      const h = await harness();
      const open = h.compose({ attemptWindow: ROOMY });
      const cookie = await newLearner(open);
      const before = new Map<string, { completedAt: string | undefined; original: unknown; body: DiagnosisSubmission }>();
      for (const [index, c] of cases.entries()) {
        assert.equal((await open.service.startChallenge(cookie, c.id)).status, "ok");
        const body = bodyFor(c, c.correct);
        const done = await submit(open, cookie, c.id, body, uuid(100 + index));
        const read = await open.service.getChallengeSession(cookie, c.id);
        assert.ok(read.status === "ok" && read.session?.status === "completed");
        before.set(c.id, { completedAt: read.session.completedAt, original: done.response, body });
      }

      const closed = h.compose({ publishedChallengeIds: NOTHING });
      for (const c of cases) {
        assert.deepEqual(await closed.service.getChallengeSession(cookie, c.id), refusal, `${c.id} is 404 while unpublished`);
        assert.deepEqual(await closed.service.listAttempts(cookie, c.id), refusal, c.id);
      }

      const reopened = h.compose({ attemptWindow: ROOMY });
      for (const [index, c] of cases.entries()) {
        const kept = before.get(c.id)!;
        const read = await reopened.service.getChallengeSession(cookie, c.id);
        assert.ok(read.status === "ok" && read.session);
        assert.equal(read.session.status, "completed", `${c.id}: still completed`);
        assert.equal(read.session.completedAt, kept.completedAt, `${c.id}: same completion time`);
        const replay = await submit(reopened, cookie, c.id, kept.body, uuid(100 + index));
        assert.equal(replay.replayed, true, c.id);
        assert.deepEqual(replay.response, kept.original, `${c.id}: the replay is the original answer`);
        const attempts = await reopened.service.listAttempts(cookie, c.id);
        assert.ok(attempts.status === "ok");
        assert.equal(attempts.attempts.length, 1, `${c.id}: nothing was added by the replay`);
      }
    });

    test("no answer-key information is reachable through public registry access, a new session, or an incorrect answer, for any challenge", async () => {
      const h = await harness();
      const services = h.compose({ attemptWindow: ROOMY });
      for (const c of cases) {
        const secrets = [c.resolution.slice(0, 60), ...(c.hints ?? [])];
        const publicView = services.challenges.getPublic(c.id);
        assert.ok(publicView);
        // The options are public by design, so the correct option's id may appear among them and nowhere else.
        const outsideOptions = JSON.stringify({ ...publicView, rootCauseOptions: undefined });
        assert.ok(!outsideOptions.includes(c.correct), `${c.id}: the correct option id is public outside the options`);
        for (const secret of secrets) assert.ok(!outsideOptions.includes(secret), `${c.id}: public view carries "${secret.slice(0, 30)}"`);
        assert.ok(!JSON.stringify(services.challenges.list()).includes(c.resolution.slice(0, 60)), c.id);

        const cookie = await newLearner(services);
        const started = await services.service.startChallenge(cookie, c.id);
        for (const secret of [c.correct, ...secrets]) assert.ok(!JSON.stringify(started).includes(secret), `${c.id}: a new session carries "${secret.slice(0, 30)}"`);
        const wrong = await submit(services, cookie, c.id, bodyFor(c, c.wrong[0]));
        assert.ok(!JSON.stringify(wrong.response).includes(c.resolution.slice(0, 60)), c.id);
        assert.ok(!JSON.stringify(wrong.response).includes(c.correct), `${c.id}: an incorrect answer's response names the correct option`);
      }
    });
  });

  describe(`${label}: investigation hints`, { skip }, () => {
    test("a wrong diagnosis gets the SAME feedback as the live endpoint, for every challenge and every kind of evidence", async () => {
      const h = await harness();
      const services = h.compose({ attemptWindow: ROOMY });
      const live = liveEndpoint(true);
      for (const c of cases) {
        const cookie = await playing(services, c.id);
        for (const [kind, evidence] of [
          ["mixed evidence", c.evidence.length > 1 ? c.evidence : [c.logEvidence, c.networkEvidence]],
          ["logs only", [c.logEvidence]],
          ["network only", [c.networkEvidence]],
        ] as const) {
          const body = bodyFor(c, c.wrong[0], evidence);
          const ours = await submit(services, cookie, c.id, body);
          const theirs = await liveFeedback(live, c, body);
          assert.equal(ours.response.status, "incorrect", `${c.id} ${kind}`);
          assert.deepEqual(feedbackOf(ours.response), feedbackOf(theirs), `${c.id} (${kind}): session feedback differs from the live endpoint`);
          if (c.hints) assert.deepEqual((feedbackOf(ours.response) as { hints: string[] }).hints.slice(0, c.hints.length), [...c.hints], `${c.id}: its own hints come first`);
        }
      }
    });

    test("hints are selected by challenge: they differ between challenges, and every wrong option of one challenge gets the same feedback", async () => {
      const h = await harness();
      const services = h.compose({ attemptWindow: ROOMY });
      const firstHints = new Map<string, string>();
      for (const c of cases) {
        const cookie = await playing(services, c.id);
        const seen = new Set<string>();
        for (const option of c.wrong) seen.add(JSON.stringify(feedbackOf((await submit(services, cookie, c.id, bodyFor(c, option))).response)));
        assert.equal(seen.size, 1, `${c.id}: feedback must not vary with the wrong option chosen`);
        const hints = (JSON.parse([...seen][0]) as { hints: string[] }).hints;
        if (c.hints) firstHints.set(c.id, JSON.stringify(hints));
      }
      assert.ok(firstHints.size >= 25);
      assert.equal(new Set(firstHints.values()).size, firstHints.size, "no two challenges share a hint list");
    });

    test("a challenge with no hints of its own (001) and a provider that returns nothing both get the generic hints, as the live endpoint does", async () => {
      const h = await harness();
      const c = cases.find((item) => item.id === CHALLENGE_ID)!;
      const expected = feedbackOf(await liveFeedback(liveEndpoint(false), c, bodyFor(c, c.wrong[0])));
      for (const services of [h.compose(), h.compose({ investigationHints: () => undefined })]) {
        const cookie = await playing(services, c.id);
        assert.deepEqual(feedbackOf((await submit(services, cookie, c.id, bodyFor(c, c.wrong[0]))).response), expected);
      }
      const custom = h.compose({ investigationHints: (id) => (id === c.id ? ["Look at the cookie's attributes."] : undefined) });
      const cookie = await playing(custom, c.id);
      const feedback = feedbackOf((await submit(custom, cookie, c.id, bodyFor(c, c.wrong[0]))).response) as { hints: string[] };
      assert.equal(feedback.hints[0], "Look at the cookie's attributes.", "an injected provider is honoured");
    });

    test("the dependency is optional: a service built without it still works, with generic hints", async () => {
      const h = await harness();
      const services = h.compose();
      const bare = createLearnerSessionService({
        learners: h.store,
        sessions: h.store,
        attempts: h.store,
        registry: services.challenges.diagnosisRegistry,
        challengeVersion: services.challengeVersion,
        attemptWindow: ROOMY,
        // no investigationHints
      });
      const c = cases[5];
      assert.ok(c.hints, "an authored challenge, which would have its own hints if the dependency were supplied");
      const cookie = (await bare.startLearner(undefined)).cookie.value;
      assert.equal((await bare.startChallenge(cookie, c.id)).status, "ok");
      const result = await bare.submitDiagnosis(cookie, c.id, bodyFor(c, c.wrong[0]), { submissionId: uuid(7) });
      assert.ok(result.status === "ok");
      const expected = feedbackOf(await liveFeedback(liveEndpoint(false), c, bodyFor(c, c.wrong[0])));
      assert.deepEqual(feedbackOf(result.response), expected, "generic hints, exactly as the live evaluator gives without a provider");
      const replay = await bare.submitDiagnosis(cookie, c.id, bodyFor(c, c.wrong[0]), { submissionId: uuid(7) });
      assert.ok(replay.status === "ok" && replay.replayed);
      assert.deepEqual(feedbackOf(replay.response), expected, "and the replay agrees");
    });

    test("an idempotent replay of a wrong diagnosis is HTTP 200 with the same verdict and hints, and records nothing", async () => {
      const h = await harness();
      const services = h.compose();
      for (const [index, c] of cases.entries()) {
        const cookie = await playing(services, c.id);
        const body = bodyFor(c, c.wrong[0], [c.logEvidence]);
        const first = await submitOverHttp(services, cookie, c.id, body, uuid(200 + index));
        const again = await submitOverHttp(services, cookie, c.id, body, uuid(200 + index));
        assert.equal(first.status, 200, c.id);
        assert.equal(again.status, 200, `${c.id}: Syeda's approved replay status`);
        assert.equal(again.json.status, "incorrect");
        assert.deepEqual(again.json.feedback, first.json.feedback, `${c.id}: the replay's feedback is the original's`);
        assert.deepEqual(again.json.attempts, first.json.attempts, `${c.id}: the same attempt window`);
        assert.ok(Array.isArray(again.json.feedback.hints) && again.json.feedback.hints.length >= 2);
        if (c.hints) assert.deepEqual(again.json.feedback.hints.slice(0, c.hints.length), [...c.hints]);
        const attempts = await services.service.listAttempts(cookie, c.id);
        assert.ok(attempts.status === "ok");
        assert.equal(attempts.attempts.length, 1, `${c.id}: the replay was not recorded as a second attempt`);
      }
    });

    test("a replay on a DIFFERENT instance (a fresh composition over the same store) answers with the same hints", async () => {
      const h = await harness();
      const first = h.compose();
      const c = cases[11];
      const cookie = await playing(first, c.id);
      const body = bodyFor(c, c.wrong[1] ?? c.wrong[0], [c.networkEvidence]);
      const original = await submit(first, cookie, c.id, body, uuid(300));
      const other = h.compose();
      assert.notEqual(other.service, first.service);
      const replay = await submit(other, cookie, c.id, body, uuid(300));
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.response, original.response);
    });

    test("a replay never changes the outcome or the completion state: a correct diagnosis stays correct, with its stored result and no wrong-answer hints", async () => {
      const h = await harness();
      const services = h.compose();
      for (const [index, c] of cases.entries()) {
        const cookie = await playing(services, c.id);
        await submit(services, cookie, c.id, bodyFor(c, c.wrong[0]), uuid(400 + index));
        const done = await submit(services, cookie, c.id, bodyFor(c, c.correct), uuid(500 + index));
        const completed = await services.service.getChallengeSession(cookie, c.id);
        assert.ok(completed.status === "ok" && completed.session?.status === "completed");

        // The same correct submission again, and a different (wrong) one sent after completion: both answer with the stored result.
        const again = await submit(services, cookie, c.id, bodyFor(c, c.correct), uuid(500 + index));
        const later = await submit(services, cookie, c.id, bodyFor(c, c.wrong[0]), uuid(600 + index));
        for (const replay of [again, later]) {
          assert.equal(replay.replayed, true, c.id);
          assert.equal(replay.response.status, "correct", `${c.id}: a replay cannot turn a completed session into an incorrect one`);
          assert.deepEqual(replay.response, done.response, c.id);
          for (const hint of c.hints ?? []) assert.ok(!JSON.stringify(replay.response).includes(hint), `${c.id}: a correct result carries a wrong-answer hint`);
        }
        const after = await services.service.getChallengeSession(cookie, c.id);
        assert.ok(after.status === "ok" && after.session);
        assert.equal(after.session.status, "completed");
        assert.equal(after.session.completedAt, completed.session.completedAt, `${c.id}: completion time never moves`);
        const attempts = await services.service.listAttempts(cookie, c.id);
        assert.ok(attempts.status === "ok");
        assert.equal(attempts.attempts.length, 2, `${c.id}: no replay was recorded`);
      }
    });

    test("responses that carry hints expose only the existing contract: no ids, no key, no evaluation internals", async () => {
      const h = await harness();
      const services = h.compose({ attemptWindow: ROOMY });
      for (const c of cases) {
        const cookie = await playing(services, c.id);
        const { response } = await submit(services, cookie, c.id, bodyFor(c, c.wrong[0]));
        assert.deepEqual(Object.keys(response).sort(), ["attempts", "feedback", "status"], c.id);
        assert.deepEqual(Object.keys(feedbackOf(response) as object).sort(), ["evidenceSummary", "headline", "hints"], c.id);
        const text = JSON.stringify(response);
        assert.ok(!text.includes(c.resolution.slice(0, 60)), c.id);
        assert.ok(!text.includes(c.correct), `${c.id}: names the correct option`);
        const label = c.options.find((option) => option.id === c.correct)!.label;
        assert.ok(!text.includes(label), `${c.id}: names the correct option's label`);
        assert.doesNotMatch(text, /answerKey|keyObservations|correctRootCauseId|resolutionSummary|learnerId|sessionId|tokenHash/, c.id);
      }
    });

    test("hints follow the DEPLOYED content, the verdict does not: a replay after the hint text is edited shows the new hints and the same verdict", async () => {
      const h = await harness();
      const c = cases[4];
      const before = h.compose({ investigationHints: () => ["Original hint."] });
      const cookie = await playing(before, c.id);
      const body = bodyFor(c, c.wrong[0], [c.logEvidence]);
      const original = await submit(before, cookie, c.id, body, uuid(700));
      const edited = h.compose({ investigationHints: () => ["Edited hint."] });
      const replay = await submit(edited, cookie, c.id, body, uuid(700));
      assert.equal(replay.replayed, true);
      assert.equal(replay.response.status, original.response.status);
      assert.deepEqual(feedbackOf(replay.response).evidenceSummary, feedbackOf(original.response).evidenceSummary);
      assert.equal(feedbackOf(original.response).hints[0], "Original hint.");
      assert.equal(feedbackOf(replay.response).hints[0], "Edited hint.", "hints are content, not stored data: this is the documented behaviour");
    });
  });
}
