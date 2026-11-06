/*
 * Trusted-proxy configuration: missing, malformed and invalid settings are DETECTABLE, forwarded headers are believed only as
 * far as an explicit setting says, and an unidentifiable client still fails safe. No database needed.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseTrustedProxyHops } from "@/server/diagnosis/client-ip";
import { clientKeyOf } from "@/server/ratelimit/client-address";
import { LEARNER_CREATION_SCOPE, LEARNER_CREATION_UNIDENTIFIED_SCOPE, createLearnerCreationGuard } from "@/server/ratelimit/learner-creation";
import {
  MAX_TRUSTED_PROXY_HOPS,
  ProxyConfigurationError,
  assertProxyConfiguration,
  inspectProxyConfiguration,
  readTrustedProxyHops,
  resolveTrustedProxyHops,
} from "@/server/ratelimit/proxy-config";
import type { DistributedRateLimiter } from "@/server/ratelimit/types";

const PROD = { production: true } as const;
const DEV = { production: false } as const;
const HOPS = "BUGLAB_TRUSTED_PROXY_HOPS";

describe("reading BUGLAB_TRUSTED_PROXY_HOPS strictly", () => {
  test("a plain whole number from 0 to 10 is configured, and surrounding space is ignored", () => {
    for (let n = 0; n <= MAX_TRUSTED_PROXY_HOPS; n += 1) {
      assert.deepEqual({ ...readTrustedProxyHops(String(n)) }, { state: "configured", hops: n }, String(n));
    }
    assert.deepEqual({ ...readTrustedProxyHops("  2\n") }, { state: "configured", hops: 2 });
  });

  test("unset and blank are `unconfigured`, which is NOT the same as 0", () => {
    for (const blank of [undefined, "", "   ", "\n"]) assert.equal(readTrustedProxyHops(blank).state, "unconfigured");
    assert.equal(readTrustedProxyHops("0").state, "configured", "an explicit 0 is a decision");
  });

  test("everything else is `invalid`, and invalid never turns into a guess", () => {
    const invalid = ["abc", "11", "100", "-1", "1.5", "2.0", "00", "01", "+1", "0x2", "1e1", "2abc", "abc2", "Infinity", "NaN", "null", "undefined", "١", "1 2", "1,2", "two"];
    for (const value of invalid) {
      const reading = readTrustedProxyHops(value);
      assert.equal(reading.state, "invalid", JSON.stringify(value));
      assert.equal(reading.hops, 0, "and it trusts nothing");
      assert.ok(reading.reason && !reading.reason.includes(value), "the reason never repeats the value");
    }
  });

  test("it agrees with the existing lenient parser on EVERY value it accepts, so a good configuration means the same thing everywhere", () => {
    for (let n = 0; n <= MAX_TRUSTED_PROXY_HOPS; n += 1) {
      assert.equal(readTrustedProxyHops(String(n)).hops, parseTrustedProxyHops(String(n)), String(n));
    }
    assert.equal(readTrustedProxyHops(" 3 ").hops, parseTrustedProxyHops(" 3 "));
  });

  test("where the lenient parser silently guesses, this one reports: spellings it quietly accepts and values it quietly zeroes", () => {
    // The lenient parser turns each of these into a number or into 0 with no complaint at all.
    const silentlyAccepted = ["0x2", "1e1", "+1"];
    for (const value of silentlyAccepted) {
      assert.ok(parseTrustedProxyHops(value) > 0, `lenient: ${value} is believed`);
      assert.equal(readTrustedProxyHops(value).state, "invalid", `strict: ${value} is reported`);
    }
    for (const value of ["abc", "11", "-1", "1.5", "00"]) {
      assert.equal(parseTrustedProxyHops(value), 0, `lenient: ${value} quietly becomes 0`);
      assert.equal(readTrustedProxyHops(value).state, "invalid", `strict: ${value} is reported`);
    }
  });
});

describe("detecting missing and invalid configuration", () => {
  test("production with the variable UNSET is a problem: it must be said, even if the answer is none", () => {
    const report = inspectProxyConfiguration({}, PROD);
    assert.equal(report.production, true);
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0], /BUGLAB_TRUSTED_PROXY_HOPS is not set/);
    assert.match(report.problems[0], /use 0/);
    assert.throws(() => assertProxyConfiguration({}, PROD), ProxyConfigurationError);
  });

  test("production with an explicit 0 is valid (a decision that no proxy is trusted) and is stated as a warning, not hidden", () => {
    const report = inspectProxyConfiguration({ [HOPS]: "0" }, PROD);
    assert.deepEqual([...report.problems], []);
    assert.equal(report.warnings.length, 1);
    assert.match(report.warnings[0], /every client counts as unidentified/);
  });

  test("production with a valid proxy count has no problem and no warning", () => {
    for (const n of ["1", "2", "10"]) {
      const report = inspectProxyConfiguration({ [HOPS]: n }, PROD);
      assert.deepEqual([[...report.problems], [...report.warnings]], [[], []], n);
    }
  });

  test("development with the variable unset is allowed, with a warning", () => {
    const report = inspectProxyConfiguration({}, DEV);
    assert.deepEqual([...report.problems], []);
    assert.equal(report.warnings.length, 1);
    assert.doesNotThrow(() => assertProxyConfiguration({}, DEV));
  });

  test("an invalid value is a problem EVERYWHERE, development included", () => {
    for (const options of [PROD, DEV]) {
      for (const value of ["abc", "11", "-1", "1.5", "0x2"]) {
        const report = inspectProxyConfiguration({ [HOPS]: value }, options);
        assert.equal(report.problems.length, 1, `${value} (${options.production ? "production" : "development"})`);
        assert.throws(() => assertProxyConfiguration({ [HOPS]: value }, options), ProxyConfigurationError);
      }
    }
  });

  test("production is NODE_ENV === 'production' and nothing else: it is not inferred from a host, a header or a platform", () => {
    assert.equal(inspectProxyConfiguration({ NODE_ENV: "production" }).production, true);
    for (const env of ["development", "test", "", "prod", "PRODUCTION", "staging"]) {
      assert.equal(inspectProxyConfiguration({ NODE_ENV: env }).production, false, env);
    }
    assert.equal(inspectProxyConfiguration({ VERCEL: "1", NETLIFY: "true", AWS_REGION: "x", RENDER: "true", FLY_APP_NAME: "x" }).production, false, "hosting variables mean nothing");
    assert.equal(inspectProxyConfiguration({ NODE_ENV: "production" }, DEV).production, false, "an explicit option wins");
  });

  test("the creation limit's own settings are checked with it: a malformed one is a problem, and `allow` is a stated warning", () => {
    assert.match(inspectProxyConfiguration({ [HOPS]: "1", BUGLAB_LEARNER_CREATION_LIMIT: "many" }, PROD).problems.join(), /BUGLAB_LEARNER_CREATION_LIMIT/);
    assert.match(inspectProxyConfiguration({ [HOPS]: "1", BUGLAB_LEARNER_CREATION_WINDOW_SECONDS: "0" }, PROD).problems.join(), /BUGLAB_LEARNER_CREATION_WINDOW_SECONDS/);
    assert.match(inspectProxyConfiguration({ [HOPS]: "1", BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: "off" }, PROD).problems.join(), /BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS/);
    const allow = inspectProxyConfiguration({ [HOPS]: "1", BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: "allow" }, PROD);
    assert.deepEqual([...allow.problems], [], "an explicit opt-out is not an error");
    assert.match(allow.warnings.join(), /NOT limited/, "but it is never silent");
  });

  test("every problem at once is reported together, so one startup attempt shows everything to fix", () => {
    const report = inspectProxyConfiguration({ [HOPS]: "eleven", BUGLAB_LEARNER_CREATION_LIMIT: "-5", BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: "maybe" }, PROD);
    assert.equal(report.problems.length, 3);
    try {
      assertProxyConfiguration({ [HOPS]: "eleven", BUGLAB_LEARNER_CREATION_LIMIT: "-5" }, PROD);
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof ProxyConfigurationError);
      assert.equal(error.problems.length, 2);
      assert.match(error.message, /BUGLAB_TRUSTED_PROXY_HOPS/);
      assert.match(error.message, /BUGLAB_LEARNER_CREATION_LIMIT/);
    }
  });

  test("messages name the variable and the rule and never echo a value", () => {
    const marker = "super-secret-looking-value-9f3a";
    const text = JSON.stringify([
      inspectProxyConfiguration({ [HOPS]: marker }, PROD),
      inspectProxyConfiguration({ [HOPS]: "1", BUGLAB_LEARNER_CREATION_LIMIT: marker }, PROD),
      inspectProxyConfiguration({ [HOPS]: "1", BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS: marker }, PROD),
    ]);
    assert.ok(!text.includes(marker));
    assert.throws(() => assertProxyConfiguration({ [HOPS]: marker }, PROD), (e: Error) => !e.message.includes(marker));
  });
});

describe("resolving the number the guard uses", () => {
  test("from the environment, validated", () => {
    assert.equal(resolveTrustedProxyHops({ [HOPS]: "2" }, PROD), 2);
    assert.equal(resolveTrustedProxyHops({ [HOPS]: "0" }, PROD), 0);
    assert.equal(resolveTrustedProxyHops({}, DEV), 0, "development, unset: nothing is trusted");
    assert.throws(() => resolveTrustedProxyHops({}, PROD), ProxyConfigurationError);
    assert.throws(() => resolveTrustedProxyHops({ [HOPS]: "abc" }, DEV), ProxyConfigurationError);
  });

  test("a number passed in must AGREE with the environment: the diagnosis endpoint reads the same variable", () => {
    assert.equal(resolveTrustedProxyHops({ [HOPS]: "2" }, { ...PROD, explicit: 2 }), 2);
    assert.throws(() => resolveTrustedProxyHops({ [HOPS]: "2" }, { ...PROD, explicit: 1 }), /disagrees with BUGLAB_TRUSTED_PROXY_HOPS/);
    assert.throws(() => resolveTrustedProxyHops({ [HOPS]: "0" }, { ...PROD, explicit: 3 }), /disagrees/);
  });

  test("a number passed in is used when the environment is unset in development, never in production, and must be a real count", () => {
    assert.equal(resolveTrustedProxyHops({}, { ...DEV, explicit: 1 }), 1);
    assert.throws(() => resolveTrustedProxyHops({}, { ...PROD, explicit: 1 }), ProxyConfigurationError, "production must be configured, whatever the caller passes");
    for (const bad of [-1, 11, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => resolveTrustedProxyHops({}, { ...DEV, explicit: bad }), ProxyConfigurationError, String(bad));
    }
  });
});

describe("forwarded headers are believed only as far as the explicit setting says", () => {
  function spy() {
    const calls: { scope: string; key: string }[] = [];
    const limiter: DistributedRateLimiter = {
      async consume(scope, key, policy) {
        calls.push({ scope, key });
        return { allowed: true, used: 1, limit: policy.limit, resetsAt: 0, retryAfterSeconds: 0 };
      },
      purgeExpired: async () => 0,
    };
    return { limiter, calls };
  }
  async function keyOf(hops: number, headers: Record<string, string>) {
    const { limiter, calls } = spy();
    await createLearnerCreationGuard({ limiter, trustedProxyHops: hops })(new Request("http://localhost:3000/api/learner", { method: "POST", headers }));
    return calls[0];
  }
  /** The key a request from exactly this address gets when one proxy appended it. */
  const keyFor = async (address: string) => (await keyOf(1, { "x-forwarded-for": address })).key;
  const UNIDENTIFIED = LEARNER_CREATION_UNIDENTIFIED_SCOPE;

  test("the full matrix: with N entries in the header and H trusted proxies, the believed address is the H-th from the right, and fewer entries than H is unidentified", async () => {
    const chain = ["198.51.100.1", "198.51.100.2", "203.0.113.30", "203.0.113.40"];
    for (let entries = 1; entries <= chain.length; entries += 1) {
      const header = chain.slice(0, entries).join(", ");
      for (let hops = 0; hops <= 5; hops += 1) {
        const got = await keyOf(hops, { "x-forwarded-for": header });
        if (hops === 0 || entries < hops) {
          assert.equal(got.scope, UNIDENTIFIED, `entries=${entries} hops=${hops}`);
        } else {
          assert.equal(got.scope, LEARNER_CREATION_SCOPE, `entries=${entries} hops=${hops}`);
          assert.equal(got.key, await keyFor(chain[entries - hops]), `entries=${entries} hops=${hops} believes entry ${entries - hops}`);
        }
      }
    }
  });

  test("only X-Forwarded-For is ever read: no other header can name a client, with or without a trusted proxy", async () => {
    const others = {
      "x-real-ip": "203.0.113.7",
      forwarded: "for=203.0.113.7;proto=https",
      "cf-connecting-ip": "203.0.113.7",
      "true-client-ip": "203.0.113.7",
      "x-client-ip": "203.0.113.7",
      "x-cluster-client-ip": "203.0.113.7",
      "fastly-client-ip": "203.0.113.7",
      "x-originating-ip": "203.0.113.7",
      "x-forwarded": "203.0.113.7",
      "x-envoy-external-address": "203.0.113.7",
      "x-azure-clientip": "203.0.113.7",
    };
    for (const hops of [0, 1, 2, 10]) {
      assert.equal((await keyOf(hops, others)).scope, UNIDENTIFIED, `hops=${hops}`);
    }
    // And they do not override or mix with X-Forwarded-For when that is present.
    const withXff = await keyOf(1, { ...others, "x-forwarded-for": "203.0.113.99" });
    assert.equal(withXff.key, await keyFor("203.0.113.99"));
  });

  test("with hops 0 no header at all is believed, however well-formed", async () => {
    const cases: Record<string, string>[] = [{ "x-forwarded-for": "203.0.113.9" }, { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }, {}];
    for (const headers of cases) {
      assert.equal((await keyOf(0, headers)).scope, UNIDENTIFIED);
    }
  });

  test("an untrusted chain cannot choose the bucket: anything the client writes to the left of the trusted entry is ignored", async () => {
    const real = await keyFor("203.0.113.9");
    for (const forged of ["1.1.1.1, 203.0.113.9", "10.0.0.1, 192.168.0.1, 203.0.113.9", "::1, 203.0.113.9", "evil, 203.0.113.9", ", , 203.0.113.9"]) {
      assert.equal((await keyOf(1, { "x-forwarded-for": forged })).key, real, forged);
    }
  });

  test("MISCONFIGURATION 1, too few proxies configured: the address believed is a PROXY's, so everyone behind it shares one bucket (this is why the count must be exact)", async () => {
    // Two proxies really stand in front of the app, but the setting says one: the believed entry is the inner proxy.
    const alice = await keyOf(1, { "x-forwarded-for": "203.0.113.1, 10.0.0.9" });
    const bob = await keyOf(1, { "x-forwarded-for": "203.0.113.2, 10.0.0.9" });
    assert.equal(alice.key, bob.key, "different clients, same believed address");
    assert.equal(alice.scope, LEARNER_CREATION_SCOPE, "and nothing flags it: only the operator's count can");
  });

  test("MISCONFIGURATION 2, too many proxies configured: with a short header the client is unidentified (shared bucket); with a long one the believed entry is client-written", async () => {
    assert.equal((await keyOf(3, { "x-forwarded-for": "203.0.113.1, 10.0.0.9" })).scope, UNIDENTIFIED, "fewer entries than proxies fails safe");
    // One real proxy, but the setting says 2, and the client prepends its own entries: it now controls what is believed.
    const chosenByClient = await keyOf(2, { "x-forwarded-for": "9.9.9.9, 203.0.113.1" });
    assert.equal(chosenByClient.key, await keyFor("9.9.9.9"), "documented: an over-stated count lets the client pick its own bucket");
  });

  test("an address in the trusted position that is not a valid identity is unidentified, never believed", async () => {
    for (const bad of ["1:2", "....", "unknown", "999.999.999.999", "0.0.0.0", "::", "fe80::1%eth0"]) {
      assert.equal((await keyOf(1, { "x-forwarded-for": `203.0.113.5, ${bad}` })).scope, UNIDENTIFIED, bad);
    }
    assert.equal(clientKeyOf("1:2"), null);
  });

  test("an unidentified client fails SAFE by default (one shared, bounded bucket), and unlimited only when explicitly configured", async () => {
    const { limiter, calls } = spy();
    const bounded = createLearnerCreationGuard({ limiter, trustedProxyHops: 1 });
    const open = createLearnerCreationGuard({ limiter, trustedProxyHops: 1, unidentified: "allow" });
    const noHeader = () => new Request("http://localhost:3000/api/learner", { method: "POST" });
    await bounded(noHeader());
    await open(noHeader());
    assert.deepEqual(calls.map((c) => c.scope), [UNIDENTIFIED], "default: counted. `allow`: never even asked");
  });
});
