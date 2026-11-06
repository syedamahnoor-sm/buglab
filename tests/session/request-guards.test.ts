/*
 * The request guards, tested directly. The same behaviour is also pinned end to end through the
 * learner and session handlers (handlers.test.ts, which this extraction left untouched) and through
 * the diagnosis submission handler; these tests pin each guard on its own, so a change to one shows
 * up here first and with a precise message.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  SMALL_BODY_LIMIT_BYTES,
  checkSmallJsonWrite,
  checkWriteHeaders,
  hasJsonContentType,
  isPrefetch,
  isSameOrigin,
  readBoundedBody,
  readJsonObjectBody,
} from "@/server/session/request-guards";

const URL_BASE = "http://localhost:3000";

function make(headers: Record<string, string> = {}, { url = URL_BASE, body }: { url?: string; body?: BodyInit | null } = {}) {
  return new Request(`${url}/api/x`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url, ...headers },
    body: body === undefined ? "{}" : body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

/** A stream of `chunks` chunks of `size` bytes each, that records how much of it was pulled and whether it was cancelled. */
function stream(chunks: number, size: number) {
  const state = { pulled: 0, cancelled: false };
  // highWaterMark 0: nothing is pulled until a reader asks, so `pulled` counts real reads only.
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled += 1;
        controller.enqueue(new Uint8Array(size).fill(0x20));
        if (state.pulled >= chunks) controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, state };
}

describe("hasJsonContentType", () => {
  test("accepts application/json, with parameters and in any case", () => {
    for (const value of ["application/json", "application/json; charset=utf-8", "APPLICATION/JSON", "Application/Json;charset=UTF-8", "application/json ;x=1"]) {
      assert.equal(hasJsonContentType(make({ "content-type": value })), true, value);
    }
  });

  test("refuses everything else, including look-alikes and a missing header", () => {
    for (const value of ["", "text/plain", "application/jsonp", "application/json5", "application/vnd.api+json", "text/plain; application/json", "xapplication/json", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      assert.equal(hasJsonContentType(make({ "content-type": value })), false, value);
    }
  });
});

describe("isSameOrigin: the strict policy", () => {
  test("accepts the request's own origin: same scheme, host and port", () => {
    for (const url of ["http://localhost:3000", "https://buglab.example", "https://buglab.example:8443", "http://127.0.0.1:3000"]) {
      assert.equal(isSameOrigin(make({}, { url })), true, url);
    }
  });

  test("an Origin is compared as a parsed origin, so an explicit default port is still the same origin", () => {
    assert.equal(isSameOrigin(make({ origin: "https://buglab.example:443" }, { url: "https://buglab.example" })), true);
    assert.equal(isSameOrigin(make({ origin: "http://buglab.example:80" }, { url: "http://buglab.example" })), true);
  });

  test("an Origin is exactly scheme://host[:port]: a trailing slash, path, query or fragment is refused", () => {
    // This is the shared helper's rule (src/server/diagnosis/origin.ts). A browser never sends any of these
    // in an Origin, so this tightens a lenient comparison that accepted `http://localhost:3000/`.
    for (const origin of ["http://localhost:3000/", "http://localhost:3000/path", "http://localhost:3000?x=1", "http://localhost:3000#x"]) {
      assert.equal(isSameOrigin(make({ origin })), false, origin);
    }
  });

  test("refuses a different scheme, in both directions", () => {
    assert.equal(isSameOrigin(make({ origin: "http://buglab.example" }, { url: "https://buglab.example" })), false);
    assert.equal(isSameOrigin(make({ origin: "https://buglab.example" }, { url: "http://buglab.example" })), false);
  });

  test("refuses a different host: another site, a subdomain, a look-alike, an IP", () => {
    for (const origin of ["https://evil.example", "http://sub.localhost:3000", "http://localhost.evil.example:3000", "http://127.0.0.1:3000", "http://LOCALHOST.evil.example:3000"]) {
      assert.equal(isSameOrigin(make({ origin })), false, origin);
    }
  });

  test("refuses a different port, including a missing one", () => {
    for (const origin of ["http://localhost:3001", "http://localhost", "http://localhost:30000", "http://localhost:300"]) {
      assert.equal(isSameOrigin(make({ origin })), false, origin);
    }
  });

  test("refuses a malformed, opaque or smuggled Origin", () => {
    for (const origin of ["null", "not a url", "http://", "//localhost:3000", "localhost:3000", "http://localhost:3000, http://evil.example", "http://localhost:3000@evil.example"]) {
      assert.equal(isSameOrigin(make({ origin })), false, origin);
    }
  });

  test("refuses an Origin that carries credentials, even though it parses to our own origin", () => {
    // `new URL("http://evil.example@localhost:3000").origin` is `http://localhost:3000`: the part in front of
    // the `@` is dropped. A browser never sends credentials in an Origin, so the header is forged or mangled.
    for (const origin of [
      "http://evil.example@localhost:3000",
      "http://user:pass@localhost:3000",
      "http://evil.example:secret@localhost:3000",
      "http://:pass@localhost:3000",
      "http://%65vil.example@localhost:3000",
      "http://localhost@localhost:3000",
      "http://localhost:3000@localhost:3000",
      "http://@@localhost:3000", // parses with the username "%40"
      "http://evil.example@localhost:3000/",
      "HTTP://EVIL.EXAMPLE@LOCALHOST:3000",
    ]) {
      assert.equal(isSameOrigin(make({ origin })), false, origin);
    }
  });

  test("refuses empty credentials too: an `@` with nothing in front of it is still not a serialized origin", () => {
    for (const origin of ["http://@localhost:3000", "http://:@localhost:3000"]) {
      assert.equal(new URL(origin).username + new URL(origin).password, "", `${origin} parses with no credentials`);
      assert.equal(isSameOrigin(make({ origin })), false, origin);
    }
  });

  test("an `@` anywhere in the Origin is refused: a serialized origin is scheme://host[:port] and has none", () => {
    assert.equal(isSameOrigin(make({ origin: "http://localhost:3000/a@b" })), false);
    assert.equal(isSameOrigin(make({ origin: "http://localhost:3000?x=@" })), false);
    assert.equal(isSameOrigin(make({ origin: "http://localhost:3000#@" })), false);
  });

  test("credentials are refused over HTTPS and with a port too", () => {
    const cases: Array<[string, string]> = [
      ["https://buglab.example", "https://evil.example@buglab.example"],
      ["https://buglab.example", "https://user:pass@buglab.example"],
      ["https://buglab.example:8443", "https://evil.example@buglab.example:8443"],
      ["https://buglab.example", "https://evil.example@buglab.example:443"],
    ];
    for (const [url, origin] of cases) {
      assert.equal(isSameOrigin(make({ origin }, { url })), false, `${origin} against ${url}`);
    }
  });

  test("Sec-Fetch-Site cannot rescue a credential-bearing Origin, and the same Origin without credentials is accepted", () => {
    const credentials = "http://evil.example@localhost:3000";

    assert.equal(isSameOrigin(make({ origin: credentials, "sec-fetch-site": "same-origin" })), false);
    assert.equal(isSameOrigin(make({ origin: credentials, "sec-fetch-site": "none" })), false);
    assert.equal(isSameOrigin(make({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" })), true);
    assert.equal(isSameOrigin(make({ origin: "http://localhost:3000" })), true);
  });

  test("tightening for credentials changes nothing else: ordinary origins, case and default ports still pass", () => {
    assert.equal(isSameOrigin(make({ origin: "HTTP://LOCALHOST:3000" })), true, "scheme and host are case-insensitive");
    assert.equal(isSameOrigin(make({ origin: "https://BugLab.Example:443" }, { url: "https://buglab.example" })), true);
    assert.equal(isSameOrigin(make({ origin: "http://sub-domain.buglab.example:8080" }, { url: "http://sub-domain.buglab.example:8080" })), true);
    assert.equal(isSameOrigin(make({ origin: "http://[::1]:3000" }, { url: "http://[::1]:3000" })), true, "an IPv6 host has no @ and passes");
  });

  test("the Host header cannot vouch for an Origin: the request's own URL decides", () => {
    assert.equal(isSameOrigin(make({ host: "evil.example", origin: "http://evil.example" })), false);
    assert.equal(isSameOrigin(make({ host: "evil.example", origin: URL_BASE })), true, "a forged Host does not break a genuine same-origin request");
  });

  test("with no Origin (or an empty one), only Sec-Fetch-Site: same-origin passes", () => {
    for (const origin of [undefined, ""]) {
      const base: Record<string, string> = origin === undefined ? {} : { origin };
      const noOrigin = (extra: Record<string, string>) => {
        const request = make({ ...base, ...extra });
        if (origin === undefined) request.headers.delete("origin");
        return isSameOrigin(request);
      };
      assert.equal(noOrigin({ "sec-fetch-site": "same-origin" }), true);
      for (const proof of ["same-site", "cross-site", "none", "", "SAME-ORIGIN", "same-origin, cross-site"]) {
        assert.equal(noOrigin({ "sec-fetch-site": proof }), false, proof);
      }
      assert.equal(noOrigin({}), false, "no proof at all");
    }
  });

  test("a present Origin is always validated: Sec-Fetch-Site cannot rescue a bad one, and a non-same-origin one condemns a good one", () => {
    // Syeda's shared helper: Fetch Metadata other than same-origin is a contradiction and is refused.
    assert.equal(isSameOrigin(make({ origin: "https://evil.example", "sec-fetch-site": "same-origin" })), false);
    assert.equal(isSameOrigin(make({ origin: "null", "sec-fetch-site": "same-origin" })), false);
    assert.equal(isSameOrigin(make({ origin: URL_BASE, "sec-fetch-site": "same-origin" })), true);
    for (const site of ["cross-site", "same-site", "none", "bogus"]) {
      assert.equal(isSameOrigin(make({ origin: URL_BASE, "sec-fetch-site": site })), false, site);
    }
  });
});

describe("isSameOrigin: a configured application origin (BUGLAB_APP_ORIGIN)", () => {
  const APP = "https://buglab.example";
  /** What the app sees behind a TLS-terminating proxy: the upstream URL, with the browser's real Origin. */
  const behindProxy = { url: "http://127.0.0.1:3000" };
  const make2 = (headers: Record<string, string>, options = behindProxy) => make({ origin: APP, ...headers }, options);

  test("the real origin is accepted even though the request URL is the proxy's upstream", () => {
    assert.equal(isSameOrigin(make2({}), APP), true);
    assert.equal(isSameOrigin(make2({ origin: "https://BUGLAB.EXAMPLE" }), APP), true, "case");
    assert.equal(isSameOrigin(make2({ origin: "https://buglab.example:443" }), APP), true, "explicit default port");
    assert.equal(isSameOrigin(make2({ "sec-fetch-site": "same-origin" }), APP), true);
  });

  test("with nothing configured the same request is refused: the request's own URL is not the browser's origin", () => {
    assert.equal(isSameOrigin(make2({})), false);
    assert.equal(isSameOrigin(make2({}), null), false);
  });

  test("other origins, schemes and ports are refused, whatever the request URL says", () => {
    for (const origin of ["https://evil.example", "http://buglab.example", "https://buglab.example:8443", "https://sub.buglab.example", "https://buglab.example.evil.example"]) {
      assert.equal(isSameOrigin(make2({ origin }), APP), false, origin);
    }
    // The request's own URL is not trusted either: an Origin equal to the proxy's upstream is not the app's origin.
    assert.equal(isSameOrigin(make2({ origin: "http://127.0.0.1:3000" }), APP), false);
  });

  test("Host and the forwarded headers are never consulted, in either direction", () => {
    assert.equal(isSameOrigin(make2({ origin: "https://evil.example", host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }), APP), false);
    assert.equal(isSameOrigin(make2({ host: "127.0.0.1:3000", "x-forwarded-host": "other.example", "x-forwarded-proto": "http" }), APP), true);
  });

  test("credentials, including empty ones, are refused even though they normalize to the app origin", () => {
    for (const origin of ["https://evil.example@buglab.example", "https://user:pass@buglab.example", "https://@buglab.example", "https://:@buglab.example"]) {
      assert.equal(isSameOrigin(make2({ origin }), APP), false, origin);
      assert.equal(isSameOrigin(make2({ origin, "sec-fetch-site": "same-origin" }), APP), false, `${origin} with Fetch Metadata`);
    }
  });

  test("an invalid Origin is refused whatever Sec-Fetch-Site says", () => {
    for (const origin of ["null", "garbage", "https://", "https://buglab.example/", "ftp://buglab.example"]) {
      for (const site of [undefined, "same-origin", "cross-site"]) {
        const headers: Record<string, string> = { origin };
        if (site) headers["sec-fetch-site"] = site;
        assert.equal(isSameOrigin(make2(headers), APP), false, `${origin} / ${site}`);
      }
    }
  });

  test("with no Origin, a configured origin changes nothing: only Sec-Fetch-Site: same-origin passes, a headerless write never does", () => {
    const headerless = () => {
      const request = make({}, behindProxy);
      request.headers.delete("origin");
      return request;
    };
    assert.equal(isSameOrigin(headerless(), APP), false);
    for (const site of ["same-site", "cross-site", "none", ""]) {
      const request = headerless();
      request.headers.set("sec-fetch-site", site);
      assert.equal(isSameOrigin(request, APP), false, site);
    }
    const proven = headerless();
    proven.headers.set("sec-fetch-site", "same-origin");
    assert.equal(isSameOrigin(proven, APP), true);
  });
});

describe("isPrefetch", () => {
  test("detects Sec-Purpose and the old Purpose header, in any case and inside a list", () => {
    const prefetches: Array<Record<string, string>> = [{ "sec-purpose": "prefetch" }, { "sec-purpose": "prefetch;prerender" }, { purpose: "Prefetch" }, { "sec-purpose": "PREFETCH" }];
    for (const headers of prefetches) {
      assert.equal(isPrefetch(make(headers)), true, JSON.stringify(headers));
    }
  });

  test("a request with neither header, or another purpose, is not a prefetch", () => {
    assert.equal(isPrefetch(make()), false);
    assert.equal(isPrefetch(make({ "sec-purpose": "navigate" })), false);
    assert.equal(isPrefetch(make({ purpose: "preview" })), false);
  });
});

describe("readBoundedBody", () => {
  test("returns the text of a body within the cap, and the empty string for no body", async () => {
    assert.equal(await readBoundedBody(make({}, { body: '{"a":1}' }), 100), '{"a":1}');
    assert.equal(await readBoundedBody(new Request(`${URL_BASE}/x`, { method: "POST" }), 100), "");
  });

  test("a body of exactly the cap is accepted and one byte more is refused", async () => {
    assert.equal((await readBoundedBody(make({}, { body: "x".repeat(64) }), 64))?.length, 64);
    assert.equal(await readBoundedBody(make({}, { body: "x".repeat(65) }), 64), null);
  });

  test("the cap counts bytes, not characters", async () => {
    assert.equal((await readBoundedBody(make({}, { body: "é".repeat(500) }), 1000))?.length, 500);
    assert.equal(await readBoundedBody(make({}, { body: "é".repeat(501) }), 1000), null);
    assert.equal(await readBoundedBody(make({}, { body: "\u{1F600}".repeat(26) }), 100), null, "four bytes each");
  });

  test("decodes UTF-8 across the whole body", async () => {
    assert.equal(await readBoundedBody(make({}, { body: "naïve — 診断 \u{1F600}" }), 100), "naïve — 診断 \u{1F600}");
  });

  test("a declared length over the cap is refused without reading the body", async () => {
    const { body, state } = stream(1000, 512);

    const text = await readBoundedBody(make({ "content-length": "999999" }, { body }), 1024);

    assert.equal(text, null);
    assert.equal(state.pulled, 0, "the stream was never pulled");
  });

  test("a body with no declared length is read only up to the cap, then cancelled", async () => {
    const { body, state } = stream(1000, 512);

    const text = await readBoundedBody(make({}, { body }), 1024);

    assert.equal(text, null);
    assert.ok(state.pulled <= 4, `read ${state.pulled} chunks of a 1000-chunk body`);
    assert.equal(state.cancelled, true, "the rest of the upload was cancelled");
  });

  test("a body split into many chunks that adds up to exactly the cap is accepted", async () => {
    const { body } = stream(16, 64);

    assert.equal((await readBoundedBody(make({}, { body }), 1024))?.length, 1024);
  });

  test("a lying declared length does not widen the cap", async () => {
    const { body } = stream(4, 512);

    assert.equal(await readBoundedBody(make({ "content-length": "10" }, { body }), 1024), null);
  });
});

describe("checkWriteHeaders", () => {
  test("a same-origin JSON request passes", () => {
    assert.equal(checkWriteHeaders(make()), null);
  });

  test("each refusal is the documented status, code and message", () => {
    assert.deepEqual(checkWriteHeaders(make({ "content-type": "text/plain" })), {
      status: 415,
      code: "unsupported-media-type",
      message: "Content-Type must be application/json.",
    });
    assert.deepEqual(checkWriteHeaders(make({ origin: "https://evil.example" })), {
      status: 403,
      code: "forbidden",
      message: "Cross-origin requests are not allowed.",
    });
    assert.deepEqual(checkWriteHeaders(make({ "sec-purpose": "prefetch" })), {
      status: 403,
      code: "forbidden",
      message: "Prefetch requests are not allowed.",
    });
  });

  test("the checks run in order: content type, then origin, then prefetch", () => {
    const everythingWrong = make({ "content-type": "text/plain", origin: "https://evil.example", "sec-purpose": "prefetch" });
    assert.equal(checkWriteHeaders(everythingWrong)?.status, 415);

    const originAndPrefetch = make({ origin: "https://evil.example", "sec-purpose": "prefetch" });
    assert.match(checkWriteHeaders(originAndPrefetch)?.message ?? "", /Cross-origin/);
  });

  test("a supplied origin check replaces the strict one, and only that one", () => {
    const foreign = make({ origin: "https://evil.example" });
    assert.equal(checkWriteHeaders(foreign, () => true), null);
    assert.equal(checkWriteHeaders(make(), () => false)?.status, 403);
    assert.equal(checkWriteHeaders(make({ "content-type": "text/plain" }), () => true)?.status, 415, "the content type is still required");
    assert.equal(checkWriteHeaders(make({ "sec-purpose": "prefetch" }), () => true)?.status, 403, "a prefetch is still refused");
  });

  test("a credential-bearing Origin is a 403 forbidden, with the same message as any other foreign origin", () => {
    const expected = { status: 403, code: "forbidden", message: "Cross-origin requests are not allowed." };

    assert.deepEqual(checkWriteHeaders(make({ origin: "http://evil.example@localhost:3000" })), expected);
    assert.deepEqual(checkWriteHeaders(make({ origin: "http://user:pass@localhost:3000", "sec-fetch-site": "same-origin" })), expected);
  });

  test("the injected check receives the request itself", () => {
    const request = make();
    let received: Request | undefined;
    checkWriteHeaders(request, (candidate) => ((received = candidate), true));
    assert.equal(received, request);
  });
});

describe("readJsonObjectBody", () => {
  test("a JSON object comes back as is; an empty or blank body is {}", async () => {
    assert.deepEqual(await readJsonObjectBody(make({}, { body: '{"a":1,"b":[2]}' }), { maxBytes: 64 }), { ok: true, body: { a: 1, b: [2] } });
    for (const body of ["", "   ", "\n\t "]) {
      assert.deepEqual(await readJsonObjectBody(make({}, { body }), { maxBytes: 64 }), { ok: true, body: {} }, JSON.stringify(body));
    }
  });

  test("the cap is the caller's: the same body passes at one limit and is too large at a smaller one", async () => {
    const body = JSON.stringify({ text: "x".repeat(200) });
    assert.equal((await readJsonObjectBody(make({}, { body }), { maxBytes: 1024 })).ok, true);
    assert.deepEqual(await readJsonObjectBody(make({}, { body }), { maxBytes: 100 }), {
      ok: false,
      failure: { status: 400, code: "bad-request", message: "Request body is too large." },
    });
  });

  test("invalid JSON and non-objects are 400 bad-request with the session guard's own words", async () => {
    const refusals: Array<[string, string]> = [
      ["{", "Request body must be valid JSON."],
      ["not json", "Request body must be valid JSON."],
      ["[]", "Request body must be a JSON object."],
      ["null", "Request body must be a JSON object."],
      ['"text"', "Request body must be a JSON object."],
      ["7", "Request body must be a JSON object."],
    ];
    for (const [body, message] of refusals) {
      assert.deepEqual(
        await readJsonObjectBody(make({}, { body }), { maxBytes: 64 }),
        { ok: false, failure: { status: 400, code: "bad-request", message } },
        body,
      );
    }
  });

  test("it reads at most the cap from a stream, like readBoundedBody", async () => {
    const { body, state } = stream(100, 64);
    const result = await readJsonObjectBody(make({}, { body }), { maxBytes: 128 });
    assert.equal(result.ok, false);
    assert.ok(state.cancelled);
    assert.ok(state.pulled <= 4);
  });
});
describe("checkSmallJsonWrite", () => {
  test("the cap is 1 KiB", () => {
    assert.equal(SMALL_BODY_LIMIT_BYTES, 1024);
  });

  test("passes with no body, a blank body, an empty object or an object", async () => {
    for (const body of ["", "   \n ", "{}", '{"a":1}', ' {"a":[1,2]} ']) {
      assert.equal(await checkSmallJsonWrite(make({}, { body })), null, JSON.stringify(body));
    }
  });

  test("a JSON object of exactly 1 KiB passes and one byte more is refused", async () => {
    const exact = JSON.stringify({ p: "x".repeat(SMALL_BODY_LIMIT_BYTES - 8) });
    assert.equal(exact.length, SMALL_BODY_LIMIT_BYTES);

    assert.equal(await checkSmallJsonWrite(make({}, { body: exact })), null);
    assert.deepEqual(await checkSmallJsonWrite(make({}, { body: `${exact} ` })), {
      status: 400,
      code: "bad-request",
      message: "Request body is too large.",
    });
  });

  test("a body that is not valid JSON, or not an object, is a 400 with its own message", async () => {
    const expected: Array<[string, string]> = [
      ["{nope", "Request body must be valid JSON."],
      ["{", "Request body must be valid JSON."],
      ["[1]", "Request body must be a JSON object."],
      ['"x"', "Request body must be a JSON object."],
      ["5", "Request body must be a JSON object."],
      ["true", "Request body must be a JSON object."],
      ["null", "Request body must be a JSON object."],
    ];
    for (const [body, message] of expected) {
      assert.deepEqual(await checkSmallJsonWrite(make({}, { body })), { status: 400, code: "bad-request", message }, body);
    }
  });

  test("a credential-bearing Origin is refused before the body is read", async () => {
    const { body, state } = stream(10, 64);

    const refused = await checkSmallJsonWrite(make({ origin: "http://evil.example@localhost:3000" }, { body }));

    assert.deepEqual(refused, { status: 403, code: "forbidden", message: "Cross-origin requests are not allowed." });
    assert.equal(state.pulled, 0);
  });

  test("header refusals come first, and the body is not read at all", async () => {
    const { body, state } = stream(10, 64);

    const refused = await checkSmallJsonWrite(make({ "content-type": "text/plain" }, { body }));

    assert.equal(refused?.status, 415);
    assert.equal(state.pulled, 0);
  });

  test("an oversized upload with no declared length is cut off at the cap", async () => {
    const { body, state } = stream(1000, 512);

    const refused = await checkSmallJsonWrite(make({}, { body }));

    assert.equal(refused?.status, 400);
    assert.ok(state.pulled <= 4, `read ${state.pulled} chunks`);
  });
});
