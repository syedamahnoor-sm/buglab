/*
 * Learner-creation rate limiting: the policy, the guard, and the learner handler's 429. No database needed:
 * these run on the in-memory limiter. The same behaviour against real PostgreSQL, across independent instances,
 * is in tests/postgres/learner-creation.test.ts.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { errorFromResponse } from "@/lib/learner-session/api";
import { createAppServices } from "@/server/app-services";
import { MemoryRateLimiter } from "@/server/ratelimit/memory-rate-limiter";
import {
  DEFAULT_LEARNER_CREATION_POLICY,
  LEARNER_CREATION_SCOPE,
  LEARNER_CREATION_UNIDENTIFIED_SCOPE,
  createLearnerCreationGuard,
  parseLearnerCreationPolicy,
  parseUnidentifiedClientMode,
} from "@/server/ratelimit/learner-creation";
import type { DistributedRateLimiter } from "@/server/ratelimit/types";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { createLearnerHandlers } from "@/server/session/handlers";
import { MemoryStore } from "@/server/session/memory-store";

const START = Date.parse("2026-11-01T10:00:00Z");
const ORIGIN = "http://localhost:3000";
const POLICY = { limit: 3, windowMs: 60_000 };

function lab(options: { guard?: boolean; hops?: number; limiter?: DistributedRateLimiter; policy?: typeof POLICY } = {}) {
  let now = START;
  const store = new MemoryStore({ now: () => now });
  const limiter = options.limiter ?? new MemoryRateLimiter({ now: () => now });
  const services = createAppServices({ store, now: () => now, trustedProxyHops: options.hops ?? 1, appOrigin: null });
  const guard = createLearnerCreationGuard({ limiter, trustedProxyHops: options.hops ?? 1, policy: options.policy ?? POLICY });
  const handlers = createLearnerHandlers({
    service: services.service,
    appOrigin: null,
    ...(options.guard === false ? {} : { learnerCreation: guard }),
  });
  return {
    handlers,
    store,
    limiter,
    advance(ms: number) {
      now += ms;
    },
  };
}

function post({ ip = "203.0.113.9", cookie, headers = {} }: { ip?: string | null; cookie?: string; headers?: Record<string, string> } = {}) {
  return new Request(`${ORIGIN}/api/learner`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      origin: ORIGIN,
      ...(ip ? { "x-forwarded-for": ip } : {}),
      ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}),
      ...headers,
    },
    body: "{}",
  });
}

async function created(handlers: ReturnType<typeof lab>["handlers"], request: Request) {
  const response = await handlers.POST(request);
  const cookie = /buglab_learner=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  return { response, status: response.status, body: await response.json(), cookie };
}

describe("the learner-creation policy", () => {
  test("is provisional, and says so: 30 per hour, as a placeholder rather than a product decision", () => {
    assert.deepEqual({ ...DEFAULT_LEARNER_CREATION_POLICY }, { limit: 30, windowMs: 3_600_000 });
    assert.equal(Object.isFrozen(DEFAULT_LEARNER_CREATION_POLICY), true);
  });

  test("comes from the environment, and unset values keep the default", () => {
    assert.deepEqual({ ...parseLearnerCreationPolicy({}) }, { ...DEFAULT_LEARNER_CREATION_POLICY });
    assert.deepEqual({ ...parseLearnerCreationPolicy({ BUGLAB_LEARNER_CREATION_LIMIT: "5" }) }, { limit: 5, windowMs: 3_600_000 });
    assert.deepEqual({ ...parseLearnerCreationPolicy({ BUGLAB_LEARNER_CREATION_WINDOW_SECONDS: "90" }) }, { limit: 30, windowMs: 90_000 });
    assert.deepEqual(
      { ...parseLearnerCreationPolicy({ BUGLAB_LEARNER_CREATION_LIMIT: " 7 ", BUGLAB_LEARNER_CREATION_WINDOW_SECONDS: "600" }) },
      { limit: 7, windowMs: 600_000 },
    );
    assert.deepEqual({ ...parseLearnerCreationPolicy({ BUGLAB_LEARNER_CREATION_LIMIT: "", BUGLAB_LEARNER_CREATION_WINDOW_SECONDS: "  " }) }, { ...DEFAULT_LEARNER_CREATION_POLICY });
  });

  test("a malformed value throws instead of silently falling back, and names the variable but never guesses", () => {
    const bad = ["0", "-1", "1.5", "abc", "1e3", "0x10", "100001", "9007199254740993", "١٢"];
    for (const value of bad) {
      assert.throws(() => parseLearnerCreationPolicy({ BUGLAB_LEARNER_CREATION_LIMIT: value }), /BUGLAB_LEARNER_CREATION_LIMIT/, value);
    }
    for (const value of ["0", "-5", "2.5", "x", "604801"]) {
      assert.throws(() => parseLearnerCreationPolicy({ BUGLAB_LEARNER_CREATION_WINDOW_SECONDS: value }), /BUGLAB_LEARNER_CREATION_WINDOW_SECONDS/, value);
    }
  });
});

describe("the unidentified-client setting", () => {
  test("defaults to a shared limit, accepts `allow` explicitly, and refuses anything else", () => {
    assert.equal(parseUnidentifiedClientMode({}), "shared-limit");
    assert.equal(parseUnidentifiedClientMode({ BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: "" }), "shared-limit");
    assert.equal(parseUnidentifiedClientMode({ BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: " Allow " }), "allow");
    assert.equal(parseUnidentifiedClientMode({ BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: "shared-limit" }), "shared-limit");
    for (const bad of ["off", "none", "false", "0", "disabled", "block", "yes"]) {
      assert.throws(() => parseUnidentifiedClientMode({ BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: bad }), /BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS/, bad);
    }
  });
});

describe("the creation guard", () => {
  function spyLimiter() {
    const calls: { scope: string; key: string; policy: unknown }[] = [];
    const limiter: DistributedRateLimiter = {
      async consume(scope, key, policy) {
        calls.push({ scope, key, policy });
        return { allowed: true, used: 1, limit: policy.limit, resetsAt: 0, retryAfterSeconds: 0 };
      },
      async purgeExpired() {
        return 0;
      },
    };
    return { limiter, calls };
  }
  const request = (headers: Record<string, string>) => new Request(`${ORIGIN}/api/learner`, { method: "POST", headers });

  test("without a trusted client address it never keys on one the client controls: the request counts against ONE shared bucket", async () => {
    const { limiter, calls } = spyLimiter();
    for (const hops of [0, 1]) {
      const guard = createLearnerCreationGuard({ limiter, trustedProxyHops: hops });
      await guard(request(hops === 0 ? { "x-forwarded-for": "203.0.113.9" } : {}));
    }
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.scope === LEARNER_CREATION_UNIDENTIFIED_SCOPE && call.key === "unidentified"), "the same shared key, whatever the header said");
    assert.ok(!JSON.stringify(calls).includes("203.0.113"), "the client's claimed address is not used for anything");
  });

  test("keys on a digest of the address, never the address", async () => {
    const { limiter, calls } = spyLimiter();
    await createLearnerCreationGuard({ limiter, trustedProxyHops: 1 })(request({ "x-forwarded-for": "203.0.113.9" }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].scope, LEARNER_CREATION_SCOPE);
    assert.match(calls[0].key, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(calls).includes("203.0.113"), "the raw address is nowhere in what the limiter receives");
    assert.deepEqual(calls[0].policy, DEFAULT_LEARNER_CREATION_POLICY, "the default policy applies when none is given");
  });

  test("the same address always gives the same key, a different one a different key, and IPv6 case is folded", async () => {
    const { limiter, calls } = spyLimiter();
    const guard = createLearnerCreationGuard({ limiter, trustedProxyHops: 1 });
    for (const ip of ["203.0.113.9", "203.0.113.9", "203.0.113.10", "2001:DB8::1", "2001:db8::1"]) {
      await guard(request({ "x-forwarded-for": ip }));
    }
    const [a, a2, b, v6upper, v6lower] = calls.map((call) => call.key);
    assert.equal(a, a2);
    assert.notEqual(a, b);
    assert.equal(v6upper, v6lower);
  });

  test("a client cannot choose its own key by sending a forged X-Forwarded-For entry", async () => {
    const { limiter, calls } = spyLimiter();
    const guard = createLearnerCreationGuard({ limiter, trustedProxyHops: 1 });
    // One trusted proxy appended the real address on the right; everything left of it is the client's claim.
    await guard(request({ "x-forwarded-for": "198.51.100.1, 203.0.113.9" }));
    await guard(request({ "x-forwarded-for": "10.0.0.1, 203.0.113.9" }));
    assert.equal(calls[0].key, calls[1].key);
  });

  test("the unidentified bucket is separate from every address's bucket, and an unidentified request never spends an identified client's allowance", async () => {
    const { limiter, calls } = spyLimiter();
    const guard = createLearnerCreationGuard({ limiter, trustedProxyHops: 1 });
    await guard(new Request(`${ORIGIN}/x`, { headers: { "x-forwarded-for": "203.0.113.9" } }));
    await guard(new Request(`${ORIGIN}/x`));
    assert.deepEqual(calls.map((call) => call.scope), [LEARNER_CREATION_SCOPE, LEARNER_CREATION_UNIDENTIFIED_SCOPE]);
  });

  test("onUnidentified is told each time, so a deployment can notice a missing proxy configuration; nothing is logged by default", async () => {
    const { limiter } = spyLimiter();
    let told = 0;
    const guard = createLearnerCreationGuard({ limiter, trustedProxyHops: 1, onUnidentified: () => { told += 1; } });
    await guard(new Request(`${ORIGIN}/x`));
    await guard(new Request(`${ORIGIN}/x`, { headers: { "x-forwarded-for": "203.0.113.9" } }));
    await guard(new Request(`${ORIGIN}/x`, { headers: { "x-forwarded-for": "not an address" } }));
    assert.equal(told, 2);
  });
});

describe("POST learner with a creation guard", () => {
  test("admits up to the limit from one address, then answers 429 with Retry-After and creates nothing", async () => {
    const { handlers, store } = lab();
    const outcomes = [];
    for (let i = 0; i < 5; i += 1) outcomes.push(await created(handlers, post()));

    assert.deepEqual(outcomes.map((o) => o.status), [201, 201, 201, 429, 429]);
    assert.ok(outcomes.slice(0, 3).every((o) => o.cookie), "each admitted request got its own learner cookie");
    assert.equal(new Set(outcomes.slice(0, 3).map((o) => o.cookie)).size, 3);
    const refused = outcomes[3];
    assert.equal(refused.response.headers.get("set-cookie"), null, "a refusal never sets a cookie");
    assert.equal(refused.response.headers.get("retry-after"), "60");
    assert.equal(refused.response.headers.get("cache-control"), "no-store");
    // Nothing was created for the refused requests: only the three admitted learners exist.
    const learners = (store as unknown as { learners: Map<string, unknown> }).learners;
    assert.equal(learners.size, 3);
  });

  test("the 429 is the existing error envelope, and the shipped client reads it as rate-limited with the wait", async () => {
    const { handlers } = lab({ policy: { limit: 1, windowMs: 90_000 } });
    await created(handlers, post());
    const refused = await created(handlers, post());

    assert.deepEqual(refused.body, {
      status: "error",
      code: "rate-limited",
      message: "Too many new sessions were started from your network. Please wait and try again.",
      retryAfterSeconds: 90,
    });
    const error = errorFromResponse(refused.status, refused.body, refused.response.headers.get("retry-after"));
    assert.deepEqual({ kind: error.kind, status: error.status, code: error.code, retryAfterSeconds: error.retryAfterSeconds }, {
      kind: "rate-limited",
      status: 429,
      code: "rate-limited",
      retryAfterSeconds: 90,
    });
    assert.equal(error.message, refused.body.message, "the client shows the server's message");
  });

  test("Retry-After counts down and the window really ends", async () => {
    const { handlers, advance } = lab({ policy: { limit: 1, windowMs: 60_000 } });
    await created(handlers, post());
    advance(20_000);
    assert.equal((await created(handlers, post())).response.headers.get("retry-after"), "40");

    advance(40_000);
    assert.equal((await created(handlers, post())).status, 201, "a new window has begun");
  });

  test("resuming a learner who already has a cookie is never limited and never counted", async () => {
    const { handlers } = lab({ policy: { limit: 1, windowMs: 60_000 } });
    const first = await created(handlers, post());
    assert.equal(first.status, 201);
    assert.equal((await created(handlers, post())).status, 429, "the address is now at its limit");

    for (let i = 0; i < 5; i += 1) {
      const resumed = await created(handlers, post({ cookie: first.cookie }));
      assert.equal(resumed.status, 200, "an existing learner is never refused");
      assert.equal(resumed.body.learner.created, false);
    }
    // That resuming spends no quota is shown directly by "asks the limiter once per creation and never when resuming".
  });

  test("an unknown or malformed cookie is treated as a creation and counted", async () => {
    const { handlers } = lab({ policy: { limit: 1, windowMs: 60_000 } });
    assert.equal((await created(handlers, post({ cookie: "not-a-token" }))).status, 201);
    assert.equal((await created(handlers, post({ cookie: "also-not-a-token" }))).status, 429);
  });

  test("addresses are limited independently", async () => {
    const { handlers } = lab({ policy: { limit: 1, windowMs: 60_000 } });
    assert.equal((await created(handlers, post({ ip: "203.0.113.1" }))).status, 201);
    assert.equal((await created(handlers, post({ ip: "203.0.113.1" }))).status, 429);
    assert.equal((await created(handlers, post({ ip: "203.0.113.2" }))).status, 201);
  });

  test("with no trusted proxy configured creation is STILL bounded: everyone shares one allowance, so a misconfiguration is loud, not silent", async () => {
    const { handlers } = lab({ hops: 0, policy: { limit: 2, windowMs: 60_000 } });
    const statuses: number[] = [];
    // Different claimed addresses make no difference: none of them is trusted.
    for (const ip of ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"]) statuses.push((await created(handlers, post({ ip }))).status);
    assert.deepEqual(statuses, [201, 201, 429, 429]);
    const refused = await created(handlers, post());
    assert.equal(refused.response.headers.get("retry-after"), "60", "and a refused request is told when to retry");
  });

  test("an explicit opt-out (`allow`) lifts the limit for unidentified clients only, and an identified client is still limited", async () => {
    const limiter = new MemoryRateLimiter({ now: () => START });
    const guard = createLearnerCreationGuard({ limiter, trustedProxyHops: 1, policy: { limit: 1, windowMs: 60_000 }, unidentified: "allow" });
    const noAddress = new Request(`${ORIGIN}/api/learner`, { method: "POST" });
    const withAddress = () => new Request(`${ORIGIN}/api/learner`, { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } });
    for (let i = 0; i < 5; i += 1) assert.deepEqual(await guard(noAddress), { allowed: true });
    assert.equal((await guard(withAddress())).allowed, true);
    assert.equal((await guard(withAddress())).allowed, false, "identified clients keep their limit");
  });

  test("without a guard the handler behaves exactly as before: creation is unlimited", async () => {
    const { handlers } = lab({ guard: false, policy: { limit: 1, windowMs: 60_000 } });
    for (let i = 0; i < 6; i += 1) assert.equal((await created(handlers, post())).status, 201);
  });

  test("the origin check comes first: a cross-site request is refused before it can use any quota", async () => {
    const { handlers } = lab({ policy: { limit: 1, windowMs: 60_000 } });
    for (let i = 0; i < 3; i += 1) {
      const forged = await created(handlers, post({ headers: { origin: "https://evil.example" } }));
      assert.equal(forged.status, 403);
    }
    assert.equal((await created(handlers, post())).status, 201, "the forged requests used none of the allowance");
  });

  test("asks the limiter once per creation and never when resuming", async () => {
    const calls: string[] = [];
    const inner = new MemoryRateLimiter();
    const limiter: DistributedRateLimiter = {
      consume(scope, key, policy) {
        calls.push(key);
        return inner.consume(scope, key, policy);
      },
      purgeExpired: () => inner.purgeExpired(),
    };
    const { handlers } = lab({ limiter, policy: { limit: 10, windowMs: 60_000 } });
    const first = await created(handlers, post());
    await created(handlers, post({ cookie: first.cookie }));
    await created(handlers, post({ cookie: first.cookie }));
    assert.equal(calls.length, 1);
  });

  test("if the limiter fails the request fails closed: 500, no cookie, nothing created", async () => {
    const limiter: DistributedRateLimiter = {
      consume: async () => {
        throw new Error("the database is down: postgres://user:secret@host/db");
      },
      purgeExpired: async () => 0,
    };
    const { handlers, store } = lab({ limiter });
    const failed = await created(handlers, post());

    assert.equal(failed.status, 500);
    assert.equal(failed.response.headers.get("set-cookie"), null);
    assert.deepEqual(failed.body, { status: "error", code: "internal", message: "Something went wrong. Please try again." });
    assert.equal(JSON.stringify(failed.body).includes("secret"), false, "no detail of the failure reaches the client");
    assert.equal((store as unknown as { learners: Map<string, unknown> }).learners.size, 0);
  });

  test("the creation limit is a different thing from the attempt limit: its 429 carries no attempt window", async () => {
    const { handlers } = lab({ policy: { limit: 1, windowMs: 60_000 } });
    await created(handlers, post());
    const refused = await created(handlers, post());
    assert.equal("attempts" in refused.body, false);
    assert.notEqual(refused.body.status, "rate-limited", "the diagnosis contract's `status: rate-limited` is not reused");
  });
});
