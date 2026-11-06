/*
 * The learner-creation limit across independent application instances on a real PostgreSQL, for the trusted-proxy and
 * unidentified-client cases, and the limit's defaults and configuration end to end. (The basic cross-instance behaviour is in
 * learner-creation.test.ts; the pure address and header logic is in tests/ratelimit/client-address.test.ts.)
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createAppServices } from "@/server/app-services";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";
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

interface InstanceOptions {
  hops?: number;
  unidentified?: "shared-limit" | "allow";
}

/** One application instance: a complete composition on its own connections. */
async function instance(policy: { limit: number; windowMs: number }, options: InstanceOptions = {}) {
  const pg = await fixture();
  const persistence = createPostgresPersistence({ config: { connectionString: pg.db.url, poolMax: 8 } });
  open.push(persistence);
  const hops = options.hops ?? 1;
  const services = createAppServices({ store: persistence.store, trustedProxyHops: hops, appOrigin: null });
  const learner = createLearnerHandlers({
    service: services.service,
    appOrigin: null,
    learnerCreation: persistence.learnerCreationGuard({ trustedProxyHops: hops, policy, unidentified: options.unidentified }),
  });
  return { persistence, learner };
}

/** A learner-creation POST. `ip: null` sends no X-Forwarded-For at all; `xff` sends that exact header. */
function post({ ip = "203.0.113.9", xff, cookie }: { ip?: string | null; xff?: string; cookie?: string } = {}) {
  const forwarded = xff ?? (ip === null ? undefined : ip);
  return new Request(`${ORIGIN}/api/learner`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      origin: ORIGIN,
      ...(forwarded === undefined ? {} : { "x-forwarded-for": forwarded }),
      ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}),
    },
    body: "{}",
  });
}

const learnerCount = async (pg: Awaited<ReturnType<typeof fixture>>) => (await pg.query("SELECT count(*)::int AS n FROM learners")).rows[0].n as number;
const POLICY_ONE = { limit: 1, windowMs: 60_000 };

describe("trusted-proxy and unidentified-client cases across instances (real PostgreSQL)", { skip: SKIP }, () => {
  test("requests whose client cannot be established share ONE allowance across instances: exactly the limit in total, even simultaneously", async () => {
    const pg = await fixture();
    await pg.reset();
    const [a, b] = [await instance({ limit: 3, windowMs: 60_000 }), await instance({ limit: 3, windowMs: 60_000 })];

    const responses = fulfilled(
      await stampede(a.persistence.pool, "LOCK TABLE rate_limit_buckets IN SHARE ROW EXCLUSIVE MODE", [], () =>
        Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? a : b).learner.POST(post({ ip: null }))),
      ),
    );

    assert.equal(responses.filter((r) => r.status === 201).length, 3);
    assert.equal(responses.filter((r) => r.status === 429).length, 17);
    assert.equal(await learnerCount(pg), 3);
    for (const refused of responses.filter((r) => r.status === 429)) assert.match(refused.headers.get("retry-after") ?? "", /^\d+$/);
    assert.deepEqual((await pg.query("SELECT scope FROM rate_limit_buckets")).rows.map((r) => r.scope), ["learner-creation:unidentified"]);
  });

  test("with no trusted proxy configured (hops 0) every request is unidentified, whatever address it claims", async () => {
    const pg = await fixture();
    await pg.reset();
    const policy = { limit: 2, windowMs: 60_000 };
    const [a, b] = [await instance(policy, { hops: 0 }), await instance(policy, { hops: 0 })];
    const statuses: number[] = [];
    for (const [who, ip] of [[a, "203.0.113.1"], [b, "203.0.113.2"], [a, "203.0.113.3"], [b, "203.0.113.4"]] as const) {
      statuses.push((await who.learner.POST(post({ ip }))).status);
    }
    assert.deepEqual(statuses, [201, 201, 429, 429], "forged and varied addresses buy nothing");
  });

  test("an identified client never spends the unidentified allowance, nor the reverse", async () => {
    const pg = await fixture();
    await pg.reset();
    const [a, b] = [await instance(POLICY_ONE), await instance(POLICY_ONE)];
    assert.equal((await a.learner.POST(post({ ip: null }))).status, 201);
    assert.equal((await b.learner.POST(post({ ip: null }))).status, 429, "the shared allowance is spent");
    assert.equal((await b.learner.POST(post({ ip: "203.0.113.9" }))).status, 201, "an identified client has its own");
  });

  test("addresses in one IPv6 /64 share an allowance across instances, and an IPv4-mapped spelling shares the IPv4 address's", async () => {
    const pg = await fixture();
    await pg.reset();
    const [a, b] = [await instance(POLICY_ONE), await instance(POLICY_ONE)];
    assert.equal((await a.learner.POST(post({ ip: "2001:db8:1:2::a" }))).status, 201);
    assert.equal((await b.learner.POST(post({ ip: "2001:db8:1:2:dead:beef:0:1" }))).status, 429, "same /64, however the low bits are chosen");
    assert.equal((await b.learner.POST(post({ ip: "2001:db8:1:3::a" }))).status, 201, "another /64 is another client");

    assert.equal((await a.learner.POST(post({ ip: "203.0.113.77" }))).status, 201);
    assert.equal((await b.learner.POST(post({ ip: "::ffff:203.0.113.77" }))).status, 429);
  });

  test("a forged leftmost X-Forwarded-For entry cannot buy a fresh allowance across instances", async () => {
    const pg = await fixture();
    await pg.reset();
    const [a, b] = [await instance(POLICY_ONE), await instance(POLICY_ONE)];
    assert.equal((await a.learner.POST(post({ xff: "203.0.113.9" }))).status, 201);
    for (const forged of ["198.51.100.1, 203.0.113.9", "10.1.1.1, 10.2.2.2, 203.0.113.9", "evil, 203.0.113.9"]) {
      assert.equal((await b.learner.POST(post({ xff: forged }))).status, 429, forged);
    }
  });

  test("a malformed address in the trusted position falls back to the shared bucket instead of being believed", async () => {
    const pg = await fixture();
    await pg.reset();
    const [a, b] = [await instance(POLICY_ONE), await instance(POLICY_ONE)];
    assert.equal((await a.learner.POST(post({ xff: "203.0.113.50, 1:2" }))).status, 201);
    assert.equal((await b.learner.POST(post({ xff: "203.0.113.51, ...." }))).status, 429, "different garbage, same shared bucket");
  });

  test("`allow` is an explicit opt-out for unidentified clients only: they are unlimited, identified clients keep their limit", async () => {
    const pg = await fixture();
    await pg.reset();
    const a = await instance(POLICY_ONE, { unidentified: "allow" });
    for (let i = 0; i < 4; i += 1) assert.equal((await a.learner.POST(post({ ip: null }))).status, 201);
    assert.equal((await a.learner.POST(post({ ip: "203.0.113.9" }))).status, 201);
    assert.equal((await a.learner.POST(post({ ip: "203.0.113.9" }))).status, 429);
    const counted = await pg.query("SELECT count(*)::int AS n FROM rate_limit_buckets WHERE scope = 'learner-creation:unidentified'");
    assert.equal(counted.rows[0].n, 0, "nothing was counted for the unidentified");
  });

  test("resuming a learner is never limited, even on the shared bucket", async () => {
    const pg = await fixture();
    await pg.reset();
    const a = await instance(POLICY_ONE);
    const first = await a.learner.POST(post({ ip: null }));
    assert.equal(first.status, 201);
    const cookie = /buglab_learner=([^;]+)/.exec(first.headers.get("set-cookie") ?? "")?.[1];
    assert.equal((await a.learner.POST(post({ ip: null }))).status, 429);
    assert.equal((await a.learner.POST(post({ ip: null, cookie }))).status, 200);
  });
});

describe("the limit's defaults and configuration, end to end (real PostgreSQL)", { skip: SKIP }, () => {
  /** Runs `run` with some environment variables set, and puts every one of them back exactly as it was. */
  async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> {
    const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
    const apply = (entries: Record<string, string | undefined>) => {
      for (const [name, value] of Object.entries(entries)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    };
    apply(values);
    try {
      return await run();
    } finally {
      apply(saved);
    }
  }
  const request = () => new Request(`${ORIGIN}/api/learner`, { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } });
  const unset = {
    BUGLAB_LEARNER_CREATION_LIMIT: undefined,
    BUGLAB_LEARNER_CREATION_WINDOW_SECONDS: undefined,
    BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: undefined,
  };

  async function persistence() {
    const pg = await fixture();
    await pg.reset();
    const created = createPostgresPersistence({ config: { connectionString: pg.db.url, poolMax: 3 } });
    open.push(created);
    return created;
  }

  test("with nothing configured the approved default applies: 30 per client per hour, and the 31st is refused for about an hour", async () => {
    const p = await persistence();
    await withEnv(unset, async () => {
      const guard = p.learnerCreationGuard({ trustedProxyHops: 1 });
      const results = [];
      for (let i = 0; i < 31; i += 1) results.push(await guard(request()));
      assert.equal(results.filter((r) => r.allowed).length, 30);
      const refused = results[30];
      assert.ok(!refused.allowed && refused.retryAfterSeconds > 3_590 && refused.retryAfterSeconds <= 3_600, "about an hour");
    });
  });

  test("BUGLAB_LEARNER_CREATION_LIMIT and BUGLAB_LEARNER_CREATION_WINDOW_SECONDS change it, read when the guard is built", async () => {
    const p = await persistence();
    await withEnv({ ...unset, BUGLAB_LEARNER_CREATION_LIMIT: "2", BUGLAB_LEARNER_CREATION_WINDOW_SECONDS: "90" }, async () => {
      const guard = p.learnerCreationGuard({ trustedProxyHops: 1 });
      const results = [await guard(request()), await guard(request()), await guard(request())];
      assert.deepEqual(results.map((r) => r.allowed), [true, true, false]);
      const refused = results[2];
      assert.ok(!refused.allowed && refused.retryAfterSeconds > 80 && refused.retryAfterSeconds <= 90);
    });
  });

  test("BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS=allow is honoured, and a malformed setting fails when the guard is BUILT, not on a request", async () => {
    const p = await persistence();
    await withEnv({ ...unset, BUGLAB_LEARNER_CREATION_LIMIT: "1", BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: "allow" }, async () => {
      const guard = p.learnerCreationGuard({ trustedProxyHops: 1 });
      for (let i = 0; i < 3; i += 1) assert.deepEqual(await guard(new Request(`${ORIGIN}/x`)), { allowed: true });
    });
    await withEnv({ ...unset, BUGLAB_LEARNER_CREATION_LIMIT: "many" }, () => {
      assert.throws(() => p.learnerCreationGuard({ trustedProxyHops: 1 }), /BUGLAB_LEARNER_CREATION_LIMIT/);
    });
    await withEnv({ ...unset, BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: "off" }, () => {
      assert.throws(() => p.learnerCreationGuard({ trustedProxyHops: 1 }), /BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS/);
    });
  });
});
