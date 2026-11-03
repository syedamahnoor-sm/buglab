/*
 * Session token generation and hashing. Server-only.
 *
 * The token is a 256-bit random value, base64url-encoded, used purely as a lookup
 * handle: it carries no claims and is not signed, so there is no secret key to
 * manage. The browser holds the token and the store holds only its SHA-256 hash,
 * so a leaked table cannot be replayed as cookies. A fast hash is right here
 * because the input is high-entropy and random, not a password.
 *
 * There is no secret comparison in this module or in the stores: lookups are by
 * the hash of the token, never by comparing a token to a stored token, so there
 * is nothing for a timing attack to measure. If a direct comparison of secrets is
 * ever needed, use crypto.timingSafeEqual.
 *
 * Nothing here logs. Never add logging that could print a token.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SessionToken, TokenHash } from "./types";

export const SESSION_TOKEN_BYTES = 32;

/** 32 bytes in base64url without padding: ceil(32 * 8 / 6) characters. */
export const SESSION_TOKEN_LENGTH = 43;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface IssuedSessionToken {
  /** The raw token. Hand it only to the code that sets the cookie. */
  readonly token: SessionToken;
  /** What the store keeps. */
  readonly tokenHash: TokenHash;
}

/** SHA-256 of the token's text, as 64 lowercase hex characters. */
export function hashSessionToken(token: SessionToken): TokenHash {
  return createHash("sha256").update(token, "utf8").digest("hex") as TokenHash;
}

/** Creates a new random token and its hash. Only the server ever calls this. */
export function issueSessionToken(): IssuedSessionToken {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url") as SessionToken;
  return { token, tokenHash: hashSessionToken(token) };
}

/**
 * Accepts an untrusted value (a cookie, for example) only if it has exactly the
 * form issueSessionToken produces. It does not say whether the token is known.
 * Non-canonical encodings of the same bytes are rejected, so each token has one
 * spelling.
 */
export function parseSessionToken(value: unknown): SessionToken | null {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== SESSION_TOKEN_BYTES || bytes.toString("base64url") !== value) return null;
  return value as SessionToken;
}

export function isTokenHash(value: unknown): value is TokenHash {
  return typeof value === "string" && TOKEN_HASH_PATTERN.test(value);
}
