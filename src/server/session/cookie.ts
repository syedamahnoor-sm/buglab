/*
 * The learner cookie. Server-only.
 *
 * One cookie for the whole product, because one anonymous learner spans every
 * challenge. It holds only the opaque token. HttpOnly keeps it from scripts and
 * SameSite=Strict keeps it from cross-site requests. Secure is added when the
 * request itself came over HTTPS, as the diagnosis endpoint does for its own
 * cookie, so local HTTP development keeps working. The path is /api because only
 * the API needs the identity.
 */
import "server-only";

export const LEARNER_COOKIE = "buglab_learner";

/** What a caller must send back to the browser to set or refresh the cookie. */
export interface IssuedCookie {
  /** The raw token. This is the only place it leaves the service. */
  readonly value: string;
  /** Never outlives the learner's own expiry. */
  readonly maxAgeSeconds: number;
}

/** The learner cookie's value from a Cookie header, or null. It is untrusted until parsed. */
export function readLearnerCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === LEARNER_COOKIE) return part.slice(separator + 1).trim();
  }
  return null;
}

export function serializeLearnerCookie(cookie: IssuedCookie, secure: boolean): string {
  return [
    `${LEARNER_COOKIE}=${cookie.value}`,
    "Path=/api",
    `Max-Age=${cookie.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
