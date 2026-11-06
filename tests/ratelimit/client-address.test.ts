/*
 * Client-address normalisation and trusted-proxy resolution for the learner-creation limit. No database needed.
 *
 * Two layers: `clientKeyOf` decides whether an address is a usable identity and what key it maps to, and the guard combines it
 * with getTrustedClientIp (which decides WHICH entry of X-Forwarded-For to believe) so that nothing a client writes can pick
 * its own bucket.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clientKeyOf } from "@/server/ratelimit/client-address";
import { LEARNER_CREATION_SCOPE, LEARNER_CREATION_UNIDENTIFIED_SCOPE, createLearnerCreationGuard } from "@/server/ratelimit/learner-creation";
import type { DistributedRateLimiter } from "@/server/ratelimit/types";

describe("clientKeyOf", () => {
  test("a valid IPv4 address is a client, and the same address is always the same key", () => {
    assert.equal(clientKeyOf("203.0.113.9"), "v4:203.0.113.9");
    assert.equal(clientKeyOf("  203.0.113.9  "), "v4:203.0.113.9", "surrounding space is ignored");
    assert.notEqual(clientKeyOf("203.0.113.9"), clientKeyOf("203.0.113.10"));
  });

  test("an IPv6 client is keyed by its /64, in any spelling, so one subscriber cannot rotate through addresses", () => {
    const base = clientKeyOf("2001:db8:abcd:12::1");
    assert.equal(base, "v6/64:2001:0db8:abcd:0012");
    for (const same of [
      "2001:DB8:ABCD:12::1",
      "2001:0db8:abcd:0012:0000:0000:0000:0001",
      "2001:db8:abcd:12:ffff:ffff:ffff:ffff",
      "2001:db8:abcd:12:1:2:3:4",
      "2001:db8:abcd:12::",
    ]) {
      assert.equal(clientKeyOf(same), base, same);
    }
    for (const different of ["2001:db8:abcd:13::1", "2001:db8:abce:12::1", "2001:db9:abcd:12::1"]) {
      assert.notEqual(clientKeyOf(different), base, different);
    }
  });

  test("an IPv4-mapped IPv6 address is the same client as the IPv4 address, so being reachable both ways earns no second allowance", () => {
    assert.equal(clientKeyOf("::ffff:203.0.113.9"), clientKeyOf("203.0.113.9"));
    assert.equal(clientKeyOf("::FFFF:cb00:7109"), clientKeyOf("203.0.113.9"), "the hex spelling of the same address");
    assert.equal(clientKeyOf("0:0:0:0:0:ffff:203.0.113.9"), clientKeyOf("203.0.113.9"));
  });

  test("an IPv6 address with an embedded IPv4 tail that is not a mapping is an ordinary IPv6 client", () => {
    assert.equal(clientKeyOf("64:ff9b::192.0.2.1"), "v6/64:0064:ff9b:0000:0000");
  });

  test("things that are not a usable identity are null: garbage, ports, brackets, lists, zone ids and the unspecified addresses", () => {
    const notIdentities = [
      null, "", " ", "unknown", "null", "undefined", "localhost",
      "1:2", "....", ":::", "gggg::1", "12345::1", "2001:db8::1::2", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7",
      "999.1.1.1", "1.2.3", "1.2.3.4.5", "01.2.3.4", "1.2.3.256", "-1.2.3.4",
      "203.0.113.9:8080", "[::1]", "[2001:db8::1]:443", "203.0.113.9, 198.51.100.1", "203.0.113.9/24", "2001:db8::/32",
      "fe80::1%eth0", "fe80::1%25eth0", "::1%lo",
      "0.0.0.0", "::", "0:0:0:0:0:0:0:0", "::ffff:0.0.0.0",
      "x".repeat(10_000),
    ];
    for (const value of notIdentities) assert.equal(clientKeyOf(value), null, JSON.stringify(value)?.slice(0, 40));
  });

  test("loopback and private addresses are valid identities (an intranet is a real client), and never throw", () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "192.168.1.20", "::1", "fd00::1"]) assert.ok(clientKeyOf(address), address);
  });
});

describe("trusted-proxy resolution through the guard", () => {
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
  const via = (xff: string | string[] | null) => {
    const headers = new Headers();
    if (xff !== null) for (const value of Array.isArray(xff) ? xff : [xff]) headers.append("x-forwarded-for", value);
    return new Request("http://localhost:3000/api/learner", { method: "POST", headers });
  };
  async function scopesAndKeys(hops: number, requests: Request[]) {
    const { limiter, calls } = spy();
    const guard = createLearnerCreationGuard({ limiter, trustedProxyHops: hops });
    for (const request of requests) await guard(request);
    return calls;
  }

  test("one trusted proxy: the address it appended is used, and nothing the client wrote to its left can change the bucket", async () => {
    const calls = await scopesAndKeys(1, [via("203.0.113.9"), via("198.51.100.1, 203.0.113.9"), via("10.0.0.1, 1.1.1.1, 203.0.113.9"), via("evil, 203.0.113.9")]);
    assert.equal(new Set(calls.map((c) => c.key)).size, 1, "all four are the same client");
    assert.ok(calls.every((c) => c.scope === LEARNER_CREATION_SCOPE));
  });

  test("DOCUMENTED LIMIT: a client that reaches the origin directly writes the whole header and CAN choose its bucket, which is why the origin must only be reachable through the trusted proxies", async () => {
    // With hops=1 the rightmost entry is believed. A client that reaches the app directly writes every entry, so it can
    // choose it. That is the deployment requirement in learner-creation.ts (the origin must be reachable only through the
    // trusted proxies). This test records the behaviour so nobody mistakes the guard for protection against it.
    const calls = await scopesAndKeys(1, [via("1.1.1.1"), via("2.2.2.2")]);
    assert.notEqual(calls[0].key, calls[1].key);
  });

  test("two trusted proxies: the second from the right is the client", async () => {
    const calls = await scopesAndKeys(2, [via("198.51.100.7, 203.0.113.9, 10.0.0.2"), via("203.0.113.9, 10.0.0.2")]);
    assert.equal(calls[0].key, calls[1].key);
    assert.ok(calls.every((c) => c.scope === LEARNER_CREATION_SCOPE));
  });

  test("fewer entries than trusted proxies, an empty header, or no header: the client cannot be established, so the shared bucket applies", async () => {
    for (const request of [via("203.0.113.9"), via(""), via(null), via(",,")]) {
      const calls = await scopesAndKeys(2, [request]);
      assert.equal(calls[0].scope, LEARNER_CREATION_UNIDENTIFIED_SCOPE, JSON.stringify([...request.headers]));
    }
  });

  test("an unusable address in the trusted position is not an identity, however address-like it looks to the first filter", async () => {
    for (const bad of ["1:2", "....", "999.1.1.1", "0.0.0.0", "::", "unknown", "fe80::1%eth0", "[::1]", "203.0.113.9:80"]) {
      const calls = await scopesAndKeys(1, [via(`203.0.113.50, ${bad}`)]);
      assert.equal(calls[0].scope, LEARNER_CREATION_UNIDENTIFIED_SCOPE, bad);
    }
  });

  test("hops of zero trust nothing: every request, whatever it claims, is unidentified", async () => {
    const calls = await scopesAndKeys(0, [via("203.0.113.9"), via("198.51.100.1, 203.0.113.9"), via(null)]);
    assert.ok(calls.every((c) => c.scope === LEARNER_CREATION_UNIDENTIFIED_SCOPE));
  });

  test("several X-Forwarded-For headers are one list, in order, as proxies append them", async () => {
    const calls = await scopesAndKeys(1, [via(["198.51.100.1", "203.0.113.9"]), via("198.51.100.1, 203.0.113.9")]);
    assert.equal(calls[0].key, calls[1].key);
  });

  test("an IPv4-mapped spelling and the IPv4 address share one bucket through the guard, as do addresses in one /64", async () => {
    const mapped = await scopesAndKeys(1, [via("::ffff:203.0.113.9"), via("203.0.113.9")]);
    assert.equal(mapped[0].key, mapped[1].key);
    const sameNetwork = await scopesAndKeys(1, [via("2001:db8:1:2::a"), via("2001:db8:1:2:ffff::1")]);
    assert.equal(sameNetwork[0].key, sameNetwork[1].key);
  });

  test("the raw address never reaches the limiter, only a digest of its normalised form", async () => {
    const calls = await scopesAndKeys(1, [via("203.0.113.9"), via("2001:db8:1:2::a")]);
    for (const call of calls) {
      assert.match(call.key, /^[0-9a-f]{64}$/);
      assert.ok(!call.key.includes("203") && !call.key.includes("2001"));
    }
  });
});
