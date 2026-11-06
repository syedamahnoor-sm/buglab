/*
 * The creation guard obtained from the persistence object validates the proxy and limit configuration WHEN IT IS BUILT, so a
 * wrong or missing production setting stops startup instead of weakening the limit quietly. No database needed: building a
 * guard opens no connection (the pool is pointed at an address nothing listens on).
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";
import { LEARNER_CREATION_SCOPE, LEARNER_CREATION_UNIDENTIFIED_SCOPE } from "@/server/ratelimit/learner-creation";
import { ProxyConfigurationError } from "@/server/ratelimit/proxy-config";

const UNREACHABLE = "postgres://app_user:placeholder@127.0.0.1:1/buglab";
const open: PostgresPersistence[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.close()));
});

const ENV_NAMES = ["NODE_ENV", "BUGLAB_TRUSTED_PROXY_HOPS", "BUGLAB_LEARNER_CREATION_LIMIT", "BUGLAB_LEARNER_CREATION_WINDOW_SECONDS", "BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS"] as const;

/** Runs `run` with exactly these variables set (all others in the list removed), and restores every one afterwards. */
function withEnv<T>(values: Partial<Record<(typeof ENV_NAMES)[number], string>>, run: () => T): T {
  const saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  const env = process.env as Record<string, string | undefined>;
  for (const name of ENV_NAMES) {
    if (values[name] === undefined) delete env[name];
    else env[name] = values[name];
  }
  try {
    return run();
  } finally {
    for (const name of ENV_NAMES) {
      const value = saved[name] as string | undefined;
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  }
}

function persistence() {
  const created = createPostgresPersistence({ config: { connectionString: UNREACHABLE, poolMax: 1 } });
  open.push(created);
  return created;
}

describe("learnerCreationGuard validates the configuration when it is built", () => {
  test("production with BUGLAB_TRUSTED_PROXY_HOPS unset refuses to start, even if a number is passed in", () => {
    const p = persistence();
    withEnv({ NODE_ENV: "production" }, () => {
      assert.throws(() => p.learnerCreationGuard(), ProxyConfigurationError);
      assert.throws(() => p.learnerCreationGuard({ trustedProxyHops: 1 }), ProxyConfigurationError);
    });
  });

  test("production with an invalid value refuses to start, and so does development", () => {
    const p = persistence();
    for (const NODE_ENV of ["production", "development"]) {
      for (const BUGLAB_TRUSTED_PROXY_HOPS of ["abc", "11", "-1", "1.5", "0x2", "1e1"]) {
        assert.throws(() => withEnv({ NODE_ENV, BUGLAB_TRUSTED_PROXY_HOPS }, () => p.learnerCreationGuard()), ProxyConfigurationError, `${NODE_ENV} ${BUGLAB_TRUSTED_PROXY_HOPS}`);
      }
    }
  });

  test("production with a valid count builds, and the number comes from the environment when none is passed", async () => {
    const p = persistence();
    await withEnv({ NODE_ENV: "production", BUGLAB_TRUSTED_PROXY_HOPS: "2" }, async () => {
      const guard = p.learnerCreationGuard();
      assert.equal(typeof guard, "function");
      // Behaviour check without a database: the believed entry is the 2nd from the right.
      const calls: string[] = [];
      Object.defineProperty(p.rateLimiter, "consume", {
        value: async (scope: string, key: string, policy: { limit: number }) => {
          calls.push(`${scope}`);
          return { allowed: true, used: 1, limit: policy.limit, resetsAt: 0, retryAfterSeconds: 0 };
        },
      });
      await guard(new Request("http://localhost:3000/api/learner", { method: "POST", headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9, 10.0.0.2" } }));
      await guard(new Request("http://localhost:3000/api/learner", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } }));
      assert.deepEqual(calls, [LEARNER_CREATION_SCOPE, LEARNER_CREATION_UNIDENTIFIED_SCOPE], "a header shorter than the count is unidentified");
    });
  });

  test("production with an explicit 0 builds, and every client is then unidentified (the shared, bounded bucket)", async () => {
    const p = persistence();
    await withEnv({ NODE_ENV: "production", BUGLAB_TRUSTED_PROXY_HOPS: "0" }, async () => {
      const scopes: string[] = [];
      Object.defineProperty(p.rateLimiter, "consume", {
        value: async (scope: string, _key: string, policy: { limit: number }) => {
          scopes.push(scope);
          return { allowed: true, used: 1, limit: policy.limit, resetsAt: 0, retryAfterSeconds: 0 };
        },
      });
      await p.learnerCreationGuard()(new Request("http://localhost:3000/api/learner", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } }));
      assert.deepEqual(scopes, [LEARNER_CREATION_UNIDENTIFIED_SCOPE]);
    });
  });

  test("a number passed in that disagrees with the environment is refused", () => {
    const p = persistence();
    withEnv({ NODE_ENV: "production", BUGLAB_TRUSTED_PROXY_HOPS: "2" }, () => {
      assert.throws(() => p.learnerCreationGuard({ trustedProxyHops: 1 }), /disagrees with BUGLAB_TRUSTED_PROXY_HOPS/);
      assert.doesNotThrow(() => p.learnerCreationGuard({ trustedProxyHops: 2 }));
    });
  });

  test("development with nothing set still builds (nothing trusted, a warning in the inspection), as before", () => {
    const p = persistence();
    withEnv({ NODE_ENV: "development" }, () => {
      assert.doesNotThrow(() => p.learnerCreationGuard());
      assert.doesNotThrow(() => p.learnerCreationGuard({ trustedProxyHops: 1 }));
    });
  });

  test("a malformed creation-limit setting is still refused when the guard is built, in production too", () => {
    const p = persistence();
    withEnv({ NODE_ENV: "production", BUGLAB_TRUSTED_PROXY_HOPS: "1", BUGLAB_LEARNER_CREATION_LIMIT: "lots" }, () => {
      assert.throws(() => p.learnerCreationGuard(), /BUGLAB_LEARNER_CREATION_LIMIT/);
    });
  });

  test("the configuration error never contains a database credential or any value from the environment", () => {
    const p = persistence();
    withEnv({ NODE_ENV: "production", BUGLAB_TRUSTED_PROXY_HOPS: "distinctive-bad-value-77" }, () => {
      try {
        p.learnerCreationGuard();
        assert.fail("should have thrown");
      } catch (error) {
        const text = String((error as Error).message);
        assert.ok(!text.includes("distinctive-bad-value-77") && !text.includes("placeholder") && !text.includes("127.0.0.1"));
      }
    });
  });
});

