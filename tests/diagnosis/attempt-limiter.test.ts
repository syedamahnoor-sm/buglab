import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { getTrustedClientIp, parseTrustedProxyHops } from "@/server/diagnosis/client-ip";

function limiter(limit = 3, maxEntries?: number) {
  let now = 1_000_000;
  const instance = new FixedWindowLimiter({ limit, windowMs: 60_000, maxEntries, now: () => now });
  return { instance, advance: (ms: number) => (now += ms) };
}

describe("FixedWindowLimiter", () => {
  test("counts attempts and blocks at the limit", () => {
    const { instance } = limiter();
    assert.equal(instance.status("a").blocked, false);
    instance.increment("a");
    instance.increment("a");
    assert.equal(instance.status("a").remaining, 1);
    const third = instance.increment("a");
    assert.equal(third.blocked, true);
    assert.equal(third.remaining, 0);
    assert.equal(third.retryAfterSeconds, 60);
  });

  test("keys are independent", () => {
    const { instance } = limiter(1);
    instance.increment("a");
    assert.equal(instance.status("a").blocked, true);
    assert.equal(instance.status("b").blocked, false);
  });

  test("the window resets after it expires", () => {
    const { instance, advance } = limiter(1);
    instance.increment("a");
    advance(30_000);
    assert.equal(instance.status("a").retryAfterSeconds, 30);
    advance(30_000);
    assert.deepEqual(
      { blocked: instance.status("a").blocked, used: instance.status("a").used },
      { blocked: false, used: 0 },
    );
  });

  test("tracked keys stay bounded", () => {
    const { instance } = limiter(3, 5);
    for (let index = 0; index < 50; index += 1) instance.increment(`key-${index}`);
    assert.equal(instance.status("key-49").used, 1);
    assert.equal(instance.status("key-0").used, 0); // evicted
  });
});

describe("trusted client IP", () => {
  const headers = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});

  test("ignores X-Forwarded-For unless trusted proxies are configured", () => {
    assert.equal(getTrustedClientIp(headers("203.0.113.9"), 0), null);
    assert.equal(parseTrustedProxyHops(undefined), 0);
    assert.equal(parseTrustedProxyHops("abc"), 0);
    assert.equal(parseTrustedProxyHops("-1"), 0);
    assert.equal(parseTrustedProxyHops("2"), 2);
  });

  test("uses the address the outermost trusted proxy saw, not client-supplied entries", () => {
    // Client spoofs "1.1.1.1"; one trusted proxy appends the real peer.
    assert.equal(getTrustedClientIp(headers("1.1.1.1, 198.51.100.7"), 1), "198.51.100.7");
    // Two trusted proxies: real client is second from the right.
    assert.equal(getTrustedClientIp(headers("1.1.1.1, 198.51.100.7, 10.0.0.2"), 2), "198.51.100.7");
  });

  test("returns null for missing, short, or malformed headers", () => {
    assert.equal(getTrustedClientIp(headers(), 1), null);
    assert.equal(getTrustedClientIp(headers("198.51.100.7"), 2), null);
    assert.equal(getTrustedClientIp(headers("not an ip"), 1), null);
  });
});
