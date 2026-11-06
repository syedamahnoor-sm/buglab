/*
 * The publication gate on DURABLE storage. A challenge is unpublished by a deploy (the catalog is code), while learners'
 * sessions for it already exist in PostgreSQL. This shows that the stored rows are neither read, refreshed, changed nor
 * deleted by the refusals, that nothing is served for the unpublished challenge, and that republishing resumes the same
 * rows. The in-memory counterpart, with the fuller set of properties, is tests/session/publication-gate.test.ts.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createAppServices } from "@/server/app-services";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";
import { publishedChallengeIds } from "@/server/diagnosis/published";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { createChallengeSessionHandlers, createLearnerHandlers } from "@/server/session/handlers";
import { CHALLENGE_ID, CORRECT_ID, RESOLUTION, WRONG_IDS, submission } from "../diagnosis/fixtures";
import { SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const fixture = pgFixture();
const ORIGIN = "http://localhost:3000";
const key = (n: number) => `0a0b0c0d-0000-4000-8000-${String(n).padStart(12, "0")}`;
const open: PostgresPersistence[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((persistence) => persistence.close()));
});

/** One application instance, whose deploy published exactly `published`. */
async function deploy(published: ReadonlySet<string>) {
  const pg = await fixture();
  const persistence = createPostgresPersistence({ config: { connectionString: pg.db.url, poolMax: 4 } });
  open.push(persistence);
  const services = createAppServices({ store: persistence.store, publishedChallengeIds: published, appOrigin: null });
  const deps = { service: services.service, appOrigin: null };
  const learner = createLearnerHandlers(deps);
  const sessions = createChallengeSessionHandlers(deps);
  const ctx = { params: Promise.resolve({ challengeId: CHALLENGE_ID }) };
  const headers = (cookie?: string) => ({ host: "localhost:3000", ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}) });
  const post = (path: string, cookie?: string, extra: Record<string, string> = {}, body = "{}") =>
    new Request(`${ORIGIN}${path}`, { method: "POST", headers: { ...headers(cookie), "content-type": "application/json", origin: ORIGIN, ...extra }, body });
  const settle = async (response: Response) => {
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text), setCookie: response.headers.get("set-cookie") };
  };
  return {
    pg,
    async startLearner() {
      return /buglab_learner=([^;]+)/.exec((await learner.POST(post("/api/learner"))).headers.get("set-cookie") ?? "")?.[1] as string;
    },
    start: async (cookie: string) => settle(await sessions.POST(post(`/api/challenges/${CHALLENGE_ID}/session`, cookie), ctx)),
    get: async (cookie: string) => settle(await sessions.GET(new Request(`${ORIGIN}/x`, { headers: headers(cookie) }), ctx)),
    diagnose: async (cookie: string, idempotencyKey: string, rootCauseId: string) =>
      settle(await services.diagnosis(post(`/api/challenges/${CHALLENGE_ID}/diagnosis`, cookie, { "idempotency-key": idempotencyKey }, JSON.stringify(submission({ rootCauseId }))), ctx)),
  };
}

/** Every row of every learner-session table, as text, to prove a refusal changed nothing. */
async function rows(pg: Awaited<ReturnType<typeof fixture>>) {
  const { rows: all } = await pg.query<{ dump: string }>(
    `SELECT coalesce(string_agg(x::text, E'\\n' ORDER BY x::text), '') AS dump FROM (
       SELECT to_jsonb(l) AS x FROM learners l UNION ALL SELECT to_jsonb(s) FROM challenge_sessions s UNION ALL SELECT to_jsonb(a) FROM diagnosis_attempts a) t`,
  );
  return all[0].dump;
}

describe("unpublishing a challenge with live sessions in PostgreSQL", { skip: SKIP }, () => {
  test("a deploy that unpublishes it refuses everything and leaves every stored row exactly as it was; republishing resumes", async () => {
    const pg = await fixture();
    await pg.reset();
    const published = await deploy(publishedChallengeIds());
    const cookie = await published.startLearner();
    await published.start(cookie);
    await published.diagnose(cookie, key(1), WRONG_IDS[0]);
    const before = await rows(pg);

    const unpublished = await deploy(new Set());
    for (const response of [await unpublished.start(cookie), await unpublished.get(cookie), await unpublished.diagnose(cookie, key(2), CORRECT_ID)]) {
      assert.equal(response.status, 404);
      assert.equal(response.json.code, "unknown-challenge");
      assert.equal(response.setCookie, null);
    }
    assert.equal(await rows(pg), before, "no row was read-refreshed, changed, superseded or deleted");

    const republished = await deploy(publishedChallengeIds());
    const resumed = await republished.get(cookie);
    assert.equal(resumed.json.session.attempts.total, 1, "the same session, with its earlier attempt");
    assert.equal((await republished.diagnose(cookie, key(2), CORRECT_ID)).json.status, "correct");
  });

  test("a completed result stays in the database but is not served while the challenge is unpublished", async () => {
    const pg = await fixture();
    await pg.reset();
    const published = await deploy(publishedChallengeIds());
    const cookie = await published.startLearner();
    await published.start(cookie);
    await published.diagnose(cookie, key(1), CORRECT_ID);

    const unpublished = await deploy(new Set());
    const refused = await unpublished.get(cookie);
    assert.equal(refused.status, 404);
    assert.ok(!refused.text.includes(RESOLUTION.slice(0, 40)));
    const stored = await pg.query("SELECT result FROM challenge_sessions");
    assert.ok(JSON.stringify(stored.rows[0].result).includes(RESOLUTION.slice(0, 40)), "durable, just not served");

    assert.equal((await (await deploy(publishedChallengeIds())).get(cookie)).json.session.completion.resolution.summary, RESOLUTION);
  });
});
