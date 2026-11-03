import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, mock, test } from "node:test";
import {
  hashSessionToken,
  isTokenHash,
  issueSessionToken,
  parseSessionToken,
  SESSION_TOKEN_BYTES,
  SESSION_TOKEN_LENGTH,
} from "@/server/session/token";

afterEach(() => mock.restoreAll());

// A fixed, valid token (32 bytes of 0x61 'a', base64url) so hashes can be checked against a known value.
const FIXED_TOKEN = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE";

describe("issueSessionToken: format", () => {
  test("a token is 43 base64url characters carrying exactly 256 bits", () => {
    const { token } = issueSessionToken();

    assert.equal(SESSION_TOKEN_BYTES, 32);
    assert.equal(token.length, SESSION_TOKEN_LENGTH);
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/, "URL-safe alphabet, no padding");
    assert.equal(Buffer.from(token, "base64url").length, 32);
  });

  test("a token is in canonical form, so it round-trips through the parser", () => {
    for (let i = 0; i < 200; i++) {
      const { token } = issueSessionToken();

      assert.equal(parseSessionToken(token), token);
    }
  });

  test("every call produces a different token and a different hash", () => {
    const tokens = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const issued = issueSessionToken();
      tokens.add(issued.token);
      hashes.add(issued.tokenHash);
    }

    assert.equal(tokens.size, 2000);
    assert.equal(hashes.size, 2000);
  });

  test("tokens use the whole alphabet, which a constant or low-entropy generator would not", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      // The last character carries only 4 bits, so leave it out of the alphabet check.
      for (const char of issueSessionToken().token.slice(0, -1)) seen.add(char);
    }

    assert.equal(seen.size, 64);
  });
});

describe("hashSessionToken", () => {
  test("is the SHA-256 of the token's text, as 64 lowercase hex characters", () => {
    const { token, tokenHash } = issueSessionToken();

    assert.equal(tokenHash, createHash("sha256").update(token, "utf8").digest("hex"));
    assert.match(tokenHash, /^[0-9a-f]{64}$/);
    assert.ok(isTokenHash(tokenHash));
  });

  test("matches a known value", () => {
    const token = parseSessionToken(FIXED_TOKEN);
    assert.ok(token, "the fixed test token must be valid");

    assert.equal(
      hashSessionToken(token),
      createHash("sha256").update(FIXED_TOKEN).digest("hex"),
    );
  });

  test("is consistent: the same token always hashes the same way", () => {
    const { token, tokenHash } = issueSessionToken();

    assert.equal(hashSessionToken(token), tokenHash);
    assert.equal(hashSessionToken(token), hashSessionToken(token));
  });

  test("different tokens hash differently, and the hash does not contain the token", () => {
    const a = issueSessionToken();
    const b = issueSessionToken();

    assert.notEqual(a.tokenHash, b.tokenHash);
    assert.ok(!a.tokenHash.includes(a.token));
    assert.ok(!a.token.includes(a.tokenHash));
  });
});

describe("parseSessionToken: untrusted input", () => {
  test("accepts the exact form that is issued", () => {
    assert.equal(parseSessionToken(FIXED_TOKEN), FIXED_TOKEN);
  });

  test("rejects anything that is not a string", () => {
    for (const value of [undefined, null, 0, 1, true, {}, [], [FIXED_TOKEN], Buffer.from(FIXED_TOKEN)]) {
      assert.equal(parseSessionToken(value), null);
    }
  });

  test("rejects the wrong length, padding, other alphabets and whitespace", () => {
    const rejected = [
      "",
      FIXED_TOKEN.slice(1),
      FIXED_TOKEN + "A",
      FIXED_TOKEN.slice(0, -1) + "=",
      ` ${FIXED_TOKEN.slice(1)}`,
      `${FIXED_TOKEN}\n`,
      FIXED_TOKEN.slice(0, -1) + "+",
      FIXED_TOKEN.slice(0, -1) + "/",
      FIXED_TOKEN.slice(0, -1) + "é",
    ];
    for (const value of rejected) assert.equal(parseSessionToken(value), null, JSON.stringify(value));
  });

  test("rejects a non-canonical spelling of the same bytes", () => {
    // The last character of a 32-byte token carries 4 bits, so some other last characters decode to the same bytes.
    const alternative = FIXED_TOKEN.slice(0, -1) + "F";

    assert.equal(Buffer.from(alternative, "base64url").equals(Buffer.from(FIXED_TOKEN, "base64url")), true);
    assert.equal(parseSessionToken(alternative), null);
  });

  test("does not accept a token hash in place of a token", () => {
    const { tokenHash } = issueSessionToken();

    assert.equal(parseSessionToken(tokenHash), null);
  });
});

describe("isTokenHash", () => {
  test("accepts only 64 lowercase hex characters", () => {
    const { tokenHash, token } = issueSessionToken();

    assert.equal(isTokenHash(tokenHash), true);
    assert.equal(isTokenHash(tokenHash.toUpperCase()), false);
    assert.equal(isTokenHash(tokenHash.slice(1)), false);
    assert.equal(isTokenHash(`${tokenHash}0`), false);
    assert.equal(isTokenHash(`${tokenHash.slice(1)}g`), false);
    assert.equal(isTokenHash(token), false, "a raw token is never a hash");
    assert.equal(isTokenHash(""), false);
    assert.equal(isTokenHash(undefined), false);
    assert.equal(isTokenHash(null), false);
    assert.equal(isTokenHash(123), false);
  });
});

describe("token handling: logging", () => {
  test("issuing, hashing and parsing write nothing to the console", () => {
    const calls = (["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
      mock.method(console, method, () => {}),
    );

    const { token } = issueSessionToken();
    hashSessionToken(token);
    parseSessionToken(token);
    parseSessionToken("not a token");

    assert.deepEqual(
      calls.map((call) => call.mock.callCount()),
      [0, 0, 0, 0, 0, 0],
    );
  });
});
