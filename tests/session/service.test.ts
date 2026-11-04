import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { createDefaultRegistry, type DiagnosisChallenge, type DiagnosisRegistry } from "@/server/diagnosis/registry";
import { DEFAULT_ATTEMPT_WINDOW } from "@/server/session/attempt-window";
import { DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import { MemoryStore } from "@/server/session/memory-store";
import { createLearnerSessionService, type SubmitDiagnosisResult } from "@/server/session/service";
import { hashSessionToken, issueSessionToken, parseSessionToken } from "@/server/session/token";
import {
  CHALLENGE_ID,
  CORRECT_ID,
  RESOLUTION,
  WRONG_IDS,
  attemptCookieFrom,
  createTestHandler,
  post,
  submission,
} from "../diagnosis/fixtures";

const START = Date.parse("2026-11-01T10:00:00Z");
const SECOND_CHALLENGE = "challenge-002";
const MINUTE = 60_000;

/**
 * Two challenges, so one learner can span both. The first is the real one, with the
 * real evaluator. The second is invented for these tests, with its own made-up key.
 */
function twoChallenges(): DiagnosisRegistry {
  const real = createDefaultRegistry().get(CHALLENGE_ID)!;
  const second: DiagnosisChallenge = {
    challengeId: SECOND_CHALLENGE,
    validation: real.validation,
    answerKey: { correctRootCauseId: WRONG_IDS[0], resolutionSummary: "Challenge two is resolved.", keyObservations: [] },
  };
  return new Map([
    [CHALLENGE_ID, real],
    [SECOND_CHALLENGE, second],
  ]);
}

function setup(options: { challengeVersion?: (challengeId: string) => string } = {}) {
  let now = START;
  const store = new MemoryStore({ now: () => now });
  const service = createLearnerSessionService({
    learners: store,
    sessions: store,
    attempts: store,
    registry: twoChallenges(),
    now: () => now,
    challengeVersion: () => "1",
    ...options,
  });
  return {
    store,
    service,
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}
type Lab = ReturnType<typeof setup>;

/** A new learner, returned as the cookie value a browser would send back. */
async function newLearner(lab: Lab): Promise<string> {
  return (await lab.service.startLearner(undefined)).cookie.value;
}

/** A new learner who has started the challenge. */
async function learnerInChallenge(lab: Lab, challengeId = CHALLENGE_ID) {
  const cookie = await newLearner(lab);
  const started = await lab.service.startChallenge(cookie, challengeId);
  assert.equal(started.status, "ok");
  return cookie;
}

function ok(result: SubmitDiagnosisResult) {
  assert.ok(result.status === "ok", `expected ok, got ${JSON.stringify(result)}`);
  return result;
}

const WRONG = () => submission({ rootCauseId: WRONG_IDS[0] });
const RIGHT = () => submission({ rootCauseId: CORRECT_ID });

/** The learner who is "inside" the store: its internal ids, which must never reach a caller. */
async function internalIds(lab: Lab, cookie: string, challengeId = CHALLENGE_ID) {
  const token = parseSessionToken(cookie)!;
  const found = await lab.store.findByTokenHash(hashSessionToken(token));
  assert.equal(found.state, "active");
  assert.ok(found.state === "active");
  const session = await lab.store.find({ learnerId: found.learner.id, challengeId });
  const attempts = session ? await lab.store.list({ learnerId: found.learner.id, sessionId: session.id }) : [];
  return [found.learner.id, session?.id, ...attempts.map((attempt) => attempt.id), hashSessionToken(token)].filter(
    (value): value is string => typeof value === "string",
  );
}

describe("learner identity", () => {
  test("creates an anonymous learner with a secure random token, and a cookie lifetime from the expiry policy", async () => {
    const lab = setup();

    const { created, cookie } = await lab.service.startLearner(undefined);

    assert.equal(created, true);
    assert.ok(parseSessionToken(cookie.value), "the cookie holds a well-formed 256-bit token");
    assert.equal(cookie.maxAgeSeconds, Math.floor(DEFAULT_EXPIRY_POLICY.idleTtlMs / 1000));
    const stored = await lab.store.findByTokenHash(hashSessionToken(parseSessionToken(cookie.value)!));
    assert.equal(stored.state, "active");
  });

  test("two new learners get different tokens", async () => {
    const lab = setup();

    const a = await newLearner(lab);
    const b = await newLearner(lab);

    assert.notEqual(a, b);
  });

  test("resumes the same learner from its cookie, handing back the same token", async () => {
    const lab = setup();
    const first = await lab.service.startLearner(undefined);
    lab.advance(2 * 24 * 60 * MINUTE);

    const again = await lab.service.startLearner(first.cookie.value);

    assert.equal(again.created, false);
    assert.equal(again.cookie.value, first.cookie.value);
    assert.equal(again.cookie.maxAgeSeconds, Math.floor(DEFAULT_EXPIRY_POLICY.idleTtlMs / 1000), "a write refreshed the idle expiry");
  });

  test("an unknown, malformed or missing cookie gets a new identity, never an existing one", async () => {
    const lab = setup();
    const existing = await newLearner(lab);
    const unknownButWellFormed = issueSessionToken().token;

    for (const cookie of [undefined, null, "", "garbage", 42, { token: existing }, unknownButWellFormed, existing.slice(1)]) {
      const result = await lab.service.startLearner(cookie);
      assert.equal(result.created, true, JSON.stringify(cookie));
      assert.notEqual(result.cookie.value, existing);
    }
  });

  test("an expired learner is reported as expired and is never revived: starting again makes a new one", async () => {
    const lab = setup();
    const { cookie } = await lab.service.startLearner(undefined);
    await lab.service.startChallenge(cookie.value, CHALLENGE_ID);
    lab.advance(DEFAULT_EXPIRY_POLICY.idleTtlMs);

    assert.deepEqual(await lab.service.checkLearner(cookie.value), { state: "expired" });
    const fresh = await lab.service.startLearner(cookie.value);

    assert.equal(fresh.created, true);
    assert.notEqual(fresh.cookie.value, cookie.value);
    assert.deepEqual(await lab.service.checkLearner(cookie.value), { state: "expired" }, "the old identity stays expired");
    const restored = await lab.service.getChallengeSession(fresh.cookie.value, CHALLENGE_ID);
    assert.deepEqual(restored, { status: "ok", session: null }, "the new identity does not inherit the old progress");
  });

  test("checking a learner is read-only: it never creates one, even for a well-formed unknown token", async () => {
    const lab = setup();
    const stranger = issueSessionToken().token;

    assert.deepEqual(await lab.service.checkLearner(undefined), { state: "none" });
    assert.deepEqual(await lab.service.checkLearner(stranger), { state: "none" });
    const afterwards = await lab.service.startChallenge(stranger, CHALLENGE_ID);

    assert.deepEqual(afterwards, { status: "rejected", code: "learner-missing" });
  });

  test("a read hands the cookie back only when it actually refreshed the idle expiry", async () => {
    const lab = setup();
    const { cookie } = await lab.service.startLearner(undefined);

    assert.deepEqual(await lab.service.checkLearner(cookie.value), { state: "active" });
    lab.advance(DEFAULT_EXPIRY_POLICY.touchIntervalMs);
    const refreshed = await lab.service.checkLearner(cookie.value);

    assert.ok(refreshed.state === "active" && refreshed.cookie?.value === cookie.value);
  });
});

describe("challenge sessions", () => {
  test("starts a session for the learner, with only allow-listed fields", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    const result = await lab.service.startChallenge(cookie, CHALLENGE_ID);

    assert.ok(result.status === "ok");
    assert.equal(result.created, true);
    assert.equal(result.session.challengeId, CHALLENGE_ID);
    assert.equal(result.session.contentVersion, "1");
    assert.equal(result.session.status, "active");
    assert.equal(result.session.startedAt, new Date(START).toISOString());
    assert.deepEqual(result.session.attempts, {
      total: 0,
      wrong: 0,
      window: { used: 0, limit: DEFAULT_ATTEMPT_WINDOW.limit, remaining: DEFAULT_ATTEMPT_WINDOW.limit },
    });
    assert.equal(result.restarted, false);
    assert.equal(result.session.restartRequired, false);
    assert.deepEqual(Object.keys(result.session).sort(), ["attempts", "challengeId", "contentVersion", "restartRequired", "startedAt", "status"]);
    assert.equal(result.cookie.value, cookie);
  });

  test("restores the session on a later request: same session, same start time, progress intact", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    lab.advance(3 * 60 * MINUTE);

    const resumed = await lab.service.startChallenge(cookie, CHALLENGE_ID);
    const fetched = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);

    assert.ok(resumed.status === "ok" && fetched.status === "ok" && fetched.session);
    assert.equal(resumed.created, false);
    assert.equal(resumed.session.startedAt, new Date(START).toISOString());
    assert.deepEqual(fetched.session, resumed.session);
    assert.equal(fetched.session.attempts.total, 1);
    assert.equal(fetched.session.attempts.wrong, 1);
  });

  test("getting a session never creates one", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    const before = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);
    const started = await lab.service.startChallenge(cookie, CHALLENGE_ID);

    assert.deepEqual(before, { status: "ok", session: null });
    assert.ok(started.status === "ok" && started.created, "it had to be created by the explicit start");
  });

  test("one learner identity spans several challenges, each with its own session and progress", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab, CHALLENGE_ID);
    const second = await lab.service.startChallenge(cookie, SECOND_CHALLENGE);
    assert.ok(second.status === "ok" && second.created);

    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));

    const one = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);
    const two = await lab.service.getChallengeSession(cookie, SECOND_CHALLENGE);
    assert.ok(one.status === "ok" && two.status === "ok");
    assert.equal(one.session?.status, "completed");
    assert.equal(two.session?.status, "active", "completing one challenge does not complete another");
    assert.equal(two.session?.attempts.total, 0);
    const learners = new Set([(await internalIds(lab, cookie, CHALLENGE_ID))[0], (await internalIds(lab, cookie, SECOND_CHALLENGE))[0]]);
    assert.equal(learners.size, 1, "both sessions belong to the same learner");
  });

  test("an unknown challenge is refused, with or without a learner", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    for (const value of [cookie, undefined]) {
      assert.deepEqual(await lab.service.startChallenge(value, "challenge-999"), { status: "rejected", code: "unknown-challenge" });
      assert.deepEqual(await lab.service.getChallengeSession(value, "challenge-999"), { status: "rejected", code: "unknown-challenge" });
      assert.deepEqual(await lab.service.listAttempts(value, "challenge-999"), { status: "rejected", code: "unknown-challenge" });
    }
  });

  test("records the content version when the session starts, and resumes the same session while it is unchanged", async () => {
    const lab = setup({ challengeVersion: () => "7" });
    const cookie = await newLearner(lab);

    const first = await lab.service.startChallenge(cookie, CHALLENGE_ID);
    const again = await lab.service.startChallenge(cookie, CHALLENGE_ID);

    assert.ok(first.status === "ok" && again.status === "ok");
    assert.equal(first.session.contentVersion, "7");
    assert.equal(again.session.contentVersion, "7");
    assert.equal(again.created, false);
    assert.equal(again.restarted, false);
    // What happens when the version DOES change is the version policy: tests/session/version-policy.test.ts.
  });

  test("starting a challenge refreshes the cookie lifetime", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    lab.advance(10 * 24 * 60 * MINUTE);

    const result = await lab.service.startChallenge(cookie, CHALLENGE_ID);

    assert.ok(result.status === "ok");
    assert.equal(result.cookie.maxAgeSeconds, Math.floor(DEFAULT_EXPIRY_POLICY.idleTtlMs / 1000));
  });
});

describe("a missing, invalid or expired learner", () => {
  test("every operation refuses it, and nothing is created or recorded", async () => {
    const lab = setup();
    const expired = await learnerInChallenge(lab);
    lab.advance(DEFAULT_EXPIRY_POLICY.idleTtlMs);
    const stranger = issueSessionToken().token;

    const cases: Array<[unknown, "learner-missing" | "learner-expired"]> = [
      [undefined, "learner-missing"],
      ["not-a-token", "learner-missing"],
      [stranger, "learner-missing"],
      [expired, "learner-expired"],
    ];
    for (const [cookie, code] of cases) {
      const rejection = { status: "rejected", code };
      assert.deepEqual(await lab.service.startChallenge(cookie, CHALLENGE_ID), rejection, `start ${String(cookie)}`);
      assert.deepEqual(await lab.service.getChallengeSession(cookie, CHALLENGE_ID), rejection, `get ${String(cookie)}`);
      assert.deepEqual(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()), rejection, `submit ${String(cookie)}`);
      assert.deepEqual(await lab.service.listAttempts(cookie, CHALLENGE_ID), rejection, `list ${String(cookie)}`);
    }
    assert.deepEqual(await lab.service.checkLearner(stranger), { state: "none" });
  });

  test("an expired learner's attempts are not recorded, and its session stays as it was", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    const ids = await internalIds(lab, cookie);
    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    lab.advance(DEFAULT_EXPIRY_POLICY.idleTtlMs);

    assert.deepEqual(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()), { status: "rejected", code: "learner-expired" });

    const token = parseSessionToken(cookie)!;
    assert.deepEqual(await lab.store.findByTokenHash(hashSessionToken(token)), { state: "expired", by: "idle" });
    assert.ok(ids.length > 0);
  });
});

describe("isolation between learners", () => {
  test("one learner's attempts never appear in, or count against, another's session", async () => {
    const lab = setup();
    const alice = await learnerInChallenge(lab);
    const bob = await learnerInChallenge(lab);
    for (let i = 0; i < 3; i++) ok(await lab.service.submitDiagnosis(alice, CHALLENGE_ID, WRONG()));

    const bobsView = await lab.service.getChallengeSession(bob, CHALLENGE_ID);
    const bobsHistory = await lab.service.listAttempts(bob, CHALLENGE_ID);
    const bobsAttempt = ok(await lab.service.submitDiagnosis(bob, CHALLENGE_ID, WRONG()));

    assert.ok(bobsView.status === "ok" && bobsView.session);
    assert.equal(bobsView.session.attempts.total, 0);
    assert.deepEqual(bobsHistory, { status: "ok", attempts: [] });
    assert.equal(bobsAttempt.response.status, "incorrect", "Alice's full window does not block Bob");
  });

  test("a learner who has not started a challenge cannot read or write another learner's session", async () => {
    const lab = setup();
    const alice = await learnerInChallenge(lab);
    const bob = await newLearner(lab);
    ok(await lab.service.submitDiagnosis(alice, CHALLENGE_ID, RIGHT()));

    assert.deepEqual(await lab.service.getChallengeSession(bob, CHALLENGE_ID), { status: "ok", session: null });
    assert.deepEqual(await lab.service.listAttempts(bob, CHALLENGE_ID), { status: "rejected", code: "session-missing" });
    assert.deepEqual(await lab.service.submitDiagnosis(bob, CHALLENGE_ID, RIGHT()), { status: "rejected", code: "session-missing" });
  });

  test("completing a challenge completes it for that learner only", async () => {
    const lab = setup();
    const alice = await learnerInChallenge(lab);
    const bob = await learnerInChallenge(lab);

    ok(await lab.service.submitDiagnosis(alice, CHALLENGE_ID, RIGHT()));

    const bobsView = await lab.service.getChallengeSession(bob, CHALLENGE_ID);
    assert.ok(bobsView.status === "ok" && bobsView.session);
    assert.equal(bobsView.session.status, "active");
  });
});

describe("diagnosis attempts", () => {
  test("an incorrect attempt is recorded and answered in the existing response contract", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);

    const result = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));

    assert.equal(result.replayed, false);
    assert.equal(result.response.status, "incorrect");
    assert.ok(result.response.status === "incorrect");
    assert.equal(result.response.attempts.used, 1);
    assert.equal(result.response.attempts.limit, DEFAULT_ATTEMPT_WINDOW.limit);
    assert.equal(result.response.attempts.remaining, DEFAULT_ATTEMPT_WINDOW.limit - 1);
    assert.equal(result.response.attempts.resetsAt, new Date(START + DEFAULT_ATTEMPT_WINDOW.windowMs).toISOString());
    const history = await lab.service.listAttempts(cookie, CHALLENGE_ID);
    assert.ok(history.status === "ok");
    assert.deepEqual(history.attempts, [
      { seq: 1, submittedAt: new Date(START).toISOString(), rootCauseId: WRONG_IDS[0], result: "incorrect", evidenceCount: 1 },
    ]);
  });

  test("a correct attempt completes the challenge: the server decides, and records it", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    lab.advance(5 * MINUTE);

    const result = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));

    assert.ok(result.response.status === "correct");
    assert.equal(result.response.resolution.summary, RESOLUTION);
    assert.equal(result.response.attempts.used, 1, "the window shows incorrect attempts only, as the endpoint does today");
    const view = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);
    assert.ok(view.status === "ok" && view.session);
    assert.equal(view.session.status, "completed");
    assert.equal(view.session.completedAt, new Date(lab.now()).toISOString());
    assert.equal(view.session.attempts.total, 2);
    assert.equal(view.session.attempts.wrong, 1);
  });

  test("responses match the existing diagnosis endpoint's, field for field, for the same submission", async () => {
    const withoutReset = (value: unknown) => {
      const copy = JSON.parse(JSON.stringify(value));
      delete copy.attempts?.resetsAt;
      return copy;
    };

    for (const body of [WRONG(), RIGHT()]) {
      const existing = (await post(createTestHandler().handler, { body })).json;
      const lab = setup();
      const cookie = await learnerInChallenge(lab);

      const result = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, body));

      assert.deepEqual(withoutReset(result.response), withoutReset(existing), `submission of ${body.rootCauseId}`);
    }

    // And the blocked response, after three wrong attempts.
    const { handler } = createTestHandler();
    let endpoint: Record<string, unknown> = {};
    let attemptCookie: string | undefined;
    for (let i = 0; i < 4; i++) {
      // Like a browser, send back the endpoint's own attempt cookie, or each request looks like a new attempter.
      const sent = await post(handler, { body: WRONG(), headers: attemptCookie ? { cookie: attemptCookie } : {} });
      attemptCookie ??= attemptCookieFrom(sent.response);
      endpoint = sent.json;
    }
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    let result: SubmitDiagnosisResult = { status: "rejected", code: "session-missing" };
    for (let i = 0; i < 4; i++) result = await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG());
    assert.ok(result.status === "ok");
    assert.equal(endpoint.status, "rate-limited");
    assert.deepEqual(withoutReset(result.response), withoutReset(endpoint));
  });

  test("a client cannot mark a challenge complete: extra fields and forged responses have no effect", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);

    const forged = [
      { ...WRONG(), completed: true, status: "correct", result: "correct", outcome: "correct", diagnosed: true },
      { status: "correct", feedback: {}, resolution: { summary: "x" }, attempts: { used: 0, limit: 3, remaining: 3 } },
      { completed: true },
    ];
    for (const body of forged) {
      const result = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, body));
      assert.notEqual(result.response.status, "correct", JSON.stringify(body).slice(0, 60));
    }

    const view = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);
    assert.ok(view.status === "ok" && view.session);
    assert.equal(view.session.status, "active");
    assert.equal(view.session.completedAt, undefined);
  });

  test("invalid submissions are answered as invalid and recorded nowhere", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);

    for (const body of [null, "text", { ...WRONG(), explanation: "short" }, { ...WRONG(), rootCauseId: "not-an-option" }, { ...WRONG(), evidence: [] }, { ...WRONG(), evidence: [{ kind: "log", logId: "log-9999" }] }]) {
      const result = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, body));
      assert.equal(result.response.status, "invalid", JSON.stringify(body));
    }

    const view = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);
    assert.ok(view.status === "ok" && view.session);
    assert.equal(view.session.attempts.total, 0);
  });

  test("a submission cannot be recorded before the challenge is started, and starting is not implied", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    assert.deepEqual(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()), { status: "rejected", code: "session-missing" });

    assert.deepEqual(await lab.service.getChallengeSession(cookie, CHALLENGE_ID), { status: "ok", session: null });
  });

  test("the attempt history lists the learner's attempts in order, with only allow-listed fields", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    lab.advance(MINUTE);
    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: WRONG_IDS[1] })));
    lab.advance(MINUTE);
    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));

    const history = await lab.service.listAttempts(cookie, CHALLENGE_ID);

    assert.ok(history.status === "ok");
    assert.deepEqual(history.attempts.map((attempt) => [attempt.seq, attempt.result]), [[1, "incorrect"], [2, "incorrect"], [3, "correct"]]);
    for (const attempt of history.attempts) {
      assert.deepEqual(Object.keys(attempt).sort(), ["evidenceCount", "result", "rootCauseId", "seq", "submittedAt"]);
    }
  });
});

describe("duplicate submissions", () => {
  test("a retry with the same submission id returns the same answer and records nothing new", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    const submissionId = randomUUID();
    const first = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG(), { submissionId }));
    lab.advance(MINUTE);

    const retry = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG(), { submissionId }));

    assert.equal(first.replayed, false);
    assert.equal(retry.replayed, true);
    assert.deepEqual(retry.response, first.response);
    const view = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);
    assert.ok(view.status === "ok" && view.session);
    assert.equal(view.session.attempts.total, 1);
    assert.equal(view.session.attempts.wrong, 1);
  });

  test("reusing a submission id for a different answer is a conflict, and records nothing", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    const submissionId = randomUUID();
    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG(), { submissionId }));

    const result = await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId: WRONG_IDS[1] }), { submissionId });

    assert.deepEqual(result, { status: "rejected", code: "submission-id-conflict" });
    const history = await lab.service.listAttempts(cookie, CHALLENGE_ID);
    assert.ok(history.status === "ok");
    assert.equal(history.attempts.length, 1);
  });

  test("the order evidence was collected in does not make a retry look like a different answer", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    const submissionId = randomUUID();
    const a = [{ kind: "network" as const, requestId: "req-04" }, { kind: "log" as const, logId: "log-06" }];
    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ evidence: a }), { submissionId }));

    const retry = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ evidence: [...a].reverse() }), { submissionId }));

    assert.equal(retry.replayed, true);
  });

  test("a malformed submission id is refused as invalid, and records nothing", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);

    const result = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG(), { submissionId: "not-a-uuid" }));

    assert.equal(result.response.status, "invalid");
    const view = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);
    assert.ok(view.status === "ok" && view.session);
    assert.equal(view.session.attempts.total, 0);
  });

  test("without a submission id every request is its own attempt (a retry cannot be recognized)", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);

    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));

    const history = await lab.service.listAttempts(cookie, CHALLENGE_ID);
    assert.ok(history.status === "ok");
    assert.equal(history.attempts.length, 2);
  });

  test("racing retries with one submission id are recorded once", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    const submissionId = randomUUID();

    const results = await Promise.all(Array.from({ length: 5 }, () => lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG(), { submissionId })));

    assert.equal(results.filter((result) => result.status === "ok" && !result.replayed).length, 1);
    const view = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);
    assert.ok(view.status === "ok" && view.session);
    assert.equal(view.session.attempts.total, 1);
  });
});

describe("after completion", () => {
  test("later submissions record nothing and get the stored correct answer back", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    const done = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));

    for (const body of [WRONG(), RIGHT()]) {
      const later = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, body));
      assert.equal(later.replayed, true);
      assert.equal(later.response.status, "correct");
      assert.deepEqual(later.response, done.response);
    }

    const history = await lab.service.listAttempts(cookie, CHALLENGE_ID);
    assert.ok(history.status === "ok");
    assert.equal(history.attempts.length, 1);
  });
});

describe("the attempt window", () => {
  test("three wrong attempts block the next one, even a correct one, until the oldest leaves the window", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    for (let i = 0; i < 3; i++) ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));

    const blocked = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));

    assert.ok(blocked.response.status === "rate-limited");
    assert.equal(blocked.response.retryAfterSeconds, DEFAULT_ATTEMPT_WINDOW.windowMs / 1000);
    assert.equal(blocked.response.attempts?.remaining, 0);
    const history = await lab.service.listAttempts(cookie, CHALLENGE_ID);
    assert.ok(history.status === "ok");
    assert.equal(history.attempts.length, 3, "a blocked attempt is not recorded");

    lab.advance(DEFAULT_ATTEMPT_WINDOW.windowMs);
    const allowed = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));
    assert.equal(allowed.response.status, "correct");
  });

  test("the window belongs to the session: another challenge is not blocked", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    await lab.service.startChallenge(cookie, SECOND_CHALLENGE);
    for (let i = 0; i < 3; i++) ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));

    const other = ok(await lab.service.submitDiagnosis(cookie, SECOND_CHALLENGE, submission({ rootCauseId: CORRECT_ID })));

    assert.equal(other.response.status, "incorrect");
  });
});

describe("answer-key confidentiality", () => {
  test("nothing a learner can see, after wrong attempts, contains the answer or an internal identifier", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    const seen: unknown[] = [];

    seen.push(await lab.service.startChallenge(cookie, CHALLENGE_ID));
    for (const rootCauseId of WRONG_IDS.slice(0, 3)) {
      seen.push(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId })));
    }
    seen.push(await lab.service.getChallengeSession(cookie, CHALLENGE_ID));
    seen.push(await lab.service.listAttempts(cookie, CHALLENGE_ID));
    seen.push(await lab.service.checkLearner(cookie));

    const everything = JSON.stringify(seen);
    for (const secret of [CORRECT_ID, RESOLUTION, "correctRootCauseId", "keyObservations", "resolutionSummary", "requestHash", "tokenHash"]) {
      assert.ok(!everything.includes(secret), `leaked: ${secret.slice(0, 40)}`);
    }
    for (const id of await internalIds(lab, cookie)) {
      assert.ok(!everything.includes(id), "an internal id or hash reached a caller");
    }
  });

  test("incorrect feedback does not depend on which wrong option was chosen", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);

    const feedback = [];
    for (const rootCauseId of WRONG_IDS.slice(0, 3)) {
      const result = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, submission({ rootCauseId })));
      assert.ok(result.response.status === "incorrect");
      feedback.push(JSON.stringify(result.response.feedback));
    }

    assert.equal(new Set(feedback).size, 1);
  });

  test("the resolution reaches a session view only once the learner has solved it, and the attempt history never carries it", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);

    ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    const before = JSON.stringify(await lab.service.getChallengeSession(cookie, CHALLENGE_ID));
    assert.ok(!before.includes(RESOLUTION), "an unfinished session carries no resolution text");
    assert.ok(!before.includes('"completion"'), "an unfinished session has no completion");

    const result = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));
    const view = JSON.stringify(await lab.service.getChallengeSession(cookie, CHALLENGE_ID));
    const history = JSON.stringify(await lab.service.listAttempts(cookie, CHALLENGE_ID));

    assert.ok(result.response.status === "correct");
    assert.ok(view.includes(RESOLUTION), "the completed session restores what the learner was shown");
    for (const secret of ["keyObservations", "correctRootCauseId", "resolutionSummary", "requestHash", "tokenHash"]) {
      assert.ok(!view.includes(secret), `the view leaked ${secret}`);
      assert.ok(!history.includes(secret), `the history leaked ${secret}`);
    }
    assert.ok(!history.includes(RESOLUTION), "the attempt history never carries the resolution");
  });
});

const sizeOf = (lab: Lab, field: "learners" | "sessions") =>
  (lab.store as unknown as Record<string, Map<unknown, unknown>>)[field].size;

describe("repeated and concurrent requests", () => {
  test("restoring the same learner again and again never creates a second identity", async () => {
    const lab = setup();
    const first = await lab.service.startLearner(undefined);

    for (let i = 0; i < 5; i++) {
      const again = await lab.service.startLearner(first.cookie.value);
      assert.equal(again.created, false);
      assert.equal(again.cookie.value, first.cookie.value);
    }

    assert.equal(sizeOf(lab, "learners"), 1);
  });

  test("racing restorations of one learner create no second identity", async () => {
    const lab = setup();
    const { cookie } = await lab.service.startLearner(undefined);

    const results = await Promise.all(Array.from({ length: 10 }, () => lab.service.startLearner(cookie.value)));

    assert.ok(results.every((result) => !result.created && result.cookie.value === cookie.value));
    assert.equal(sizeOf(lab, "learners"), 1);
  });

  test("racing starts of one challenge produce exactly one session", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);

    const results = await Promise.all(Array.from({ length: 10 }, () => lab.service.startChallenge(cookie, CHALLENGE_ID)));

    assert.equal(results.filter((result) => result.status === "ok" && result.created).length, 1);
    assert.equal(sizeOf(lab, "sessions"), 1);
  });

  test("racing correct submissions complete the challenge once, and the rest are replays", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);

    const results = await Promise.all(Array.from({ length: 6 }, () => lab.service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT())));

    const answered = results.map(ok);
    assert.equal(answered.filter((result) => !result.replayed).length, 1);
    assert.ok(answered.every((result) => result.response.status === "correct"));
    const history = await lab.service.listAttempts(cookie, CHALLENGE_ID);
    assert.ok(history.status === "ok");
    assert.equal(history.attempts.length, 1);
  });
});

describe("storage failures", () => {
  /** The same store, except that one method fails. The real store stays reachable for inspection. */
  function withFailing(lab: Lab, method: keyof MemoryStore) {
    const broken = new Proxy(lab.store, {
      get(target, property) {
        if (property === method) return () => Promise.reject(new Error("storage is down"));
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return createLearnerSessionService({
      learners: broken,
      sessions: broken,
      attempts: broken,
      registry: twoChallenges(),
      now: lab.now,
      challengeVersion: () => "1",
    });
  }

  test("an attempt that cannot be recorded is never answered, and never completes the challenge", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);
    const flaky = withFailing(lab, "record");

    for (const body of [WRONG(), RIGHT()]) {
      await assert.rejects(flaky.submitDiagnosis(cookie, CHALLENGE_ID, body), /storage is down/);
    }

    const view = await lab.service.getChallengeSession(cookie, CHALLENGE_ID);
    assert.ok(view.status === "ok" && view.session);
    assert.equal(view.session.status, "active", "a correct answer that could not be stored did not complete it");
    assert.equal(view.session.attempts.total, 0);
    const retried = ok(await lab.service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));
    assert.equal(retried.response.status, "correct", "once storage is back, the same learner can still complete it");
  });

  test("a learner that cannot be stored is not handed a cookie", async () => {
    const lab = setup();
    const flaky = withFailing(lab, "create");

    await assert.rejects(flaky.startLearner(undefined), /storage is down/);

    assert.equal(sizeOf(lab, "learners"), 0);
  });

  test("a session that cannot be stored is not reported as started", async () => {
    const lab = setup();
    const cookie = await newLearner(lab);
    const flaky = withFailing(lab, "start");

    await assert.rejects(flaky.startChallenge(cookie, CHALLENGE_ID), /storage is down/);

    assert.equal(sizeOf(lab, "sessions"), 0);
    assert.deepEqual(await lab.service.getChallengeSession(cookie, CHALLENGE_ID), { status: "ok", session: null });
  });

  test("a failing read is an error, never a guess about who the learner is", async () => {
    const lab = setup();
    const cookie = await learnerInChallenge(lab);

    for (const method of ["touch", "find", "list"] as const) {
      const flaky = withFailing(lab, method);
      await assert.rejects(flaky.listAttempts(cookie, CHALLENGE_ID), /storage is down/, method);
    }
  });
});

describe("another learner's session cannot be inferred", () => {
  test("a learner gets the same answers whether or not someone else has started, attempted or completed", async () => {
    async function bobsAnswers(someoneElseActs: boolean) {
      const lab = setup();
      if (someoneElseActs) {
        const alice = await learnerInChallenge(lab);
        for (let i = 0; i < 3; i++) await lab.service.submitDiagnosis(alice, CHALLENGE_ID, WRONG());
      }
      const bob = await newLearner(lab);
      return JSON.stringify([
        await lab.service.getChallengeSession(bob, CHALLENGE_ID),
        await lab.service.listAttempts(bob, CHALLENGE_ID),
        await lab.service.submitDiagnosis(bob, CHALLENGE_ID, WRONG()),
      ]);
    }

    assert.equal(await bobsAnswers(true), await bobsAnswers(false));
  });
});
