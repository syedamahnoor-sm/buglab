/*
 * Distributed learner-creation rate limiting on a real PostgreSQL. Each "instance" below is a full, independent
 * application composition (its own connection pool, store, rate limiter, service and HTTP handlers) that shares
 * nothing with the others except the database. This is the claim that matters: one limit, however many instances.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { errorFromResponse } from "@/lib/learner-session/api";
import { createAppServices } from "@/server/app-services";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";
import { LEARNER_CREATION_SCOPE } from "@/server/ratelimit/learner-creation";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { createLearnerHandlers } from "@/server/session/handlers";
import { fulfilled, stampede } from "./concurrency";
import { SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const fixture = pgFixture();
const ORIGIN = "http://localhost:3000";
const open: PostgresPersistence[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((persistence) => persistence.close()));
});

/** One application instance: a complete composition on its own connections. */
async function instance(policy = { limit: 5, windowMs: 60_000 }) {
  const pg = await fixture();
  const persistence = createPostgresPersistence({ config: { connectionString: pg.db.url, poolMax: 8 } });
  open.push(persistence);
  const services = createAppServices({ store: persistence.store, trustedProxyHops: 1, appOrigin: null });
  const learner = createLearnerHandlers({
    service: services.service,
    appOrigin: null,
    learnerCreation: persistence.learnerCreationGuard({ trustedProxyHops: 1, policy }),
  });
  return { pg, persistence, services, learner };
}

function post({ ip = "203.0.113.9", cookie }: { ip?: string; cookie?: string } = {}) {
  return new Request(`${ORIGIN}/api/learner`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      origin: ORIGIN,
      "x-forwarded-for": ip,
      ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}),
    },
    body: "{}",
  });
}

const cookieOf = (response: Response) => /buglab_learner=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
const learnerCount = async (pg: Awaited<ReturnType<typeof fixture>>) => (await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n as number;

describe("distributed learner-creation limit (real PostgreSQL)", { skip: SKIP }, () => {
  test("two instances share one limit: the limit's worth of learners are created in total, never more", async () => {
    const pg = await fixture();
    await pg.reset();
    const [a, b] = [await instance(), await instance()];

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) statuses.push((await (i % 2 === 0 ? a : b).learner.POST(post())).status);

    assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429, 429, 429], "five were created across both instances, then both refuse");
    assert.equal(await learnerCount(pg), 5);
  });

  test("forty simultaneous creations from one address, spread over two instances: exactly five succeed and thirty-five are refused", async () => {
    const pg = await fixture();
    await pg.reset();
    const [a, b] = [await instance(), await instance()];

    // Every request is released at the same moment by a held lock on the counter table, so they truly collide.
    const responses = fulfilled(
      await stampede(a.persistence.pool, "LOCK TABLE rate_limit_buckets IN SHARE ROW EXCLUSIVE MODE", [], () =>
        Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? a : b).learner.POST(post())),
      ),
    );

    assert.equal(responses.filter((r) => r.status === 201).length, 5);
    assert.equal(responses.filter((r) => r.status === 429).length, 35);
    assert.equal(responses.filter((r) => r.status !== 201 && r.status !== 429).length, 0, "no other outcome, in particular no 500");
    assert.equal(await learnerCount(pg), 5, "the database holds exactly the admitted learners");
    for (const refused of responses.filter((r) => r.status === 429)) {
      assert.equal(refused.headers.get("set-cookie"), null);
      assert.match(refused.headers.get("retry-after") ?? "", /^\d+$/);
    }
    const created = responses.filter((r) => r.status === 201).map(cookieOf);
    assert.equal(new Set(created).size, 5, "five distinct learners");
  });

  test("the refusal is the shipped client's rate-limited error, with a sensible wait", async () => {
    const pg = await fixture();
    await pg.reset();
    const a = await instance({ limit: 1, windowMs: 120_000 });
    await a.learner.POST(post());
    const refused = await a.learner.POST(post());
    const body = await refused.json();

    const error = errorFromResponse(refused.status, body, refused.headers.get("retry-after"));
    assert.equal(error.kind, "rate-limited");
    assert.equal(error.code, "rate-limited");
    assert.ok(error.retryAfterSeconds !== undefined && error.retryAfterSeconds >= 118 && error.retryAfterSeconds <= 120, `waits about two minutes, got ${error.retryAfterSeconds}`);
    assert.equal(body.retryAfterSeconds, error.retryAfterSeconds, "header and body agree");
  });

  test("an existing learner is never refused, on any instance, however full the address's quota is", async () => {
    const pg = await fixture();
    await pg.reset();
    const [a, b] = [await instance({ limit: 1, windowMs: 60_000 }), await instance({ limit: 1, windowMs: 60_000 })];
    const first = await a.learner.POST(post());
    assert.equal((await b.learner.POST(post())).status, 429);

    const resumed = await b.learner.POST(post({ cookie: cookieOf(first) }));
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).learner.created, false);
  });

  test("addresses are limited independently across instances", async () => {
    const pg = await fixture();
    await pg.reset();
    const [a, b] = [await instance({ limit: 1, windowMs: 60_000 }), await instance({ limit: 1, windowMs: 60_000 })];
    assert.equal((await a.learner.POST(post({ ip: "203.0.113.1" }))).status, 201);
    assert.equal((await b.learner.POST(post({ ip: "203.0.113.1" }))).status, 429);
    assert.equal((await b.learner.POST(post({ ip: "203.0.113.2" }))).status, 201);
  });

  test("the window ends on the database's clock, and admission resumes", async () => {
    const pg = await fixture();
    await pg.reset();
    const a = await instance({ limit: 1, windowMs: 700 });
    assert.equal((await a.learner.POST(post())).status, 201);
    assert.equal((await a.learner.POST(post())).status, 429);

    await new Promise((resolve) => setTimeout(resolve, 900));
    assert.equal((await a.learner.POST(post())).status, 201, "a new window has begun");
  });

  test("the limit survives a restart: a new instance on new connections still refuses", async () => {
    const pg = await fixture();
    await pg.reset();
    const before = await instance({ limit: 2, windowMs: 60_000 });
    await before.learner.POST(post());
    await before.learner.POST(post());
    await before.persistence.close();

    const after = await instance({ limit: 2, windowMs: 60_000 });
    assert.equal((await after.learner.POST(post())).status, 429);
  });

  test("the table holds a digest of the address and never the address itself", async () => {
    const pg = await fixture();
    await pg.reset();
    const a = await instance();
    await a.learner.POST(post({ ip: "203.0.113.77" }));

    const rows = (await pg.query("SELECT scope, bucket_key, hits FROM rate_limit_buckets")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scope, LEARNER_CREATION_SCOPE);
    assert.match(rows[0].bucket_key, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(rows).includes("203.0.113.77"));
    assert.equal(rows[0].hits, 1);
  });

  test("a database failure while limiting fails closed, with a plain 500 that reveals nothing", async () => {
    const pg = await fixture();
    await pg.reset();
    const a = await instance();
    await a.persistence.pool.end();

    const response = await a.learner.POST(post());
    const text = await response.text();
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(!text.includes(pg.db.url) && !/postgres|pool|ECONN/i.test(text));
  });

  test("the attempt limit is untouched: refusing creations does not change a learner's attempt window", async () => {
    const pg = await fixture();
    await pg.reset();
    const a = await instance({ limit: 1, windowMs: 60_000 });
    const first = await a.learner.POST(post());
    const cookie = cookieOf(first) as string;
    assert.equal((await a.learner.POST(post())).status, 429);

    const started = await a.services.service.startChallenge(cookie, "challenge-001");
    assert.ok(started.status === "ok");
    assert.deepEqual({ ...started.session.attempts.window }, { used: 0, limit: 3, remaining: 3 }, "a fresh three-attempt window");
  });
});
