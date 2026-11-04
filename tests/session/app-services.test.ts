/*
 * The server composition root. The point of these tests is the wiring: that what is injected is what is
 * used, that the defaults are the ones the documentation promises, that the version policy is really
 * connected to the challenge registry, and that the process-local instance behaves.
 *
 * The very first test must run before anything calls getAppServices(): it checks that importing the
 * module builds nothing. Each test file runs in its own process, so no other file can interfere.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import type { ChallengeRegistry } from "@/server/challenges/registry";
import {
  SHARED_STATE_KEY,
  createAppServices,
  getAppServices,
  getSharedState,
  type AppServices,
} from "@/server/app-services";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { DEFAULT_EXPIRY_POLICY } from "@/server/session/expiry";
import { MemoryStore } from "@/server/session/memory-store";
import { CHALLENGE_ID, CORRECT_ID, RESOLUTION, WRONG_IDS, submission } from "../diagnosis/fixtures";

const START = Date.parse("2026-11-01T10:00:00Z");
const ORIGIN = "http://localhost:3000";
const MINUTE = 60_000;
const key = (n: number) => `0a0b0c0d-0000-4000-8000-${String(n).padStart(12, "0")}`;

const sharedStateWasEmptyOnImport = !(SHARED_STATE_KEY in globalThis);

function clock(start = START) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

interface Post {
  cookie?: string;
  key?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function postDiagnosis(services: AppServices, { cookie, key: idempotencyKey, body, headers = {} }: Post = {}) {
  const request = new Request(`${ORIGIN}/api/challenges/${CHALLENGE_ID}/diagnosis`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      origin: ORIGIN,
      ...(cookie ? { cookie: `${LEARNER_COOKIE}=${cookie}` } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...headers,
    },
    body: JSON.stringify(body ?? submission()),
  });
  const response = await services.diagnosis(request, { params: Promise.resolve({ challengeId: CHALLENGE_ID }) });
  const text = await response.text();
  return { status: response.status, response, text, json: JSON.parse(text) };
}

async function readyLearner(services: AppServices) {
  const { cookie } = await services.service.startLearner(null);
  const started = await services.service.startChallenge(cookie.value, CHALLENGE_ID);
  assert.equal(started.status, "ok");
  return cookie.value;
}

const wrong = (index: number) => ({ body: submission({ rootCauseId: WRONG_IDS[index] }) });
const right = () => ({ body: submission({ rootCauseId: CORRECT_ID }) });

/** Runs `run` with BUGLAB_TRUSTED_PROXY_HOPS set (or removed), and puts the environment back. */
async function withProxyHops<T>(value: string | undefined, run: () => Promise<T> | T): Promise<T> {
  const before = process.env.BUGLAB_TRUSTED_PROXY_HOPS;
  if (value === undefined) delete process.env.BUGLAB_TRUSTED_PROXY_HOPS;
  else process.env.BUGLAB_TRUSTED_PROXY_HOPS = value;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.BUGLAB_TRUSTED_PROXY_HOPS;
    else process.env.BUGLAB_TRUSTED_PROXY_HOPS = before;
  }
}

describe("importing the composition module", () => {
  test("builds nothing: no store, no registry, no shared state, until something asks", () => {
    assert.equal(sharedStateWasEmptyOnImport, true);
    assert.equal(SHARED_STATE_KEY in globalThis, false);
  });
});

describe("createAppServices: defaults", () => {
  test("builds the default challenge registry, an in-memory store, the service, a limiter and the handler", async () => {
    const services = await withProxyHops(undefined, () => createAppServices());

    assert.deepEqual(Object.keys(services).sort(), ["challengeVersion", "challenges", "diagnosis", "ipSubmissions", "service", "store", "trustedProxyHops"]);
    assert.ok(services.store instanceof MemoryStore);
    assert.deepEqual(services.challenges.list().map((challenge) => challenge.id), [CHALLENGE_ID]);
    assert.equal(typeof services.diagnosis, "function");
    assert.equal(services.trustedProxyHops, 0);
  });

  test("the default registry is Challenge 001 and its version is the registry's: <revision>+<12 hex of the public content>", () => {
    const services = createAppServices();

    assert.match(services.challengeVersion(CHALLENGE_ID), /^\d+\+[0-9a-f]{12}$/);
    assert.equal(services.challengeVersion(CHALLENGE_ID), services.challenges.contentVersion(CHALLENGE_ID));
    assert.equal(services.service !== undefined && services.challenges.getDiagnosis(CHALLENGE_ID)?.challengeId, CHALLENGE_ID);
  });

  test("the version function fails closed for a challenge the registry does not have", () => {
    const services = createAppServices();

    assert.throws(() => services.challengeVersion("challenge-999"), /no content version/);
    assert.throws(() => services.challengeVersion(""), /no content version/);
    assert.throws(() => services.challengeVersion("constructor"), /no content version/);
  });

  test("trusted proxy hops come from BUGLAB_TRUSTED_PROXY_HOPS, read when the services are built, and only sane values count", async () => {
    for (const [value, expected] of [
      [undefined, 0],
      ["", 0],
      ["0", 0],
      ["1", 1],
      ["2", 2],
      ["10", 10],
      ["11", 0],
      ["-1", 0],
      ["1.5", 0],
      ["abc", 0],
    ] as const) {
      assert.equal(await withProxyHops(value, () => createAppServices().trustedProxyHops), expected, String(value));
    }
  });

  test("the result is frozen: nothing can be swapped out after the services are built", () => {
    const services = createAppServices();

    assert.equal(Object.isFrozen(services), true);
    assert.throws(() => {
      (services as { service: unknown }).service = null;
    }, TypeError);
  });

  test("two builds share nothing: each has its own store, so a learner of one is unknown to the other", async () => {
    const first = createAppServices();
    const second = createAppServices();

    assert.notEqual(first.store, second.store);
    const cookie = await readyLearner(first);
    const sameCookieElsewhere = await postDiagnosis(second, { cookie });

    assert.equal(sameCookieElsewhere.status, 401);
    assert.equal(sameCookieElsewhere.json.code, "learner-missing");
    assert.equal((await postDiagnosis(first, { cookie })).status, 200);
  });
});

describe("createAppServices: injection", () => {
  test("an injected registry, store, limiter and proxy setting are the ones used", () => {
    const challenges = createDefaultChallengeRegistry();
    const store = new MemoryStore();
    const ipSubmissions = { status: () => { throw new Error("unused"); }, increment: () => { throw new Error("unused"); } };

    const services = createAppServices({ challenges, store, ipSubmissions, trustedProxyHops: 3 });

    assert.equal(services.challenges, challenges);
    assert.equal(services.store, store);
    assert.equal(services.ipSubmissions, ipSubmissions);
    assert.equal(services.trustedProxyHops, 3);
  });

  test("an injected proxy setting beats the environment", async () => {
    assert.equal(await withProxyHops("4", () => createAppServices({ trustedProxyHops: 0 }).trustedProxyHops), 0);
    assert.equal(await withProxyHops(undefined, () => createAppServices({ trustedProxyHops: 2 }).trustedProxyHops), 2);
  });

  test("a submission goes through the injected store, and nowhere else", async () => {
    const calls: string[] = [];
    const inner = new MemoryStore();
    const store = new Proxy(inner, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.push(String(property));
          return value.apply(target, args);
        };
      },
    });
    const services = createAppServices({ store });
    const cookie = await readyLearner(services);
    calls.length = 0;

    const { status } = await postDiagnosis(services, { cookie, ...wrong(0) });

    assert.equal(status, 200);
    for (const method of ["touch", "find", "record"]) assert.ok(calls.includes(method), `${method} was not called on the injected store`);
  });

  test("the injected clock drives the default store, the service's cookie lifetimes and the default IP limiter", async () => {
    const time = clock();
    const services = createAppServices({ now: time.now, trustedProxyHops: 1 });
    const cookie = await readyLearner(services);

    const fresh = await postDiagnosis(services, { cookie });
    assert.equal(fresh.status, 200);
    assert.match(fresh.response.headers.getSetCookie()[0], new RegExp(`Max-Age=${Math.floor(DEFAULT_EXPIRY_POLICY.idleTtlMs / 1000)};`));

    time.advance(DEFAULT_EXPIRY_POLICY.idleTtlMs + 1);
    const expired = await postDiagnosis(services, { cookie });
    assert.equal(expired.status, 401);
    assert.equal(expired.json.code, "learner-expired");
  });

  test("an injected attempt window replaces the default one", async () => {
    const services = createAppServices({ attemptWindow: { limit: 1, windowMs: MINUTE } });
    const cookie = await readyLearner(services);

    assert.equal((await postDiagnosis(services, { cookie, ...wrong(0) })).status, 200);
    const blocked = await postDiagnosis(services, { cookie, ...wrong(1) });

    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.attempts.limit, 1);
    assert.equal(blocked.response.headers.get("retry-after"), "60");
  });

  test("an injected submission id source is used for requests without an Idempotency-Key", async () => {
    let next = 0;
    const services = createAppServices({ newSubmissionId: () => key(++next) });
    const cookie = await readyLearner(services);

    await postDiagnosis(services, { cookie, ...wrong(0) });
    const sameAsGenerated = await postDiagnosis(services, { cookie, key: key(1), ...wrong(0) });

    assert.equal(sameAsGenerated.status, 200);
    const stored = await services.service.getChallengeSession(cookie, CHALLENGE_ID);
    assert.ok(stored.status === "ok" && stored.session);
    assert.equal(stored.session.attempts.total, 1, "key 1 was the id the first request was recorded under, so the second was a replay");
  });
});

describe("createAppServices: the challenge version is connected to the session policy", () => {
  /** The real default registry, with a version that can be changed to simulate a deploy. */
  function versioned() {
    const real = createDefaultChallengeRegistry();
    let version = "7+first";
    const challenges: ChallengeRegistry = { ...real, contentVersion: (id) => (real.contentVersion(id) === undefined ? undefined : version) };
    return {
      challenges,
      deploy(next: string) {
        version = next;
      },
    };
  }

  test("a session records the registry's version when it starts", async () => {
    const { challenges } = versioned();
    const services = createAppServices({ challenges });
    const { cookie } = await services.service.startLearner(null);

    const started = await services.service.startChallenge(cookie.value, CHALLENGE_ID);

    assert.ok(started.status === "ok");
    assert.equal(started.session.contentVersion, "7+first");
  });

  test("the version is asked for on every request, not captured once: a change makes the submission a 409 and records nothing", async () => {
    const { challenges, deploy } = versioned();
    const services = createAppServices({ challenges });
    const cookie = await readyLearner(services);
    assert.equal((await postDiagnosis(services, { cookie, ...wrong(0) })).status, 200);

    deploy("7+second");
    const outdated = await postDiagnosis(services, { cookie, ...right() });

    assert.equal(outdated.status, 409);
    assert.equal(outdated.json.code, "session-outdated");
    assert.equal(outdated.text.includes(RESOLUTION), false);
    const read = await services.service.getChallengeSession(cookie, CHALLENGE_ID);
    assert.ok(read.status === "ok" && read.session);
    assert.deepEqual([read.session.restartRequired, read.session.attempts.total], [true, 1]);
  });

  test("starting the challenge again moves the learner to the new version, and a completed result is never restarted", async () => {
    const { challenges, deploy } = versioned();
    const services = createAppServices({ challenges });
    const unfinished = await readyLearner(services);
    const finished = await readyLearner(services);
    assert.equal((await postDiagnosis(services, { cookie: finished, ...right() })).json.status, "correct");

    deploy("7+second");
    const restarted = await services.service.startChallenge(unfinished, CHALLENGE_ID);
    const kept = await services.service.startChallenge(finished, CHALLENGE_ID);

    assert.ok(restarted.status === "ok" && restarted.restarted);
    assert.equal((await postDiagnosis(services, { cookie: unfinished, ...right() })).json.status, "correct");
    assert.ok(kept.status === "ok" && !kept.restarted);
    assert.equal(kept.session.contentVersion, "7+first");
    assert.equal(kept.session.status, "completed");
  });
});

describe("createAppServices: the default IP limiter", () => {
  test("is 10 judged submissions per ten minutes per address and challenge, and applies only with trusted proxies", async () => {
    const time = clock();
    const behindProxy = createAppServices({ now: time.now, trustedProxyHops: 1 });
    const direct = createAppServices({ now: time.now, trustedProxyHops: 0 });
    const ip = { "x-forwarded-for": "203.0.113.9, 198.51.100.7" };

    const proxied: number[] = [];
    const unproxied: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      proxied.push((await postDiagnosis(behindProxy, { cookie: await readyLearner(behindProxy), headers: ip })).status);
      unproxied.push((await postDiagnosis(direct, { cookie: await readyLearner(direct), headers: ip })).status);
    }

    assert.deepEqual(proxied, [...Array(10).fill(200), 429]);
    assert.deepEqual(unproxied, Array(11).fill(200));

    time.advance(10 * MINUTE);
    assert.equal((await postDiagnosis(behindProxy, { cookie: await readyLearner(behindProxy), headers: ip })).status, 200);
  });
});

describe("createAppServices: the whole flow through the composed handler", () => {
  test("wrong answers are counted and blocked, a correct one completes, and a refresh sees the completion", async () => {
    const time = clock();
    const services = createAppServices({ now: time.now });
    const cookie = await readyLearner(services);

    const statuses: Array<[number, string]> = [];
    for (const [index, id] of [0, 1, 2].entries()) {
      const answer = await postDiagnosis(services, { cookie, key: key(index + 1), ...wrong(id) });
      statuses.push([answer.status, answer.json.status]);
    }
    const blocked = await postDiagnosis(services, { cookie, key: key(4), ...right() });
    statuses.push([blocked.status, blocked.json.status]);
    time.advance(10 * MINUTE);
    const correct = await postDiagnosis(services, { cookie, key: key(4), ...right() });
    statuses.push([correct.status, correct.json.status]);
    const replay = await postDiagnosis(services, { cookie, key: key(4), ...right() });

    assert.deepEqual(statuses, [
      [200, "incorrect"],
      [200, "incorrect"],
      [200, "incorrect"],
      [429, "rate-limited"],
      [200, "correct"],
    ]);
    assert.deepEqual(replay.json, correct.json);

    const refreshed = await services.service.getChallengeSession(cookie, CHALLENGE_ID);
    assert.ok(refreshed.status === "ok" && refreshed.session);
    assert.equal(refreshed.session.status, "completed");
    assert.equal(refreshed.session.completion?.resolution.summary, RESOLUTION);
    assert.deepEqual([refreshed.session.attempts.total, refreshed.session.attempts.wrong], [4, 3]);
    assert.equal(refreshed.session.completedAt, new Date(START + 10 * MINUTE).toISOString());
  });
});

describe("getAppServices: the process-local instance", () => {
  test("is built on first use, and the same instance comes back every time", () => {
    assert.equal(SHARED_STATE_KEY in globalThis, false);

    const first = getAppServices();
    const second = getAppServices();

    assert.equal(first, second);
    assert.equal(SHARED_STATE_KEY in globalThis, true);
    assert.ok(first.store instanceof MemoryStore);
    assert.equal(typeof first.diagnosis, "function");
  });

  test("its store and IP limiter are the shared state's, which lives on globalThis", () => {
    const services = getAppServices();
    const shared = getSharedState();

    assert.equal((globalThis as Record<string, unknown>)[SHARED_STATE_KEY], shared);
    assert.equal(getSharedState(), shared);
    assert.equal(services.store, shared.store);
    assert.equal(services.ipSubmissions, shared.ipSubmissions);
  });

  test("a rebuild over the shared state (a module reload) keeps every learner and session, and picks up an edited challenge", async () => {
    const before = getAppServices();
    const cookie = await readyLearner(before);
    assert.equal((await postDiagnosis(before, { cookie, ...wrong(0) })).status, 200);

    // What a hot reload does: evaluate the module again, with the shared state that survived it.
    const real = createDefaultChallengeRegistry();
    const edited: ChallengeRegistry = { ...real, contentVersion: () => "99+edited" };
    const after = createAppServices({ ...getSharedState(), challenges: edited });

    assert.notEqual(after, before);
    assert.equal(after.store, before.store);
    const stale = await postDiagnosis(after, { cookie, ...right() });
    assert.equal(stale.status, 409, "the learner is still known, and the old session follows the version policy");
    assert.equal(stale.json.code, "session-outdated");
    assert.equal((await postDiagnosis(before, { cookie, ...wrong(1) })).status, 200, "the first instance still works against the same state");
  });

  test("the shared state is created once and can be cleared by deleting its key", () => {
    const shared = getSharedState();

    delete (globalThis as Record<string, unknown>)[SHARED_STATE_KEY];
    const fresh = getSharedState();
    assert.notEqual(fresh, shared);
    assert.notEqual(fresh.store, shared.store);

    (globalThis as Record<string, unknown>)[SHARED_STATE_KEY] = shared;
    assert.equal(getSharedState(), shared);
  });
});
