/*
 * Pure derivation helpers for the journal and activity reads (LL v1.3 §7-§8). Server-only.
 *
 * Nothing here is stored: the journal is the learner's active reflections and the activity feed
 * is their current completions plus active reflections, merged and ordered at read time.
 *
 * This module is the single home of the read-side rules the service and the stores share: the activity
 * kind ranks, the two orderings, text comparison, the paging pipeline (limit -> cursor -> page -> next
 * cursor) and the row builders. Nothing here does I/O.
 */
import "server-only";
import { createHash } from "node:crypto";
import type { ActivityCursor, JournalCursor } from "./cursors";
import type { ActivityStoreRow, LearningReflectionRecord } from "./types";

export const ACTIVITY_PREVIEW_BYTES = 120;
const ELLIPSIS = "…";

export const JOURNAL_DEFAULT_LIMIT = 20;
export const JOURNAL_MAX_LIMIT = 50;

export type ActivityKind = "challenge.completed" | "reflection.updated";
/** Kinds a client may ask for. Recall kinds are accepted but contribute nothing until recall persistence exists. */
export const RECALL_KINDS = ["recall.session.started", "recall.session.completed"] as const;
export const REQUESTABLE_KINDS: ReadonlySet<string> = new Set<string>([
  "challenge.completed",
  "reflection.updated",
  ...RECALL_KINDS,
]);

/** Tie-break rank of each activity kind inside one instant. The ONLY place ranks are defined. */
export const KIND_RANK: Readonly<Record<ActivityKind, number>> = {
  "challenge.completed": 10,
  "reflection.updated": 40,
};

/** Ranks reserved for the recall kinds (no rows exist for them yet), so a cursor carrying one stays valid later. */
const RECALL_RANK: Readonly<Record<(typeof RECALL_KINDS)[number], number>> = {
  "recall.session.started": 20,
  "recall.session.completed": 30,
};

/** Every rank an activity cursor may carry: derived from the two tables above, never repeated elsewhere. */
export const KNOWN_RANKS: ReadonlySet<number> = new Set([...Object.values(KIND_RANK), ...Object.values(RECALL_RANK)]);

/** Code-unit order, the same everywhere (the stores compare with COLLATE "C" to agree with it). */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** updatedAt DESC, challengeId ASC, id ASC. */
export function compareJournal(a: JournalCursor, b: JournalCursor): number {
  return b.updatedAt - a.updatedAt || compareText(a.challengeId, b.challengeId) || compareText(a.id, b.id);
}

/** occurredAt DESC, kindRank ASC, sourceId ASC. */
export function compareActivity(a: ActivityCursor, b: ActivityCursor): number {
  return b.occurredAt - a.occurredAt || a.kindRank - b.kindRank || compareText(a.sourceId, b.sourceId);
}

/* --------------------------------- Paging --------------------------------- */

export type PageOptions = { limit?: number; cursor?: string };

/** Default 20; larger values are clamped to 50; anything else that is not a positive integer is invalid (null). */
export function parseLimit(limit: unknown): number | null {
  if (limit === undefined) return JOURNAL_DEFAULT_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) return null;
  return Math.min(limit, JOURNAL_MAX_LIMIT);
}

/**
 * Step one of every list read: the page size and the position to continue after (null: the start). A refusal names
 * the rejection code. The cursor is decoded with the list's own decoder, so a journal cursor is not an activity cursor.
 */
export function readPageRequest<K>(
  options: PageOptions | undefined,
  decode: (token: unknown) => K | null,
): { limit: number; after: K | null } | { refused: "validation-failed" | "invalid-cursor" } {
  const limit = parseLimit(options?.limit);
  if (limit === null) return { refused: "validation-failed" };
  if (options?.cursor === undefined) return { limit, after: null };
  const after = decode(options.cursor);
  return after ? { limit, after } : { refused: "invalid-cursor" };
}

/**
 * Last step of every list read: `rows` are already in order and already past the cursor. The page is the first
 * `limit` of them; `last` is the row to encode as the next cursor, present only when more rows remain. A caller that
 * pages in the store asks it for `limit + 1` rows so that "more remain" can be told without a second query.
 */
export function takePage<T>(rows: readonly T[], limit: number): { page: T[]; last: T | null } {
  const page = rows.slice(0, limit);
  return { page, last: rows.length > limit ? page[page.length - 1]! : null };
}

/** The kinds a request asked for: all requestable data kinds when absent, otherwise a non-empty array of known kinds. Null if invalid. */
export function parseKinds(kinds: unknown): ReadonlySet<string> | null {
  if (kinds === undefined) return new Set<string>(Object.keys(KIND_RANK));
  if (!Array.isArray(kinds) || kinds.length === 0 || kinds.length > 16) return null;
  const wanted = new Set<string>();
  for (const kind of kinds) {
    if (typeof kind !== "string" || !REQUESTABLE_KINDS.has(kind)) return null;
    wanted.add(kind);
  }
  return wanted;
}

/* ------------------------------ Journal entry ------------------------------ */

/** One journal entry: a challenge-linked reflection. No learner or session id. */
export type JournalEntry = {
  readonly kind: "challenge-reflection";
  readonly reflectionId: string;
  readonly challengeId: string;
  readonly completedAt: string;
  readonly body: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

const iso = (ms: number): string => new Date(ms).toISOString();

export function toJournalEntry(record: LearningReflectionRecord): JournalEntry {
  return {
    kind: "challenge-reflection",
    reflectionId: record.id,
    challengeId: record.challengeId,
    completedAt: iso(record.completedAt),
    body: record.body,
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

export const journalKeyOf = (record: LearningReflectionRecord): JournalCursor => ({
  updatedAt: record.updatedAt,
  challengeId: record.challengeId,
  id: record.id,
});

/* ------------------------------ Activity rows ------------------------------ */

export type ActivityItem = {
  readonly itemKey: { readonly kind: "challenge.completed" | "reflection"; readonly sourceId: string };
  readonly kind: ActivityKind;
  readonly occurredAt: string;
  readonly challengeId: string;
  readonly summary: { readonly challengeId: string; readonly preview?: string };
};

/** An activity item with its sort key, so rows from both sources merge and page by one rule. */
export type ActivityRow = { key: ActivityCursor; item: ActivityItem };

/** A current completed session as the activity feed shows it. The session id only ever appears as a digest. */
export function completionRow(session: { sessionId: string; challengeId: string; completedAt: number }): ActivityRow {
  const sourceId = completionSourceId(session.sessionId);
  return {
    key: { occurredAt: session.completedAt, kindRank: KIND_RANK["challenge.completed"], sourceId },
    item: {
      itemKey: { kind: "challenge.completed", sourceId },
      kind: "challenge.completed",
      occurredAt: iso(session.completedAt),
      challengeId: session.challengeId,
      summary: { challengeId: session.challengeId },
    },
  };
}

/** An active reflection as the activity feed shows it: when it was last written, with a short preview. */
export function reflectionRow(record: LearningReflectionRecord): ActivityRow {
  return {
    key: { occurredAt: record.updatedAt, kindRank: KIND_RANK["reflection.updated"], sourceId: record.id },
    item: {
      itemKey: { kind: "reflection", sourceId: record.id },
      kind: "reflection.updated",
      occurredAt: iso(record.updatedAt),
      challengeId: record.challengeId,
      summary: { challengeId: record.challengeId, preview: previewOf(record.body) },
    },
  };
}

/** Maps a store-level activity row (PostgreSQL page or Memory equivalent) into the public activity shape. */
export function activityRowFromStore(row: ActivityStoreRow): ActivityRow {
  if (row.kind === "challenge.completed") {
    return {
      key: { occurredAt: row.occurredAt, kindRank: KIND_RANK["challenge.completed"], sourceId: row.sourceId },
      item: {
        itemKey: { kind: "challenge.completed", sourceId: row.sourceId },
        kind: "challenge.completed",
        occurredAt: iso(row.occurredAt),
        challengeId: row.challengeId,
        summary: { challengeId: row.challengeId },
      },
    };
  }
  return {
    key: { occurredAt: row.occurredAt, kindRank: KIND_RANK["reflection.updated"], sourceId: row.sourceId },
    item: {
      itemKey: { kind: "reflection", sourceId: row.sourceId },
      kind: "reflection.updated",
      occurredAt: iso(row.occurredAt),
      challengeId: row.challengeId,
      summary: { challengeId: row.challengeId, preview: previewOf(row.body ?? "") },
    },
  };
}

/**
 * ~120 UTF-8 bytes, cut only between whole code points (never inside a surrogate pair or a
 * multi-byte sequence). A body that fits is returned unchanged; otherwise it is cut so that the
 * result INCLUDING the ellipsis stays within the budget.
 */
export function previewOf(body: string, maxBytes: number = ACTIVITY_PREVIEW_BYTES): string {
  if (Buffer.byteLength(body, "utf8") <= maxBytes) return body;
  const budget = maxBytes - Buffer.byteLength(ELLIPSIS, "utf8");
  let used = 0;
  let out = "";
  for (const ch of body) {
    const size = Buffer.byteLength(ch, "utf8");
    if (used + size > budget) break;
    used += size;
    out += ch;
  }
  return out + ELLIPSIS;
}

/**
 * Stable, opaque dedupe id for a completion. The session id never leaves the server: this is a
 * one-way digest of it, namespaced so it cannot collide with another id space.
 */
export function completionSourceId(sessionId: string): string {
  return `cmp_${createHash("sha256").update(`learning-loop:challenge.completed:${sessionId}`).digest("base64url").slice(0, 32)}`;
}
