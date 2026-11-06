/*
 * Server-verified completions: challenges BugLab's server recorded as
 * completed for the current learner. A completion is verified only when the
 * server says so; nothing in this browser can make one.
 *
 * Kept apart from the browser's learning record (lib/learning), which holds
 * observed solves ("source: browser"). Neither is copied into the other.
 *
 * A completion keeps three fields and nothing else. The server's session view
 * also carries what the learner was shown on completing (the resolution
 * summary, derived from the answer key); that is never kept here.
 */

export interface VerifiedCompletion {
  challengeId: string;
  /** When the server recorded the correct diagnosis (ISO 8601). */
  completedAt: string;
  /** The content version the completed session was started at. */
  contentVersion: string;
}

/** Why verified completions could not be read. */
export type UnavailableReason = "not-found" | "network" | "timeout" | "server" | "rate-limited" | "refused" | "invalid-response" | "unsupported-browser";

export type VerifiedState =
  /** No server source is connected (today's production setting). */
  | { status: "not-connected" }
  | { status: "loading" }
  /** No learner session: nothing has been verified for this browser. */
  | { status: "no-learner" }
  /** The learner session expired; its completions cannot be read until a new one starts. */
  | { status: "expired" }
  | { status: "unavailable"; reason: UnavailableReason }
  | { status: "ready"; completions: readonly VerifiedCompletion[] };

export const NOT_CONNECTED: VerifiedState = Object.freeze({ status: "not-connected" });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const isInstant = (value: unknown): value is string => typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

/** One entry as the server sent it, reduced to the three kept fields, or null when it is not a valid completion. */
export function toVerifiedCompletion(value: unknown): VerifiedCompletion | null {
  if (!isRecord(value)) return null;
  const { challengeId, completedAt, contentVersion } = value;
  if (!isText(challengeId, 100) || !isInstant(completedAt) || !isText(contentVersion, 200)) return null;
  return { challengeId, completedAt, contentVersion };
}

/**
 * Valid completions for published challenges, one per challenge. Entries that
 * are malformed or for challenges not published are dropped, so nothing about
 * an unpublished challenge reaches the page. A duplicate keeps the earliest
 * completion (the first time the server recorded it).
 */
export function normaliseCompletions(entries: readonly unknown[], publishedIds: ReadonlySet<string>): VerifiedCompletion[] {
  const byId = new Map<string, VerifiedCompletion>();
  for (const entry of entries) {
    const completion = toVerifiedCompletion(entry);
    if (!completion || !publishedIds.has(completion.challengeId)) continue;
    const seen = byId.get(completion.challengeId);
    if (!seen || completion.completedAt < seen.completedAt) byId.set(completion.challengeId, completion);
  }
  return [...byId.values()].sort((a, b) => a.challengeId.localeCompare(b.challengeId));
}
