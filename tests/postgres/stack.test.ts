/*
 * The whole stack on a real PostgreSQL, through the real HTTP handlers: two independent application instances
 * (separate pools, stores, services and handlers) sharing one database. This is where the agreed v1 behaviours
 * are shown to hold on durable storage: idempotent diagnosis, completed results that persist and stay read-only,
 * expired learners treated as missing, and nothing secret written to or served from the database.
 *
 * Nothing mounts these handlers. The tests call them directly, exactly as a route would.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import { createAppServices } from "@/server/app-services";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import {
  createAttemptHistoryHandler,
  createChallengeSessionHandlers,
  createLearnerHandlers,
} from "@/server/session/handlers";
import { createLearnerSessionService } from "@/server/session/service";
import { CHALLENGE_ID, CORRECT_ID, RESOLUTION, WRONG_IDS, submission } from "../diagnosis/fixtures";
import { fulfilled, stampede } from "./concurrency";
import { SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const fixture = pgFixture();
const ORIGIN = "http://localhost:3000";
const key = (n: number) => `0a0b0c0d-0000-4000-8000-${String(n).padStart(12, "0")}`;
const open: PostgresPersistence[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((persistence) => persistence.close()));
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** One full application instance on its own connections. */
async function instance(pg: Fixture) {
  const persistence = createPostgresPersistence({ config: { connectionString: pg.db.url, poolMax: 8 } });
  open.push(persistence);
  const services = createAppServices({ store: persistence.store, appOrigin: null });
  const handlerDeps = { service: services.service, appOrigin: null };
  const learner = createLearnerHandlers(handlerDeps);
  const sessions = createChallengeSessionHandlers(handlerDeps);
  const attempts = createAttemptHistoryHandler(handlerDeps);
  const ctx = { params: Promise.resolve({ challengeId: CHALLENGE_ID }) };

  const headers = (cookie?: string, extra: Record<string, string> = {}) => ({
    host: "localhost:3000",
    ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}),
    ...extra,
  });
  const write = (path: string, cookie?: string, extra: Record<string, string> = {}, body = "{}") =>
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { ...headers(cookie), "content-type": "application/json", origin: ORIGIN, ...extra },
      body,
    });
  const read = (path: string, cookie?: string) => new Request(`${ORIGIN}${path}`, { method: "GET", headers: headers(cookie) });

  /** Every response body this instance produced, so a test can search them all. */
  const seen: string[] = [];
  const settle = async (response: Response) => {
    const text = await response.text();
    seen.push(text);
    return { status: response.status, headers: response.headers, text, json: text ? JSON.parse(text) : null };
  };

  return {
    persistence,
    services,
    seen,
    async startLearner(cookie?: string) {
      const result = await settle(await learner.POST(write("/api/learner", cookie)));
      return { ...result, cookie: /buglab_learner=([^;]+)/.exec(result.headers.get("set-cookie") ?? "")?.[1] };
    },
    getLearner: async (cookie?: string) => settle(await learner.GET(read("/api/learner", cookie))),
    startChallenge: async (cookie: string) => settle(await sessions.POST(write(`/api/challenges/${CHALLENGE_ID}/session`, cookie), ctx)),
    getSession: async (cookie: string) => settle(await sessions.GET(read(`/api/challenges/${CHALLENGE_ID}/session`, cookie), ctx)),
    getAttempts: async (cookie: string) => settle(await attempts.GET(read(`/api/challenges/${CHALLENGE_ID}/attempts`, cookie), ctx)),
    async diagnose(cookie: string, idempotencyKey: string | null, rootCauseId: string, extra: Record<string, string> = {}) {
      const request = write(
        `/api/challenges/${CHALLENGE_ID}/diagnosis`,
        cookie,
        { ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}), ...extra },
        JSON.stringify(submission({ rootCauseId })),
      );
      return settle(await services.diagnosis(request, ctx));
    },
  };
}

/** A learner who has started the challenge, on instance `a`. */
async function readyLearner(a: Awaited<ReturnType<typeof instance>>) {
  const { cookie } = await a.startLearner();
  assert.ok(cookie);
  assert.equal((await a.startChallenge(cookie)).status, 201);
  return cookie;
}

/** Everything in the database as text, with a completed session's stored result held apart (it is allowed to hold what the learner was shown). */
async function databaseText(pg: Fixture) {
  const rest = await pg.query<{ text: string }>(
    `SELECT coalesce(string_agg(x::text, E'\\n'), '') AS text FROM (
       SELECT to_jsonb(l) AS x FROM learners l
       UNION ALL SELECT to_jsonb(s) - 'result' FROM challenge_sessions s
       UNION ALL SELECT to_jsonb(a) FROM diagnosis_attempts a
       UNION ALL SELECT to_jsonb(r) FROM rate_limit_buckets r
       UNION ALL SELECT to_jsonb(m) FROM buglab_schema_migrations m) t`,
  );
  const results = await pg.query<{ result: unknown }>("SELECT result FROM challenge_sessions WHERE result IS NOT NULL");
  return { rest: rest.rows[0].text, results: results.rows.map((row) => JSON.stringify(row.result)).join("\n") };
}

describe("the whole stack on PostgreSQL, across two instances", { skip: SKIP }, () => {
  describe("a learner's journey crosses instances", () => {
    test("a cookie issued by one instance works on the other, through to a stored completion", async () => {
      const pg = await fixture();
      await pg.reset();
      const [a, b] = [await instance(pg), await instance(pg)];

      const { cookie } = await a.startLearner();
      assert.ok(cookie);
      assert.equal((await b.getLearner(cookie)).json.learner.state, "active", "B knows the learner A created");
      assert.equal((await b.startChallenge(cookie)).status, 201);
      assert.equal((await a.getSession(cookie)).json.session.state, "active");

      const wrong = await a.diagnose(cookie, key(1), WRONG_IDS[0]);
      assert.deepEqual([wrong.status, wrong.json.status], [200, "incorrect"]);
      const right = await b.diagnose(cookie, key(2), CORRECT_ID);
      assert.deepEqual([right.status, right.json.status], [200, "correct"]);
      assert.equal(right.json.resolution.summary, RESOLUTION);

      const session = (await a.getSession(cookie)).json.session;
      assert.equal(session.status, "completed");
      assert.equal(session.completion.resolution.summary, RESOLUTION);
      assert.deepEqual(session.attempts.total, 2);
      const history = (await b.getAttempts(cookie)).json.attempts;
      assert.deepEqual(history.map((attempt: { result: string }) => attempt.result), ["incorrect", "correct"]);
    });

    test("a different learner on the other instance sees none of it", async () => {
      const pg = await fixture();
      await pg.reset();
      const [a, b] = [await instance(pg), await instance(pg)];
      const alice = await readyLearner(a);
      await a.diagnose(alice, key(1), WRONG_IDS[0]);

      const { cookie: bob } = await b.startLearner();
      assert.ok(bob);
      assert.deepEqual((await b.getSession(bob)).json, { session: { state: "none" } });
      assert.equal((await b.startChallenge(bob)).status, 201);
      assert.equal((await b.getSession(bob)).json.session.attempts.total, 0, "Bob starts from nothing");
      assert.equal((await b.getAttempts(bob)).json.attempts.length, 0);
    });
  });

  describe("idempotent diagnosis", () => {
    test("the same submission repeated, on either instance, is answered identically and recorded once", async () => {
      const pg = await fixture();
      await pg.reset();
      const [a, b] = [await instance(pg), await instance(pg)];
      const cookie = await readyLearner(a);

      const first = await a.diagnose(cookie, key(1), WRONG_IDS[0]);
      const replayOnB = await b.diagnose(cookie, key(1), WRONG_IDS[0]);
      const replayOnA = await a.diagnose(cookie, key(1), WRONG_IDS[0]);

      assert.equal(first.status, 200);
      assert.deepEqual(replayOnB.json.status, "incorrect");
      assert.deepEqual(replayOnB.json.feedback, first.json.feedback);
      assert.deepEqual(replayOnA.json.feedback, first.json.feedback);
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM diagnosis_attempts")).rows[0].n, 1);
    });

    test("twenty simultaneous copies of one correct submission, across both instances: all 200, one completion", async () => {
      const pg = await fixture();
      await pg.reset();
      const [a, b] = [await instance(pg), await instance(pg)];
      const cookie = await readyLearner(a);
      const { rows } = await pg.query<{ id: string }>("SELECT id FROM challenge_sessions");

      const responses = fulfilled(
        await stampede(a.persistence.pool, "SELECT 1 FROM challenge_sessions WHERE id = $1 FOR UPDATE", [rows[0].id], () =>
          Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? a : b).diagnose(cookie, key(7), CORRECT_ID)),
        ),
      );

      assert.ok(responses.every((r) => r.status === 200 && r.json.status === "correct"), "every copy is answered correct");
      assert.ok(responses.every((r) => r.json.resolution.summary === RESOLUTION));
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM diagnosis_attempts")).rows[0].n, 1, "recorded once");
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM challenge_sessions WHERE status = 'completed'")).rows[0].n, 1);
    });

    test("the same key with a different answer is refused, never silently accepted", async () => {
      const pg = await fixture();
      await pg.reset();
      const [a, b] = [await instance(pg), await instance(pg)];
      const cookie = await readyLearner(a);
      await a.diagnose(cookie, key(1), WRONG_IDS[0]);

      const reused = await b.diagnose(cookie, key(1), WRONG_IDS[1]);
      assert.equal(reused.status, 409);
      assert.equal(reused.json.code, "submission-id-conflict");
    });

    test("a malformed Idempotency-Key keeps the existing 400 invalid response on field `body`, and records nothing", async () => {
      const pg = await fixture();
      await pg.reset();
      const a = await instance(pg);
      const cookie = await readyLearner(a);

      const bad = await a.diagnose(cookie, "not-a-uuid", WRONG_IDS[0]);
      assert.equal(bad.status, 400);
      assert.deepEqual(bad.json, { status: "invalid", errors: [{ field: "body", message: "Idempotency-Key must be a UUID." }] });
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM diagnosis_attempts")).rows[0].n, 0);
    });
  });

  describe("completed results are durable and read-only", () => {
    test("repeating a submission after completion returns the stored correct result with 200, and records nothing", async () => {
      const pg = await fixture();
      await pg.reset();
      const [a, b] = [await instance(pg), await instance(pg)];
      const cookie = await readyLearner(a);
      await a.diagnose(cookie, key(1), CORRECT_ID);

      for (const [instanceUnderTest, k, answer] of [[b, key(1), CORRECT_ID], [b, key(2), WRONG_IDS[0]], [a, key(3), CORRECT_ID]] as const) {
        const again = await instanceUnderTest.diagnose(cookie, k, answer);
        assert.equal(again.status, 200);
        assert.equal(again.json.status, "correct", "whatever was sent, the completed session answers with its stored result");
        assert.equal(again.json.resolution.summary, RESOLUTION);
      }
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM diagnosis_attempts")).rows[0].n, 1);
    });

    test("the stored result is what the learner saw, even if the challenge's content version later changes", async () => {
      const pg = await fixture();
      await pg.reset();
      const a = await instance(pg);
      const cookie = await readyLearner(a);
      await a.diagnose(cookie, key(1), CORRECT_ID);
      const completedAt = (await a.getSession(cookie)).json.session.completedAt;

      // A deploy that changes the challenge: a second composition whose version differs.
      const challenges = createDefaultChallengeRegistry();
      const service = createLearnerSessionService({
        learners: a.persistence.store,
        sessions: a.persistence.store,
        attempts: a.persistence.store,
        registry: challenges.diagnosisRegistry,
        challengeVersion: () => "99+changed",
      });
      const restarted = await service.startChallenge(cookie, CHALLENGE_ID);

      assert.ok(restarted.status === "ok");
      assert.deepEqual([restarted.created, restarted.restarted], [false, false], "a completed session is never restarted, so a restart preserves the original completion");
      assert.equal(restarted.session.status, "completed");
      assert.equal(restarted.session.completedAt, completedAt);
      assert.equal(restarted.session.completion?.resolution.summary, RESOLUTION);
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM challenge_sessions")).rows[0].n, 1, "no second session");
    });

    test("an unfinished session at an old version is replaced, keeping the old one as history (the restart is explicit)", async () => {
      const pg = await fixture();
      await pg.reset();
      const a = await instance(pg);
      const cookie = await readyLearner(a);
      await a.diagnose(cookie, key(1), WRONG_IDS[0]);

      const challenges = createDefaultChallengeRegistry();
      const service = createLearnerSessionService({
        learners: a.persistence.store,
        sessions: a.persistence.store,
        attempts: a.persistence.store,
        registry: challenges.diagnosisRegistry,
        challengeVersion: () => "99+changed",
      });
      const stale = await service.getChallengeSession(cookie, CHALLENGE_ID);
      assert.ok(stale.status === "ok" && stale.session?.restartRequired);
      const outcome = await service.startChallenge(cookie, CHALLENGE_ID);

      assert.ok(outcome.status === "ok");
      assert.deepEqual([outcome.created, outcome.restarted], [true, true]);
      assert.equal(outcome.session.attempts.total, 0, "the new session has its own empty history and window");
      const rows = await pg.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE superseded_at IS NOT NULL)::int AS history FROM challenge_sessions");
      assert.deepEqual({ ...rows.rows[0] }, { n: 2, history: 1 });
    });
  });

  describe("expired learners are missing, purged or not", () => {
    test("an expired learner is reported expired and refused everywhere; a new learner starts clean and the old one is never revived", async () => {
      const pg = await fixture();
      await pg.reset();
      const [a, b] = [await instance(pg), await instance(pg)];
      const old = await readyLearner(a);
      await a.diagnose(old, key(1), WRONG_IDS[0]);
      // Expire it, inside the grace period.
      await pg.query("UPDATE learners SET idle_expires_at = (floor(extract(epoch from clock_timestamp()) * 1000))::bigint - 1000, absolute_expires_at = (floor(extract(epoch from clock_timestamp()) * 1000))::bigint - 1000");

      assert.equal((await b.getLearner(old)).json.learner.state, "expired");
      assert.equal((await b.getSession(old)).status, 401);
      assert.equal((await b.getSession(old)).json.code, "learner-expired");
      assert.equal((await b.diagnose(old, key(2), CORRECT_ID)).status, 401, "an expired learner cannot submit, and nothing is recorded");
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM diagnosis_attempts")).rows[0].n, 1);

      // The agreed v1 behaviour: the learner reinitialises. A brand-new learner, a brand-new session.
      const fresh = await b.startLearner(old);
      assert.equal(fresh.status, 201);
      assert.ok(fresh.cookie && fresh.cookie !== old, "a new identity, not the old one revived");
      assert.deepEqual((await a.getSession(fresh.cookie)).json, { session: { state: "none" } });
      assert.equal((await b.startChallenge(fresh.cookie)).json.session.attempts.total, 0);
      assert.equal((await a.getLearner(old)).json.learner.state, "expired", "and the old cookie is still expired");
    });

    test("a learner past its purge grace period is `none` before any purge has run, and the purge then reclaims it", async () => {
      const pg = await fixture();
      await pg.reset();
      const [a, b] = [await instance(pg), await instance(pg)];
      const old = await readyLearner(a);
      await pg.query(
        "UPDATE learners SET idle_expires_at = (floor(extract(epoch from clock_timestamp()) * 1000))::bigint - $1::bigint, absolute_expires_at = (floor(extract(epoch from clock_timestamp()) * 1000))::bigint - $1::bigint",
        [DEFAULT_EXPIRY_POLICY.purgeGraceMs + 60_000],
      );

      assert.equal((await b.getLearner(old)).json.learner.state, "none", "treated as missing although the rows are still there");
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n, 1);
      assert.equal((await b.getSession(old)).json.code, "learner-missing");

      const purged = await b.persistence.purgeExpired();
      assert.equal(purged.learners, 1);
      const left = await pg.query("SELECT (SELECT count(*)::int FROM learners) AS learners, (SELECT count(*)::int FROM challenge_sessions) AS sessions");
      assert.deepEqual({ ...left.rows[0] }, { learners: 0, sessions: 0 }, "the learner's sessions went with it");
    });
  });

  describe("security", () => {
    test("the database never holds the answer key: nothing derived from it is written, except what a completed learner was shown", async () => {
      const pg = await fixture();
      await pg.reset();
      const a = await instance(pg);
      const cookie = await readyLearner(a);
      // Several wrong attempts first: their feedback is derived from the key, and none of it may be stored.
      await a.diagnose(cookie, key(1), WRONG_IDS[0]);
      await a.diagnose(cookie, key(2), WRONG_IDS[1]);

      const secrets = [
        provisionalAnswerKey.rootCause,
        ...provisionalAnswerKey.evidence.map((item) => item.detail),
        ...provisionalAnswerKey.keyObservations.map((observation) => observation.why),
      ].map((text) => text.slice(0, 40));
      const resolution = provisionalAnswerKey.resolutionSummary.slice(0, 40);

      const beforeCompletion = await databaseText(pg);
      for (const text of [...secrets, resolution]) {
        assert.ok(!beforeCompletion.rest.includes(text), `unfinished: "${text}" is not in any table`);
        assert.ok(!beforeCompletion.results.includes(text));
      }
      assert.equal(beforeCompletion.results, "", "an unfinished session has no stored result");

      await a.diagnose(cookie, key(3), CORRECT_ID);
      const afterCompletion = await databaseText(pg);
      for (const text of [...secrets, resolution]) {
        assert.ok(!afterCompletion.rest.includes(text), `completed: "${text}" is in no column but the stored result`);
      }
      assert.ok(afterCompletion.results.includes(resolution), "the stored result holds exactly what the learner was shown");
      for (const text of [provisionalAnswerKey.rootCause.slice(0, 40), ...provisionalAnswerKey.evidence.map((item) => item.detail.slice(0, 40))]) {
        assert.ok(!afterCompletion.results.includes(text), `the stored result does not hold "${text}"`);
      }
    });

    test("the raw token is never stored: the database holds only its hash", async () => {
      const pg = await fixture();
      await pg.reset();
      const a = await instance(pg);
      const cookie = await readyLearner(a);
      await a.diagnose(cookie, key(1), WRONG_IDS[0]);
      await a.getLearner(cookie);

      const text = await databaseText(pg);
      assert.ok(!text.rest.includes(cookie) && !text.results.includes(cookie));
      const stored = (await pg.query("SELECT token_hash FROM learners")).rows[0].token_hash as string;
      assert.match(stored, /^[0-9a-f]{64}$/);
      assert.notEqual(stored, cookie);
    });

    test("no response ever carries an internal id, a token hash or the raw token", async () => {
      const pg = await fixture();
      await pg.reset();
      const [a, b] = [await instance(pg), await instance(pg)];
      const { cookie } = await a.startLearner();
      assert.ok(cookie);
      await a.startChallenge(cookie);
      await b.getLearner(cookie);
      await b.getSession(cookie);
      await a.diagnose(cookie, key(1), WRONG_IDS[0]);
      await b.diagnose(cookie, key(2), CORRECT_ID);
      await b.diagnose(cookie, key(2), CORRECT_ID);
      await a.getAttempts(cookie);
      await a.getSession(cookie);

      const internal = [
        ...(await pg.query("SELECT id, token_hash FROM learners")).rows.flatMap((r) => [r.id, r.token_hash]),
        ...(await pg.query("SELECT id FROM challenge_sessions")).rows.map((r) => r.id),
        ...(await pg.query("SELECT id FROM diagnosis_attempts")).rows.map((r) => r.id),
      ] as string[];
      assert.equal(internal.length, 5, "a learner id and token hash, one session id, two attempt ids");
      for (const body of [...a.seen, ...b.seen]) {
        for (const value of internal) assert.ok(!body.includes(value), `a response contains the internal value ${value.slice(0, 8)}…`);
        assert.ok(!body.includes(cookie), "the raw token appears only in the Set-Cookie header, never a body");
      }
    });

    test("one learner's cookie reaches only that learner's data", async () => {
      const pg = await fixture();
      await pg.reset();
      const [a, b] = [await instance(pg), await instance(pg)];
      const alice = await readyLearner(a);
      const { cookie: bob } = await b.startLearner();
      assert.ok(bob);
      await b.startChallenge(bob);
      await a.diagnose(alice, key(1), CORRECT_ID);

      assert.equal((await b.getSession(bob)).json.session.status, "active", "Bob's own session, not Alice's completed one");
      assert.equal((await b.getAttempts(bob)).json.attempts.length, 0);
      const forged = await b.getSession("A".repeat(43));
      assert.equal(forged.status, 401, "a guessed token reaches nothing");
    });

    test("cross-origin writes are refused on durable storage too, and write nothing", async () => {
      const pg = await fixture();
      await pg.reset();
      const a = await instance(pg);
      const cookie = await readyLearner(a);

      const forged = await a.diagnose(cookie, key(1), CORRECT_ID, { origin: "https://evil.example" });
      assert.equal(forged.status, 403);
      const noOrigin = await a.services.diagnosis(
        new Request(`${ORIGIN}/api/challenges/${CHALLENGE_ID}/diagnosis`, {
          method: "POST",
          headers: { host: "localhost:3000", "content-type": "application/json", cookie: `${LEARNER_COOKIE}=${cookie}` },
          body: JSON.stringify(submission({ rootCauseId: CORRECT_ID })),
        }),
        { params: Promise.resolve({ challengeId: CHALLENGE_ID }) },
      );
      assert.equal(noOrigin.status, 403, "a headerless write is never allowed");
      assert.equal((await pg.query("SELECT count(*)::int AS n FROM diagnosis_attempts")).rows[0].n, 0);
    });

    test("a database failure is a plain 500 that leaks neither the connection string nor any detail", async () => {
      const pg = await fixture();
      await pg.reset();
      const a = await instance(pg);
      const cookie = await readyLearner(a);
      await a.persistence.pool.end();

      for (const response of [await a.getSession(cookie), await a.diagnose(cookie, key(1), CORRECT_ID), await a.startLearner()]) {
        assert.equal(response.status, 500);
        assert.equal(response.json.code, "internal");
        assert.ok(!response.text.includes(pg.db.url) && !/postgres|pool|ECONN|buglab_test/i.test(response.text));
        assert.equal(response.headers.get("set-cookie"), null);
      }
    });
  });
});
