/*
 * How the learner-session module honours Syeda's publication gate (src/server/diagnosis/published.ts). The gate is now part
 * of the DEFAULT composition (createAppServices), so a route cannot forget it. It changes neither the gate nor any route.
 *
 * The gate is a registry filter: a challenge that is not published is left out of the registry, so it is an unknown
 * challenge. The session service checks its registry FIRST in every operation, so a gated registry covers session
 * creation and restart, diagnosis, session reads and attempt history in one move. These tests prove that,
 * and the properties the documentation relies on:
 *
 *   - an unpublished challenge is indistinguishable from one that does not exist (same status, same body),
 *   - the refusal happens before the learner is even looked up: no oracle, no refresh, nothing written,
 *   - unpublishing leaves stored sessions intact and inert; republishing resumes them,
 *   - no answer-key data is served for an unpublished challenge, even to a learner who completed it earlier.
 *
 * It imports only the gate (not the catalog UI), and runs on the in-memory store. The same lifecycle on durable
 * storage is in tests/postgres/publication-gate.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAppServices, type AppServices, type SessionStore } from "@/server/app-services";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { ReadOnlyMap } from "@/server/challenges/read-only";
import { publishedChallengeIds } from "@/server/diagnosis/published";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { createAttemptHistoryHandler, createChallengeSessionHandlers, createLearnerHandlers } from "@/server/session/handlers";
import { MemoryStore } from "@/server/session/memory-store";
import { hashSessionToken, parseSessionToken } from "@/server/session/token";
import { CHALLENGE_ID, CORRECT_ID, RESOLUTION, WRONG_IDS, submission } from "../diagnosis/fixtures";

const ORIGIN = "http://localhost:3000";
const START = Date.parse("2026-11-01T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const key = (n: number) => `0a0b0c0d-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOTHING_PUBLISHED: ReadonlySet<string> = new Set();
const ctx = (challengeId: string) => ({ params: Promise.resolve({ challengeId }) });

/** The default composition: createAppServices applies the publication gate itself. `published` is the test-only override. */
function compose(published: ReadonlySet<string>, store: SessionStore, now: () => number = () => START): AppServices {
  return createAppServices({ store, publishedChallengeIds: published, appOrigin: null, trustedProxyHops: 0, now });
}

function api(services: AppServices) {
  const deps = { service: services.service, appOrigin: null };
  const learner = createLearnerHandlers(deps);
  const sessions = createChallengeSessionHandlers(deps);
  const attempts = createAttemptHistoryHandler(deps);
  const headers = (cookie?: string, extra: Record<string, string> = {}) => ({
    host: "localhost:3000",
    ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}),
    ...extra,
  });
  const write = (path: string, cookie?: string, extra: Record<string, string> = {}, body = "{}") =>
    new Request(`${ORIGIN}${path}`, { method: "POST", headers: { ...headers(cookie), "content-type": "application/json", origin: ORIGIN, ...extra }, body });
  const read = (path: string, cookie?: string) => new Request(`${ORIGIN}${path}`, { headers: headers(cookie) });
  const settle = async (response: Response) => {
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text), setCookie: response.headers.get("set-cookie") };
  };
  return {
    startLearner: async () => {
      const result = await settle(await learner.POST(write("/api/learner")));
      return /buglab_learner=([^;]+)/.exec(result.setCookie ?? "")?.[1] as string;
    },
    startChallenge: async (cookie: string | undefined, id = CHALLENGE_ID) => settle(await sessions.POST(write(`/api/challenges/${id}/session`, cookie), ctx(id))),
    getSession: async (cookie: string | undefined, id = CHALLENGE_ID) => settle(await sessions.GET(read(`/api/challenges/${id}/session`, cookie), ctx(id))),
    getAttempts: async (cookie: string | undefined, id = CHALLENGE_ID) => settle(await attempts.GET(read(`/api/challenges/${id}/attempts`, cookie), ctx(id))),
    diagnose: async (cookie: string | undefined, idempotencyKey: string, rootCauseId: string, id = CHALLENGE_ID) =>
      settle(
        await services.diagnosis(
          write(`/api/challenges/${id}/diagnosis`, cookie, { "idempotency-key": idempotencyKey }, JSON.stringify(submission({ rootCauseId }))),
          ctx(id),
        ),
      ),
  };
}

describe("the publication gate, applied to the learner-session module", () => {
  test("with the catalog's real published set, Challenge 001 is playable end to end", async () => {
    assert.ok(publishedChallengeIds().has(CHALLENGE_ID), "the catalog publishes it today");
    const a = api(compose(publishedChallengeIds(), new MemoryStore()));
    const cookie = await a.startLearner();
    assert.equal((await a.startChallenge(cookie)).status, 201);
    assert.equal((await a.diagnose(cookie, key(1), CORRECT_ID)).json.status, "correct");
    assert.equal((await a.getAttempts(cookie)).status, 200);
  });

  describe("an unpublished challenge", () => {
    test("is refused by every operation: session creation (and so restart), session read, diagnosis and attempt history", async () => {
      const store = new MemoryStore();
      const open = api(compose(publishedChallengeIds(), store));
      const cookie = await open.startLearner();

      const closed = api(compose(NOTHING_PUBLISHED, store));
      for (const [operation, response] of [
        ["start / restart", await closed.startChallenge(cookie)],
        ["read session", await closed.getSession(cookie)],
        ["diagnosis", await closed.diagnose(cookie, key(1), CORRECT_ID)],
        ["attempt history", await closed.getAttempts(cookie)],
      ] as const) {
        assert.equal(response.status, 404, operation);
        assert.equal(response.json.code, "unknown-challenge", operation);
      }
    });

    test("is indistinguishable from a challenge that does not exist: same status, same body, on every operation", async () => {
      const store = new MemoryStore();
      const cookie = await api(compose(publishedChallengeIds(), store)).startLearner();
      const closed = api(compose(NOTHING_PUBLISHED, store));

      const pairs = [
        [await closed.startChallenge(cookie, CHALLENGE_ID), await closed.startChallenge(cookie, "challenge-999")],
        [await closed.getSession(cookie, CHALLENGE_ID), await closed.getSession(cookie, "challenge-999")],
        [await closed.getAttempts(cookie, CHALLENGE_ID), await closed.getAttempts(cookie, "challenge-999")],
        [await closed.diagnose(cookie, key(1), CORRECT_ID, CHALLENGE_ID), await closed.diagnose(cookie, key(1), CORRECT_ID, "challenge-999")],
      ];
      for (const [draft, missing] of pairs) {
        assert.equal(draft.status, missing.status);
        assert.equal(draft.text, missing.text, "a client cannot tell a draft from a typo");
      }
    });

    test("is refused BEFORE the learner is looked up: no oracle about the learner, no cookie, nothing refreshed", async () => {
      let now = START;
      const store = new MemoryStore({ now: () => now });
      const open = api(compose(publishedChallengeIds(), store, () => now));
      const cookie = await open.startLearner();
      const closed = api(compose(NOTHING_PUBLISHED, store, () => now));

      // No cookie, a made-up cookie and a real one all get the same answer: not 401, because identity is never examined.
      for (const who of [undefined, "A".repeat(43), cookie]) {
        const response = await closed.getSession(who);
        assert.equal(response.status, 404);
        assert.equal(response.json.code, "unknown-challenge");
        assert.equal(response.setCookie, null);
      }
      // A day later a read would normally refresh the learner's idle expiry. Refusing a draft must not.
      now += DAY + 1000;
      const before = JSON.stringify(await store.findByTokenHash(hashOf(cookie)));
      await closed.getSession(cookie);
      await closed.getAttempts(cookie);
      assert.equal(JSON.stringify(await store.findByTokenHash(hashOf(cookie))), before, "the learner record is untouched");
    });

    test("is never created, started or restarted: nothing is written", async () => {
      const store = new MemoryStore();
      const cookie = await api(compose(publishedChallengeIds(), store)).startLearner();
      const closed = api(compose(NOTHING_PUBLISHED, store));

      await closed.startChallenge(cookie);
      await closed.diagnose(cookie, key(1), WRONG_IDS[0]);

      const sessions = (store as unknown as { sessions: Map<string, unknown> }).sessions;
      const attempts = (store as unknown as { attempts: Map<string, unknown[]> }).attempts;
      assert.equal(sessions.size, 0);
      assert.equal([...attempts.values()].flat().length, 0);
    });

    test("serves no answer-key data, even though the key is registered and the answer is correct", async () => {
      const store = new MemoryStore();
      const closed = api(compose(NOTHING_PUBLISHED, store));
      const cookie = await closed.startLearner();

      const response = await closed.diagnose(cookie, key(1), CORRECT_ID);
      assert.equal(response.status, 404);
      assert.ok(!response.text.includes(RESOLUTION.slice(0, 40)) && !/resolution|feedback|hint/i.test(response.text));
    });

    test("a published id that the challenge registry does not have is not playable either: the gate fails closed", async () => {
      const store = new MemoryStore();
      const a = api(compose(new Set(["challenge-777"]), store));
      const cookie = await a.startLearner();
      assert.equal((await a.startChallenge(cookie, "challenge-777")).status, 404);
      assert.equal((await a.startChallenge(cookie, CHALLENGE_ID)).status, 404, "and a registered but unpublished one stays closed");
    });
  });

  describe("unpublishing and republishing a challenge a learner already has a session in", () => {
    test("the stored session is kept untouched and inert while unpublished, and resumes on republishing", async () => {
      const store = new MemoryStore();
      const open = api(compose(publishedChallengeIds(), store));
      const closed = api(compose(NOTHING_PUBLISHED, store));
      const cookie = await open.startLearner();
      await open.startChallenge(cookie);
      await open.diagnose(cookie, key(1), WRONG_IDS[0]);
      const snapshot = JSON.stringify([...(store as unknown as { sessions: Map<string, unknown> }).sessions.values()]);

      // Unpublished: nothing works, and nothing changes.
      assert.equal((await closed.diagnose(cookie, key(2), CORRECT_ID)).status, 404);
      assert.equal((await closed.startChallenge(cookie)).status, 404, "a restart is not performed for an unpublished challenge");
      assert.equal(JSON.stringify([...(store as unknown as { sessions: Map<string, unknown> }).sessions.values()]), snapshot);

      // Republished: the same session, with its attempt, continues.
      const resumed = await open.getSession(cookie);
      assert.equal(resumed.json.session.attempts.total, 1);
      assert.equal((await open.diagnose(cookie, key(2), CORRECT_ID)).json.status, "correct");
    });

    test("a completed result is not served while unpublished (strict gate), and is again once republished", async () => {
      const store = new MemoryStore();
      const open = api(compose(publishedChallengeIds(), store));
      const closed = api(compose(NOTHING_PUBLISHED, store));
      const cookie = await open.startLearner();
      await open.startChallenge(cookie);
      await open.diagnose(cookie, key(1), CORRECT_ID);

      for (const response of [await closed.getSession(cookie), await closed.getAttempts(cookie), await closed.diagnose(cookie, key(1), CORRECT_ID)]) {
        assert.equal(response.status, 404);
        assert.ok(!response.text.includes(RESOLUTION.slice(0, 40)));
      }
      assert.equal((await open.getSession(cookie)).json.session.completion.resolution.summary, RESOLUTION, "the stored result is intact");
    });
  });

  describe("the gate is part of the default composition", () => {
    const DRAFT = "challenge-draft";

    /** Challenge 001 plus a draft that has an answer key registered but is not in the catalog. */
    function registryWithDraft() {
      const real = createDefaultChallengeRegistry();
      const realKey = real.diagnosisRegistry.get(CHALLENGE_ID);
      assert.ok(realKey);
      const diagnosis = new ReadOnlyMap([...real.diagnosisRegistry, [DRAFT, { ...realKey, challengeId: DRAFT }] as const]);
      return {
        ...real,
        list: () => [...real.list(), { ...real.list()[0], id: DRAFT }],
        getPublic: (id: string) => (id === DRAFT ? real.getPublic(CHALLENGE_ID) : real.getPublic(id)),
        getDiagnosis: (id: string) => diagnosis.get(id),
        contentVersion: (id: string) => (id === DRAFT ? "1+draft" : real.contentVersion(id)),
        diagnosisRegistry: diagnosis,
      };
    }

    test("with no wrapper and no option, a draft with a registered answer key is hidden from every accessor and every operation", async () => {
      const services = createAppServices({ challenges: registryWithDraft(), store: new MemoryStore(), appOrigin: null });

      // Every real, published challenge stays (not just Challenge 001); only the draft goes.
      const expected = createDefaultChallengeRegistry().list().map((summary) => summary.id).filter((id) => publishedChallengeIds().has(id));
      assert.ok(expected.length > 1 && expected.includes(CHALLENGE_ID), "the real catalog has many published challenges");
      assert.deepEqual(services.challenges.list().map((summary) => summary.id), expected);
      assert.equal(services.challenges.list().some((summary) => summary.id === DRAFT), false);
      assert.equal(services.challenges.getDiagnosis(DRAFT), undefined, "its answer key cannot be fetched");
      assert.equal(services.challenges.getPublic(DRAFT), undefined);
      assert.equal(services.challenges.contentVersion(DRAFT), undefined);
      assert.equal(services.challenges.diagnosisRegistry.has(DRAFT), false);

      const a = api(services);
      const cookie = await a.startLearner();
      for (const response of [await a.startChallenge(cookie, DRAFT), await a.getSession(cookie, DRAFT), await a.getAttempts(cookie, DRAFT), await a.diagnose(cookie, key(1), CORRECT_ID, DRAFT)]) {
        assert.equal(response.status, 404);
        assert.equal(response.json.code, "unknown-challenge");
        assert.ok(!response.text.includes(RESOLUTION.slice(0, 40)));
      }
      assert.equal((await a.startChallenge(cookie, CHALLENGE_ID)).status, 201, "while the published challenge works");
    });

    test("it is the catalog's published set that decides, and the gated registry is read-only", () => {
      const services = createAppServices({ challenges: registryWithDraft(), store: new MemoryStore(), appOrigin: null });
      const expected = [...registryWithDraft().diagnosisRegistry.keys()].filter((id) => publishedChallengeIds().has(id));
      assert.deepEqual([...services.challenges.diagnosisRegistry.keys()], expected);
      assert.equal(Object.isFrozen(services.challenges.diagnosisRegistry), true);
      assert.equal("set" in services.challenges.diagnosisRegistry, false, "no way to add a challenge back");
    });

    test("when everything is published the registry is returned unchanged", () => {
      const challenges = createDefaultChallengeRegistry();
      assert.equal(createAppServices({ challenges, appOrigin: null }).challenges, challenges);
    });

    test("one gated registry reaches BOTH the session service and the diagnosis handler", () => {
      const source = readFileSync(join(fileURLToPath(new URL("../../", import.meta.url)), "src/server/app-services.ts"), "utf8");
      assert.equal((source.match(/challenges\.diagnosisRegistry/g) ?? []).length, 2);
      assert.match(source, /registry: challenges\.diagnosisRegistry,\s*\n\s*challengeVersion/);
      assert.match(source, /service,\s*\n\s*registry: challenges\.diagnosisRegistry/);
    });
  });
});

function hashOf(cookie: string) {
  return hashSessionToken(parseSessionToken(cookie) as NonNullable<ReturnType<typeof parseSessionToken>>);
}
