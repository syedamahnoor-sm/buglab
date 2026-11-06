/*
 * The challenge-version policy, end to end through the real challenge registry.
 *
 * A deploy is simulated the way it happens: the learner store stays, and a NEW service is built over
 * it with the NEW registry. The registries are real (createChallengeRegistry), built from variants of
 * Challenge 001, so every content version here is a genuine `<revision>+<public content hash>`:
 *
 *   - same version         identical definitions: the revision and the hash both match;
 *   - public content change  a learner-visible field differs: the hash changes;
 *   - answer-key-only change the revision is bumped and the key changes, the public content does not:
 *                            the revision changes and the hash stays.
 *
 * The policy under test (service.ts): a COMPLETED session is preserved whatever changed; an
 * UNFINISHED session whose version differs is out of date: it records nothing, reads say
 * `restartRequired`, and starting the challenge again replaces it, keeping the old one as history.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { createChallengeRegistry, type ChallengeRegistry } from "@/server/challenges/registry";
import { DEFAULT_ATTEMPT_WINDOW } from "@/server/session/attempt-window";
import { MemoryStore } from "@/server/session/memory-store";
import { deterministicDiagnosisEvaluator, type DiagnosisEvaluator } from "@/server/diagnosis/evaluator";
import { createLearnerSessionService } from "@/server/session/service";
import type { AttemptStore } from "@/server/session/types";
import { hashSessionToken, parseSessionToken } from "@/server/session/token";
import { CHALLENGE_ID, CORRECT_ID, RESOLUTION, WRONG_IDS, submission } from "../diagnosis/fixtures";
import { definitionOf, type Draft } from "../challenges/helpers";

const START = Date.parse("2026-11-01T10:00:00Z");
const MINUTE = 60_000;
const NEW_RESOLUTION = "A corrected explanation: the answer key was revised after this learner finished.";

/** Splits `<revision>+<fingerprint>` for the assertions that need each half. */
const parts = (version: string | undefined) => {
  assert.ok(version, "a content version");
  const [revision, fingerprint] = version.split("+");
  return { revision, fingerprint };
};

const registryOf = (change?: (draft: Draft) => void) => createChallengeRegistry([definitionOf(change)]);

const BASE = () => registryOf();
const PUBLIC_CHANGE = () => registryOf((d) => (d.scenario.challenge.incident = "Users can sign in, but the pages after that fail."));
const KEY_ONLY_CHANGE = () =>
  registryOf((d) => {
    d.revision = "2";
    d.evaluation.resolutionSummary = NEW_RESOLUTION;
  });
/** The key changes so that a previously WRONG option is now the right one. The public content is untouched. */
const KEY_CHANGES_ANSWER = () =>
  registryOf((d) => {
    d.revision = "2";
    d.evaluation.correctRootCauseId = WRONG_IDS[0];
    d.evaluation.resolutionSummary = NEW_RESOLUTION;
  });
const BOTH_CHANGE = () =>
  registryOf((d) => {
    d.revision = "2";
    d.scenario.challenge.incident = "Users can sign in, but the pages after that fail.";
    d.evaluation.resolutionSummary = NEW_RESOLUTION;
  });

/** A durable store that outlives deploys, and a way to deploy a registry over it. */
function lab() {
  let now = START;
  let evaluator: DiagnosisEvaluator | undefined;
  const store = new MemoryStore({ now: () => now });
  const deploy = (registry: ChallengeRegistry, attempts: AttemptStore = store) =>
    createLearnerSessionService({
      learners: store,
      sessions: store,
      attempts,
      registry: registry.diagnosisRegistry,
      challengeVersion: (id) => registry.contentVersion(id)!,
      now: () => now,
      evaluator,
    });
  return {
    store,
    deploy,
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    /** Counts evaluator calls on services deployed after this. */
    countEvaluations() {
      let calls = 0;
      evaluator = {
        evaluate(request) {
          calls += 1;
          return deterministicDiagnosisEvaluator.evaluate(request);
        },
      };
      return () => calls;
    },
  };
}
type Lab = ReturnType<typeof lab>;

async function learner(service: ReturnType<Lab["deploy"]>) {
  return (await service.startLearner(undefined)).cookie.value;
}

function ok<T extends { status: string }>(result: T): Extract<T, { status: "ok" }> {
  assert.equal(result.status, "ok", JSON.stringify(result));
  return result as Extract<T, { status: "ok" }>;
}

async function sessionIds(l: Lab, cookie: string): Promise<{ learnerId: string; current?: string }> {
  const found = await l.store.findByTokenHash(hashSessionToken(parseSessionToken(cookie)!));
  assert.ok(found.state === "active");
  const session = await l.store.find({ learnerId: found.learner.id, challengeId: CHALLENGE_ID });
  return { learnerId: found.learner.id, current: session?.id };
}

const countSessions = (l: Lab) => (l.store as unknown as { sessions: Map<string, unknown> }).sessions.size;

const WRONG = () => submission({ rootCauseId: WRONG_IDS[0] });
const RIGHT = () => submission({ rootCauseId: CORRECT_ID });

describe("the premises: what each variant changes, measured on real content versions", () => {
  const base = parts(BASE().contentVersion(CHALLENGE_ID));

  test("the same definitions give the same version, even from a separate registry", () => {
    assert.deepEqual(parts(BASE().contentVersion(CHALLENGE_ID)), base);
  });

  test("a public content change changes the hash and not the revision", () => {
    const changed = parts(PUBLIC_CHANGE().contentVersion(CHALLENGE_ID));
    assert.equal(changed.revision, base.revision);
    assert.notEqual(changed.fingerprint, base.fingerprint);
  });

  test("an answer-key-only change changes the revision and not the hash", () => {
    for (const make of [KEY_ONLY_CHANGE, KEY_CHANGES_ANSWER]) {
      const changed = parts(make().contentVersion(CHALLENGE_ID));
      assert.notEqual(changed.revision, base.revision);
      assert.equal(changed.fingerprint, base.fingerprint, "the public content is identical, so the hash is");
    }
  });

  test("changing both changes both", () => {
    const changed = parts(BOTH_CHANGE().contentVersion(CHALLENGE_ID));
    assert.notEqual(changed.revision, base.revision);
    assert.notEqual(changed.fingerprint, base.fingerprint);
  });
});

describe("the same version: nothing changes", () => {
  test("a redeploy of identical content resumes the unfinished session, with its progress", async () => {
    const l = lab();
    const before = l.deploy(BASE());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, CHALLENGE_ID));
    ok(await before.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    const { current } = await sessionIds(l, cookie);

    const after = l.deploy(BASE()); // a new process, an identical registry
    const resumed = ok(await after.startChallenge(cookie, CHALLENGE_ID));

    assert.equal(resumed.created, false);
    assert.equal(resumed.restarted, false);
    assert.equal(resumed.session.restartRequired, false);
    assert.equal(resumed.session.attempts.total, 1);
    assert.equal((await sessionIds(l, cookie)).current, current);
    assert.equal(countSessions(l), 1);
    ok(await after.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
  });

  test("the session records the registry's content version", async () => {
    const l = lab();
    const registry = BASE();
    const service = l.deploy(registry);
    const cookie = await learner(service);

    const started = ok(await service.startChallenge(cookie, CHALLENGE_ID));

    assert.equal(started.session.contentVersion, registry.contentVersion(CHALLENGE_ID));
    const recorded = parts(started.session.contentVersion);
    assert.equal(recorded.revision, "1", "the registry revision is in the stored version");
    assert.match(recorded.fingerprint, /^[0-9a-f]{12}$/, "and so is the public content hash");
  });
});

describe("an unfinished session when the PUBLIC content changes", () => {
  async function stale() {
    const l = lab();
    const before = l.deploy(BASE());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, CHALLENGE_ID));
    ok(await before.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    const old = await sessionIds(l, cookie);
    const after = l.deploy(PUBLIC_CHANGE());
    return { l, cookie, after, old, oldVersion: BASE().contentVersion(CHALLENGE_ID)!, newVersion: PUBLIC_CHANGE().contentVersion(CHALLENGE_ID)! };
  }

  test("a read reports restartRequired, keeps the old version, and changes nothing", async () => {
    const { l, cookie, after, old, oldVersion } = await stale();

    const read = ok(await after.getChallengeSession(cookie, CHALLENGE_ID));

    assert.equal(read.session?.restartRequired, true);
    assert.equal(read.session?.status, "active");
    assert.equal(read.session?.contentVersion, oldVersion);
    assert.equal(read.session?.attempts.total, 1);
    assert.equal((await sessionIds(l, cookie)).current, old.current, "a read never restarts");
    assert.equal(countSessions(l), 1);
  });

  test("a submission is refused as outdated and records nothing, not even a validation answer", async () => {
    const { l, cookie, after, old } = await stale();
    const owner = { learnerId: old.learnerId, sessionId: old.current! };
    const windowBefore = await l.store.windowStatus(owner, DEFAULT_ATTEMPT_WINDOW);

    assert.deepEqual(await after.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()), { status: "rejected", code: "session-outdated" });
    assert.deepEqual(await after.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()), { status: "rejected", code: "session-outdated" });
    assert.deepEqual(await after.submitDiagnosis(cookie, CHALLENGE_ID, { not: "valid" }), { status: "rejected", code: "session-outdated" });

    assert.equal((await l.store.list(owner)).length, 1, "nothing was recorded");
    assert.deepEqual(await l.store.windowStatus(owner, DEFAULT_ATTEMPT_WINDOW), windowBefore);
    const session = await l.store.find({ learnerId: old.learnerId, challengeId: CHALLENGE_ID });
    assert.equal(session?.status, "active", "a correct answer to the new content did not complete the old session");
  });

  test("the attempt history is still readable while a restart is pending", async () => {
    const { cookie, after } = await stale();

    const history = ok(await after.listAttempts(cookie, CHALLENGE_ID));

    assert.equal(history.attempts.length, 1);
  });

  test("starting the challenge replaces it with a fresh session at the new version", async () => {
    const { l, cookie, after, old, newVersion } = await stale();

    const restarted = ok(await after.startChallenge(cookie, CHALLENGE_ID));

    assert.equal(restarted.created, true);
    assert.equal(restarted.restarted, true);
    assert.equal(restarted.session.contentVersion, newVersion);
    assert.equal(restarted.session.status, "active");
    assert.equal(restarted.session.restartRequired, false);
    assert.deepEqual(restarted.session.attempts, { total: 0, wrong: 0, window: { used: 0, limit: DEFAULT_ATTEMPT_WINDOW.limit, remaining: DEFAULT_ATTEMPT_WINDOW.limit } });
    assert.notEqual((await sessionIds(l, cookie)).current, old.current);
    assert.equal(ok(await after.listAttempts(cookie, CHALLENGE_ID)).attempts.length, 0);
    // The old session and its attempt are kept, as history.
    assert.equal(countSessions(l), 2);
    assert.equal((await l.store.list({ learnerId: old.learnerId, sessionId: old.current! })).length, 1);
  });

  test("the fresh session then works normally, and the old one stays closed", async () => {
    const { l, cookie, after, old } = await stale();
    ok(await after.startChallenge(cookie, CHALLENGE_ID));

    const wrong = ok(await after.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    assert.equal(wrong.response.status, "incorrect");
    const right = ok(await after.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));
    assert.equal(right.response.status, "correct");

    const read = ok(await after.getChallengeSession(cookie, CHALLENGE_ID));
    assert.equal(read.session?.status, "completed");
    assert.equal((await l.store.list({ learnerId: old.learnerId, sessionId: old.current! })).length, 1, "the old session gained nothing");
  });

  test("starting again after the restart resumes the new session and does not restart it again", async () => {
    const { l, cookie, after } = await stale();
    const first = ok(await after.startChallenge(cookie, CHALLENGE_ID));

    const again = ok(await after.startChallenge(cookie, CHALLENGE_ID));

    assert.equal(again.created, false);
    assert.equal(again.restarted, false);
    assert.deepEqual(again.session, first.session);
    assert.equal(countSessions(l), 2);
  });
});

describe("an unfinished session when ONLY the answer key changes (the revision is bumped, the public hash is not)", () => {
  test("it is out of date too: the learner sees the same content, but earlier verdicts were judged by a different key", async () => {
    const l = lab();
    const before = l.deploy(BASE());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, CHALLENGE_ID));
    // Under the OLD key this answer is wrong. Under the corrected key it is the right one.
    const verdict = ok(await before.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    assert.equal(verdict.response.status, "incorrect");

    const after = l.deploy(KEY_CHANGES_ANSWER());

    assert.equal(ok(await after.getChallengeSession(cookie, CHALLENGE_ID)).session?.restartRequired, true);
    assert.deepEqual(await after.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()), { status: "rejected", code: "session-outdated" });

    const restarted = ok(await after.startChallenge(cookie, CHALLENGE_ID));
    assert.equal(restarted.restarted, true);
    assert.equal(restarted.session.attempts.wrong, 0, "the earlier wrong verdict does not follow the learner");
    const fair = ok(await after.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
    assert.equal(fair.response.status, "correct", "judged by the corrected key, from a clean start");
    assert.equal(ok(await after.getChallengeSession(cookie, CHALLENGE_ID)).session?.status, "completed");
  });

  test("a revision-only change that keeps the answer restarts all the same, and the stored version shows only the revision moved", async () => {
    const l = lab();
    const before = l.deploy(BASE());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, CHALLENGE_ID));
    const after = l.deploy(KEY_ONLY_CHANGE());

    const restarted = ok(await after.startChallenge(cookie, CHALLENGE_ID));

    assert.equal(restarted.restarted, true);
    const was = parts(BASE().contentVersion(CHALLENGE_ID));
    const now = parts(restarted.session.contentVersion);
    assert.equal(now.fingerprint, was.fingerprint);
    assert.notEqual(now.revision, was.revision);
  });
});

describe("a COMPLETED session is preserved whatever changes", () => {
  const changes: [string, () => ChallengeRegistry][] = [
    ["the public content", PUBLIC_CHANGE],
    ["only the answer key", KEY_ONLY_CHANGE],
    ["the correct answer itself", KEY_CHANGES_ANSWER],
    ["both the public content and the key", BOTH_CHANGE],
  ];

  for (const [label, change] of changes) {
    describe(`when ${label} changes`, () => {
      async function finished() {
        const l = lab();
        const before = l.deploy(BASE());
        const cookie = await learner(before);
        ok(await before.startChallenge(cookie, CHALLENGE_ID));
        ok(await before.submitDiagnosis(cookie, CHALLENGE_ID, WRONG()));
        l.advance(2 * MINUTE);
        const winningId = randomUUID();
        const win = ok(await before.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT(), { submissionId: winningId }));
        assert.equal(win.response.status, "correct");
        const viewBefore = ok(await before.getChallengeSession(cookie, CHALLENGE_ID)).session!;
        l.advance(MINUTE);
        const after = l.deploy(change());
        return { l, cookie, after, win, viewBefore, winningId };
      }

      test("a refresh restores the same completed result: status, time, version, resolution and the submitted diagnosis", async () => {
        const { cookie, after, viewBefore } = await finished();

        const view = ok(await after.getChallengeSession(cookie, CHALLENGE_ID)).session!;

        assert.deepEqual(view, viewBefore);
        assert.equal(view.status, "completed");
        assert.equal(view.restartRequired, false);
        assert.equal(view.contentVersion, BASE().contentVersion(CHALLENGE_ID), "it keeps the version it was completed at");
        assert.equal(view.completion?.resolution.summary, RESOLUTION, "the resolution the learner was shown, not the revised one");
      });

      test("starting the challenge returns the completed session as it is, and restarts nothing", async () => {
        const { l, cookie, after, viewBefore } = await finished();
        const sessionsBefore = countSessions(l);

        const started = ok(await after.startChallenge(cookie, CHALLENGE_ID));

        assert.equal(started.created, false);
        assert.equal(started.restarted, false);
        assert.deepEqual(started.session, viewBefore);
        assert.equal(countSessions(l), sessionsBefore);
      });

      test("replaying the winning submission answers with the result stored at completion, never the current key", async () => {
        const { cookie, after, win, winningId } = await finished();

        const replay = ok(await after.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT(), { submissionId: winningId }));

        assert.equal(replay.replayed, true);
        assert.deepEqual(replay.response, win.response);
        assert.ok(!JSON.stringify(replay.response).includes(NEW_RESOLUTION));
      });

      test("any later submission is a replay of the stored result, whatever it says, and records nothing", async () => {
        const { cookie, after } = await finished();
        const recordedBefore = ok(await after.listAttempts(cookie, CHALLENGE_ID)).attempts.length;

        for (const body of [RIGHT(), WRONG(), submission({ rootCauseId: WRONG_IDS[1] })]) {
          const later = ok(await after.submitDiagnosis(cookie, CHALLENGE_ID, body));
          assert.equal(later.replayed, true);
          assert.equal(later.response.status, "correct");
          assert.ok(later.response.status === "correct" && later.response.resolution.summary === RESOLUTION);
          assert.ok(!JSON.stringify(later.response).includes(NEW_RESOLUTION));
        }

        assert.equal(ok(await after.listAttempts(cookie, CHALLENGE_ID)).attempts.length, recordedBefore);
      });
    });
  }

  test("a stored wrong attempt is replayed as wrong even if the key later makes that answer correct", async () => {
    const l = lab();
    const before = l.deploy(BASE());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, CHALLENGE_ID));
    const wrongId = randomUUID();
    const original = ok(await before.submitDiagnosis(cookie, CHALLENGE_ID, WRONG(), { submissionId: wrongId }));
    assert.equal(original.response.status, "incorrect");
    ok(await before.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));

    // After the revision, the answer that was wrong is now the key.
    const calls = l.countEvaluations();
    const after = l.deploy(KEY_CHANGES_ANSWER());
    const replay = ok(await after.submitDiagnosis(cookie, CHALLENGE_ID, WRONG(), { submissionId: wrongId }));

    assert.equal(calls(), 0, "a replay does not invoke the evaluator");
    assert.equal(replay.replayed, true);
    assert.equal(replay.response.status, "incorrect", "a replay reports the stored verdict");
    assert.ok(!JSON.stringify(replay.response).includes(NEW_RESOLUTION));
    assert.ok(replay.response.status === "incorrect" && replay.response.feedback.headline === (original.response as { feedback: { headline: string } }).feedback.headline);
  });

  test("elapsed time does not disturb a completed result: forty days later it is the same", async () => {
    const l = lab();
    const before = l.deploy(BASE());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, CHALLENGE_ID));
    ok(await before.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));
    const viewBefore = ok(await before.getChallengeSession(cookie, CHALLENGE_ID)).session!;

    // The learner's own idle expiry would end the identity, so keep it alive with a read every few days.
    for (let day = 0; day < 40; day += 1) {
      l.advance(24 * 60 * MINUTE);
      ok(await l.deploy(BASE()).getChallengeSession(cookie, CHALLENGE_ID));
    }
    const view = ok(await l.deploy(PUBLIC_CHANGE()).getChallengeSession(cookie, CHALLENGE_ID)).session!;

    assert.deepEqual({ ...view, attempts: undefined }, { ...viewBefore, attempts: undefined });
    assert.equal(view.completedAt, viewBefore.completedAt);
  });
});

describe("restarts are safe under concurrency and repetition", () => {
  test("many racing starts of a stale session replace it exactly once", async () => {
    const l = lab();
    const before = l.deploy(BASE());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, CHALLENGE_ID));
    const after = l.deploy(PUBLIC_CHANGE());

    const results = await Promise.all(Array.from({ length: 8 }, () => after.startChallenge(cookie, CHALLENGE_ID)));
    const oks = results.map(ok);

    assert.equal(oks.filter((r) => r.restarted).length, 1);
    assert.equal(oks.filter((r) => r.created).length, 1, "only the winner created a session");
    assert.equal(new Set(oks.map((r) => r.session.startedAt)).size, 1);
    assert.ok(oks.every((r) => r.session.restartRequired === false && r.session.contentVersion === PUBLIC_CHANGE().contentVersion(CHALLENGE_ID)));
    assert.equal(countSessions(l), 2, "the old one and exactly one replacement");
  });

  test("a chain of versions keeps every earlier session as history and only the newest is current", async () => {
    const l = lab();
    const cookie = await learner(l.deploy(BASE()));
    const ids: (string | undefined)[] = [];
    for (const make of [BASE, PUBLIC_CHANGE, KEY_ONLY_CHANGE, BOTH_CHANGE]) {
      const service = l.deploy(make());
      ok(await service.startChallenge(cookie, CHALLENGE_ID));
      ids.push((await sessionIds(l, cookie)).current);
    }

    assert.equal(new Set(ids).size, 4);
    assert.equal(countSessions(l), 4);
    const { learnerId } = await sessionIds(l, cookie);
    for (const id of ids.slice(0, -1)) assert.deepEqual(await l.store.list({ learnerId, sessionId: id! }), []);
  });

  test("a completed session is never even offered to the store for restart", async () => {
    const l = lab();
    const before = l.deploy(BASE());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, CHALLENGE_ID));
    ok(await before.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT()));

    let offered = 0;
    const sessions = {
      start: (input: Parameters<MemoryStore["start"]>[0]) => l.store.start(input),
      find: (owner: Parameters<MemoryStore["find"]>[0]) => l.store.find(owner),
      listCurrentCompleted: (learnerId: string) => l.store.listCurrentCompleted(learnerId),
      restart: (input: Parameters<MemoryStore["restart"]>[0]) => {
        offered += 1;
        return l.store.restart(input);
      },
    };
    const registry = PUBLIC_CHANGE();
    const after = createLearnerSessionService({
      learners: l.store,
      sessions,
      attempts: l.store,
      registry: registry.diagnosisRegistry,
      challengeVersion: (id) => registry.contentVersion(id)!,
      now: l.now,
    });

    const started = ok(await after.startChallenge(cookie, CHALLENGE_ID));

    assert.equal(started.restarted, false);
    assert.equal(started.session.status, "completed");
    assert.equal(offered, 0);
  });

  test("a submission that loses a race with a restart is outdated and records nothing", async () => {
    const l = lab();
    const before = l.deploy(BASE());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, CHALLENGE_ID));
    const old = await sessionIds(l, cookie);

    // Another instance, on the new version, replaces the session between this request's read and its write.
    const registry = BASE();
    const racing: AttemptStore = {
      list: (owner) => l.store.list(owner),
      windowStatus: (owner, window) => l.store.windowStatus(owner, window),
      record: (input) => l.store.record(input),
      finalize: (input) => l.store.finalize(input),
      releaseClaim: (input) => l.store.releaseClaim(input),
      reserve: async (input) => {
        await l.store.restart({
          learnerId: old.learnerId,
          challengeId: CHALLENGE_ID,
          challengeVersion: "1+ffffffffffff",
          supersedes: old.current!,
        });
        return l.store.reserve(input);
      },
    };
    const service = l.deploy(registry, racing);

    const result = await service.submitDiagnosis(cookie, CHALLENGE_ID, RIGHT());

    assert.deepEqual(result, { status: "rejected", code: "session-outdated" });
    assert.deepEqual(await l.store.list({ learnerId: old.learnerId, sessionId: old.current! }), []);
    const current = await l.store.find({ learnerId: old.learnerId, challengeId: CHALLENGE_ID });
    assert.equal(current?.status, "active");
    assert.equal(current?.attemptCount, 0);
  });
});

describe("the policy is per learner and per challenge", () => {
  test("one learner's restart does not touch another learner's session", async () => {
    const l = lab();
    const before = l.deploy(BASE());
    const a = await learner(before);
    const b = await learner(before);
    for (const cookie of [a, b]) ok(await before.startChallenge(cookie, CHALLENGE_ID));
    ok(await before.submitDiagnosis(b, CHALLENGE_ID, RIGHT())); // b has finished, a has not
    const after = l.deploy(PUBLIC_CHANGE());

    const restartedA = ok(await after.startChallenge(a, CHALLENGE_ID));
    const readB = ok(await after.getChallengeSession(b, CHALLENGE_ID));

    assert.equal(restartedA.restarted, true);
    assert.equal(readB.session?.status, "completed");
    assert.equal(readB.session?.restartRequired, false);
    assert.equal(readB.session?.completion?.resolution.summary, RESOLUTION);
  });

  test("a learner who starts after the deploy begins at the new version, with nothing to restart", async () => {
    const l = lab();
    const after = l.deploy(PUBLIC_CHANGE());
    const cookie = await learner(after);

    const started = ok(await after.startChallenge(cookie, CHALLENGE_ID));

    assert.equal(started.created, true);
    assert.equal(started.restarted, false);
    assert.equal(started.session.contentVersion, PUBLIC_CHANGE().contentVersion(CHALLENGE_ID));
  });

  test("only the challenge that changed is stale: the same learner's other challenge carries on", async () => {
    const second = (change?: (d: Draft) => void) => (d: Draft) => {
      d.scenario.challenge.id = "challenge-002";
      d.scenario.challenge.number = "002";
      change?.(d);
    };
    const two = (changeSecond?: (d: Draft) => void) =>
      createChallengeRegistry([definitionOf(), definitionOf(second(changeSecond))]);

    const l = lab();
    const before = l.deploy(two());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, "challenge-001"));
    ok(await before.startChallenge(cookie, "challenge-002"));

    const after = l.deploy(two((d) => (d.scenario.challenge.incident = "Challenge two changed.")));

    assert.equal(ok(await after.getChallengeSession(cookie, "challenge-001")).session?.restartRequired, false);
    assert.equal(ok(await after.getChallengeSession(cookie, "challenge-002")).session?.restartRequired, true);
    assert.equal(ok(await after.startChallenge(cookie, "challenge-001")).restarted, false);
    assert.equal(ok(await after.startChallenge(cookie, "challenge-002")).restarted, true);
  });

  test("reads and history never restart anything, however many times they are made", async () => {
    const l = lab();
    const before = l.deploy(BASE());
    const cookie = await learner(before);
    ok(await before.startChallenge(cookie, CHALLENGE_ID));
    const after = l.deploy(PUBLIC_CHANGE());
    const { current } = await sessionIds(l, cookie);

    for (let i = 0; i < 5; i += 1) {
      ok(await after.getChallengeSession(cookie, CHALLENGE_ID));
      ok(await after.listAttempts(cookie, CHALLENGE_ID));
      await after.checkLearner(cookie);
    }

    assert.equal((await sessionIds(l, cookie)).current, current);
    assert.equal(countSessions(l), 1);
  });
});
