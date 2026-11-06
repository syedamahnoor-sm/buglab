/*
 * Opaque pagination cursors for the journal, activity, and completions reads. Server-only.
 *
 * A cursor is base64url(JSON) of the last returned item's sort key. It never carries a learner id.
 * Journal and activity keys use reflection/activity fields only. The completions cursor carries
 * completedAt plus the session id as an internal tie-break position; that session id is not part
 * of the HTTP completion payload. Cursors are not secrets and are not signed: they only say
 * "continue strictly after this position" in the caller's OWN data, so a forged one can at worst
 * move the caller within their own list. Decoding is strict and returns null for anything
 * malformed, of the wrong kind (a journal cursor is not a completions cursor), oversized or not
 * in canonical base64url form; the service turns null into `invalid-cursor` (400 bad-request).
 */
import "server-only";
import { KNOWN_RANKS } from "./derive";
import type { ReflectionKey } from "./types";

const MAX_CURSOR_CHARS = 1024;
const MAX_KEY_CHARS = 128;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The sort key of the last journal row returned: a position in journal order, the same shape the store pages by. */
export type JournalCursor = ReflectionKey;
export type ActivityCursor = { occurredAt: number; kindRank: number; sourceId: string };
/** Position in a completions list: completedAt DESC, session id ASC. No learner id. */
export type CompletionCursor = { completedAt: number; sessionId: string };

const COMPLETION_CURSOR_KEYS = new Set(["v", "k", "t", "i"]);

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isKey = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= MAX_KEY_CHARS;

const encode = (payload: object): string => Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

function decode(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_CURSOR_CHARS) return null;
  if (!BASE64URL.test(token)) return null;
  const bytes = Buffer.from(token, "base64url");
  if (bytes.toString("base64url") !== token) return null; // non-canonical or truncated
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

export function encodeJournalCursor(cursor: JournalCursor): string {
  return encode({ v: 1, k: "j", u: cursor.updatedAt, c: cursor.challengeId, i: cursor.id });
}

export function decodeJournalCursor(token: unknown): JournalCursor | null {
  const p = decode(token);
  if (!p || p.v !== 1 || p.k !== "j" || !isTime(p.u) || !isKey(p.c) || !isKey(p.i)) return null;
  return { updatedAt: p.u, challengeId: p.c, id: p.i };
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return encode({ v: 1, k: "a", o: cursor.occurredAt, r: cursor.kindRank, s: cursor.sourceId });
}

export function decodeActivityCursor(token: unknown): ActivityCursor | null {
  const p = decode(token);
  if (!p || p.v !== 1 || p.k !== "a" || !isTime(p.o) || typeof p.r !== "number" || !KNOWN_RANKS.has(p.r) || !isKey(p.s)) {
    return null;
  }
  return { occurredAt: p.o, kindRank: p.r, sourceId: p.s };
}

export function encodeCompletionCursor(cursor: CompletionCursor): string {
  return encode({ v: 1, k: "c", t: cursor.completedAt, i: cursor.sessionId });
}

export function decodeCompletionCursor(token: unknown): CompletionCursor | null {
  const p = decode(token);
  if (!p || p.v !== 1 || p.k !== "c" || !isTime(p.t) || !isKey(p.i)) return null;
  if (Object.keys(p).some((key) => !COMPLETION_CURSOR_KEYS.has(key))) return null;
  return { completedAt: p.t, sessionId: p.i };
}
