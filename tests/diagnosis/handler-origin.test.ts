import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { createTestHandler, post } from "./fixtures";

const APP = "https://buglab.example";
const FORBIDDEN = { status: "error", message: "Cross-origin submissions are not allowed." };

/** Counts increments, so a test can show a rejected request touched no limit. */
function countIncrements(limiter: FixedWindowLimiter) {
  let count = 0;
  const increment = limiter.increment.bind(limiter);
  limiter.increment = (key) => {
    count += 1;
    return increment(key);
  };
  return () => count;
}

// A deployment behind a TLS-terminating proxy: the app sees its upstream URL.
const behindProxy = { baseUrl: "http://127.0.0.1:3000" };

describe("POST /api/challenges/:id/diagnosis: origin checks", () => {
  test("rejections keep the existing 403 contract, set no cookie and touch no limit", async () => {
    const { handler, wrongAttempts, ipSubmissions } = createTestHandler({ appOrigin: APP, trustedProxyHops: 1 });
    const wrong = countIncrements(wrongAttempts);
    const perIp = countIncrements(ipSubmissions);
    const rejected: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "http://buglab.example" },
      { origin: "null" },
      { origin: "https://" },
      { origin: APP, "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { origin: "https://evil.example", host: "evil.example", "x-forwarded-host": "evil.example" },
    ];
    for (const headers of rejected) {
      const { response, json } = await post(handler, {
        ...behindProxy,
        headers: { ...headers, "x-forwarded-for": "198.51.100.7" },
      });
      const label = JSON.stringify(headers);
      assert.equal(response.status, 403, label);
      assert.deepEqual(json, FORBIDDEN, label);
      assert.equal(response.headers.get("cache-control"), "no-store", label);
      assert.equal(response.headers.get("set-cookie"), null, label);
    }
    assert.equal(wrong(), 0);
    assert.equal(perIp(), 0);
  });

  test("415 is still checked before the origin", async () => {
    const { handler } = createTestHandler({ appOrigin: APP });
    const { response } = await post(handler, { headers: { "content-type": "text/plain", origin: "https://evil.example" } });
    assert.equal(response.status, 415);
  });

  test("with BUGLAB_APP_ORIGIN, the real origin is accepted behind a proxy that rewrote Host", async () => {
    const { handler } = createTestHandler({ appOrigin: APP });
    for (const origin of [APP, "https://BUGLAB.EXAMPLE", "https://buglab.example:443"]) {
      const { response, json } = await post(handler, {
        ...behindProxy,
        headers: { origin, "sec-fetch-site": "same-origin", host: "127.0.0.1:3000" },
      });
      assert.equal(response.status, 200, origin);
      assert.equal(json.status, "incorrect", origin);
    }
  });

  test("with BUGLAB_APP_ORIGIN, the attempt cookie is Secure without trusting X-Forwarded-Proto", async () => {
    const { handler } = createTestHandler({ appOrigin: APP });
    for (const proto of [undefined, "http"]) {
      const headers: Record<string, string> = { origin: APP };
      if (proto) headers["x-forwarded-proto"] = proto;
      const { response } = await post(handler, { ...behindProxy, headers });
      assert.match(response.headers.get("set-cookie") ?? "", /; HttpOnly; SameSite=Strict; Secure$/, String(proto));
    }
  });

  test("without BUGLAB_APP_ORIGIN, local development behaves as before", async () => {
    const { handler } = createTestHandler();
    const { response } = await post(handler, {
      headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie") ?? "", /; HttpOnly; SameSite=Strict$/);
  });

  test("non-browser clients without Origin or Sec-Fetch-Site still work, in both modes", async () => {
    for (const appOrigin of [APP, null]) {
      const { handler } = createTestHandler({ appOrigin });
      const { response, json } = await post(handler, behindProxy);
      assert.equal(response.status, 200, String(appOrigin));
      assert.equal(json.status, "incorrect", String(appOrigin));
    }
  });
});
