/*
 * The content version of a challenge. Server-only.
 *
 *   <revision>+<fingerprint>      for example  1+3f9a1c2b7d4e
 *
 * The fingerprint is a SHA-256 over the canonical public view, so any edit to what
 * a learner sees changes the version without anyone remembering to bump it. The
 * revision covers what the public view cannot show, such as a corrected answer key.
 *
 * The private evaluation configuration is deliberately NOT hashed. The version is
 * recorded on a learner's session and returned to them, and the rest of the content
 * is public, so a hash that included the answer would let anyone test the few
 * possible answers offline.
 */
import "server-only";
import { createHash } from "node:crypto";

const FINGERPRINT_LENGTH = 12;

/** JSON with object keys sorted and `undefined` dropped, so equal content always serializes equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function contentVersionOf(revision: string, publicContent: unknown): string {
  const fingerprint = createHash("sha256").update(canonicalJson(publicContent)).digest("hex");
  return `${revision}+${fingerprint.slice(0, FINGERPRINT_LENGTH)}`;
}
