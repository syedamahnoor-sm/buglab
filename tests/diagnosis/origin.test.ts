import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isSameOriginRequest,
  normalizeOrigin,
  parseAppOrigin,
  shouldSetSecureCookie,
} from "@/server/diagnosis/origin";

const APP = "https://buglab.example";

/** A request as the server sees it. Host defaults to the URL's host, as in HTTP. */
function request(headers: Record<string, string>, url = "http://localhost:3000/api/x") {
  return new Request(url, { method: "POST", headers });
}

describe("normalizeOrigin", () => {
  test("accepts exact http(s) origins and serializes them canonically", () => {
    assert.equal(normalizeOrigin("https://buglab.example"), "https://buglab.example");
    assert.equal(normalizeOrigin("http://localhost:3000"), "http://localhost:3000");
    assert.equal(normalizeOrigin("HTTPS://BUGLAB.EXAMPLE"), "https://buglab.example");
    assert.equal(normalizeOrigin("https://buglab.example:443"), "https://buglab.example");
    assert.equal(normalizeOrigin("http://buglab.example:80"), "http://buglab.example");
    assert.equal(normalizeOrigin("https://buglab.example:8443"), "https://buglab.example:8443");
    assert.equal(normalizeOrigin("http://[::1]:3000"), "http://[::1]:3000");
  });

  test("rejects opaque, malformed and non-web origins", () => {
    for (const value of [
      "null",
      "",
      "https://",
      "not a url",
      "buglab.example",
      "//buglab.example",
      "file:///etc/passwd",
      "data:text/html,x",
      "javascript:alert(1)",
      "ftp://buglab.example",
      "chrome-extension://abcdef",
    ]) {
      assert.equal(normalizeOrigin(value), null, value);
    }
  });

  test("rejects anything beyond scheme, host and port", () => {
    for (const value of [
      "https://buglab.example/",
      "https://buglab.example/path",
      "https://buglab.example?q=1",
      "https://buglab.example#x",
      "https://user@buglab.example",
      "https://user:pass@buglab.example",
      "https://evil.example@buglab.example",
    ]) {
      assert.equal(normalizeOrigin(value), null, value);
    }
  });

  // The URL parser drops empty credentials from href, so these used to pass as
  // https://buglab.example. Any userinfo syntax is refused, empty or not.
  test("rejects userinfo syntax even when the credentials are empty", () => {
    for (const value of [
      "https://@buglab.example",
      "https://:@buglab.example",
      "https://@buglab.example:443",
      "HTTPS://@BUGLAB.EXAMPLE",
      "http://@localhost:3000",
      "http://:@localhost:3000",
      "https://@@buglab.example",
      "https://user:@buglab.example",
      "https://:pass@buglab.example",
    ]) {
      assert.equal(normalizeOrigin(value), null, value);
    }
  });

  test("still accepts the same origins written without userinfo", () => {
    assert.equal(normalizeOrigin("https://buglab.example"), APP);
    assert.equal(normalizeOrigin("https://buglab.example:443"), APP);
    assert.equal(normalizeOrigin("http://localhost:3000"), "http://localhost:3000");
    assert.equal(normalizeOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
    assert.equal(normalizeOrigin("http://[::1]:3000"), "http://[::1]:3000");
  });
});

describe("parseAppOrigin", () => {
  test("unset or blank means not configured", () => {
    assert.equal(parseAppOrigin(undefined), null);
    assert.equal(parseAppOrigin(""), null);
    assert.equal(parseAppOrigin("   "), null);
  });

  test("normalizes a valid origin", () => {
    assert.equal(parseAppOrigin("https://buglab.example"), APP);
    assert.equal(parseAppOrigin(" https://BugLab.Example:443 "), APP);
    assert.equal(parseAppOrigin("http://localhost:3000"), "http://localhost:3000");
  });

  test("throws on anything that is not exactly an origin, rather than accepting everything", () => {
    for (const value of [
      "buglab.example",
      "https://buglab.example/",
      "https://buglab.example/app",
      "ftp://x",
      "null",
      "*",
      "https://@buglab.example",
      "https://:@buglab.example",
      "https://user:pass@buglab.example",
    ]) {
      assert.throws(() => parseAppOrigin(value), /BUGLAB_APP_ORIGIN must be an origin/, value);
    }
  });
});

describe("isSameOriginRequest with BUGLAB_APP_ORIGIN configured", () => {
  const same = (headers: Record<string, string>, url?: string) => isSameOriginRequest(request(headers, url), APP);

  test("accepts the exact origin, including equivalent spellings", () => {
    assert.equal(same({ origin: APP }), true);
    assert.equal(same({ origin: "https://BUGLAB.EXAMPLE" }), true, "uppercase hostname");
    assert.equal(same({ origin: "https://buglab.example:443" }), true, "explicit default port");
  });

  test("rejects other origins, schemes and ports", () => {
    assert.equal(same({ origin: "https://evil.example" }), false, "cross-origin");
    assert.equal(same({ origin: "http://buglab.example" }), false, "scheme mismatch");
    assert.equal(same({ origin: "https://buglab.example:8443" }), false, "port mismatch");
    assert.equal(same({ origin: "https://sub.buglab.example" }), false, "subdomain");
    assert.equal(same({ origin: "https://buglab.example.evil.example" }), false, "suffix");
  });

  test("rejects malformed and opaque Origin values", () => {
    for (const origin of [
      "null",
      "https://",
      "garbage",
      "https://buglab.example/",
      "https://x@buglab.example",
      "https://@buglab.example",
      "https://:@buglab.example",
    ]) {
      assert.equal(same({ origin }), false, origin);
    }
  });

  test("ignores a spoofed Host and proxy headers in both directions", () => {
    // A client claiming to be evil.example everywhere is still rejected.
    assert.equal(
      same({
        origin: "https://evil.example",
        host: "evil.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      }),
      false,
    );
    // A proxy that rewrote Host to its upstream does not break the real origin.
    assert.equal(
      same({ origin: APP, host: "127.0.0.1:3000", "x-forwarded-host": "other.example", "x-forwarded-proto": "http" }, "http://127.0.0.1:3000/api/x"),
      true,
    );
  });
});

describe("isSameOriginRequest without BUGLAB_APP_ORIGIN (development fallback)", () => {
  const same = (headers: Record<string, string>, url?: string) => isSameOriginRequest(request(headers, url), null);

  test("keeps local development working", () => {
    assert.equal(same({ origin: "http://localhost:3000", host: "localhost:3000" }), true);
    assert.equal(same({ origin: "http://localhost:3000" }), true, "Host from the request URL");
  });

  test("compares the Origin with the Host header, normalized", () => {
    assert.equal(same({ origin: "https://buglab.example", host: "buglab.example" }), true);
    assert.equal(same({ origin: "https://buglab.example", host: "BUGLAB.EXAMPLE" }), true, "uppercase Host");
    assert.equal(same({ origin: "https://buglab.example", host: "buglab.example:443" }), true, "default port in Host");
    assert.equal(same({ origin: "https://evil.example", host: "buglab.example" }), false);
    assert.equal(same({ origin: "https://@buglab.example", host: "buglab.example" }), false, "empty userinfo in Origin");
    assert.equal(same({ origin: "https://buglab.example", host: "@buglab.example" }), false, "userinfo in Host");
    assert.equal(same({ origin: "https://buglab.example:8443", host: "buglab.example" }), false);
    assert.equal(same({ origin: "https://buglab.example", host: "buglab.example/evil" }), false, "malformed Host");
  });

  test("ignores X-Forwarded-Host", () => {
    assert.equal(same({ origin: "https://evil.example", host: "buglab.example", "x-forwarded-host": "evil.example" }), false);
  });

  test("documented limitation: a non-browser client can spoof Host and Origin together", () => {
    // Browsers cannot set Host, so this is not a cross-site vector; configure
    // BUGLAB_APP_ORIGIN in deployments to close it anyway.
    assert.equal(same({ origin: "https://evil.example", host: "evil.example" }), true);
  });
});

describe("isSameOriginRequest: Fetch Metadata and the missing-Origin policy", () => {
  for (const appOrigin of [APP, null]) {
    const mode = appOrigin ? "configured" : "fallback";
    const origin = appOrigin ?? "http://localhost:3000";

    test(`${mode}: Sec-Fetch-Site other than same-origin is rejected, even with a matching Origin`, () => {
      for (const site of ["cross-site", "same-site", "none", "bogus"]) {
        assert.equal(isSameOriginRequest(request({ origin, "sec-fetch-site": site }), appOrigin), false, site);
        assert.equal(isSameOriginRequest(request({ "sec-fetch-site": site }), appOrigin), false, `${site}, no Origin`);
      }
    });

    test(`${mode}: Sec-Fetch-Site same-origin still requires a matching Origin`, () => {
      assert.equal(isSameOriginRequest(request({ origin, "sec-fetch-site": "same-origin" }), appOrigin), true);
      assert.equal(
        isSameOriginRequest(request({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }), appOrigin),
        false,
      );
    });

    test(`${mode}: no Origin and no Sec-Fetch-Site is accepted, for non-browser clients`, () => {
      assert.equal(isSameOriginRequest(request({}), appOrigin), true);
      assert.equal(isSameOriginRequest(request({ "sec-fetch-site": "same-origin" }), appOrigin), true);
    });
  }
});

describe("shouldSetSecureCookie", () => {
  test("with an https app origin, always Secure, whatever the proxy sends", () => {
    assert.equal(shouldSetSecureCookie(request({}, "http://127.0.0.1:3000/api/x"), APP), true);
    assert.equal(shouldSetSecureCookie(request({ "x-forwarded-proto": "http" }), APP), true);
  });

  test("with an http app origin, never Secure, even if a client claims https", () => {
    assert.equal(shouldSetSecureCookie(request({}, "https://localhost:3000/api/x"), "http://localhost:3000"), false);
  });

  test("without an app origin, the request URL's scheme decides, as before", () => {
    assert.equal(shouldSetSecureCookie(request({}, "https://buglab.example/api/x"), null), true);
    assert.equal(shouldSetSecureCookie(request({}, "http://localhost:3000/api/x"), null), false);
  });
});
