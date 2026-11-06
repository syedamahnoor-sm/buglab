/*
 * Completions from both origins, side by side:
 *
 *   browser   an observed solve in this browser's learning record
 *   server    a verified completion from BugLab's server (when connected)
 *
 * A challenge is "completed" (for counts and recommendation eligibility) when
 * either origin reports it. It is "verified" only when the server does: a
 * browser solve never becomes verified, however it looks. Each origin's data
 * is kept as it came, so a conflict (for example a browser solve the server
 * has no completion for, or different times) is visible, never overwritten.
 * Only published challenges are included.
 */
import type { ObservedSolve } from "@/lib/learning/model";
import type { VerifiedCompletion } from "@/lib/verified/model";
import type { PublicChallenge } from "@/types/catalog";
import type { ProgressSource } from "./source";

export type CompletionClass =
  /** Observed in this browser; the server has not confirmed it (or is not connected). */
  | "browser-only"
  /** Confirmed by the server and also observed in this browser. */
  | "verified"
  /** Confirmed by the server, never observed in this browser (another device, or cleared data). */
  | "verified-elsewhere";

export interface ChallengeCompletion {
  challengeId: string;
  classification: CompletionClass;
  verified: boolean;
  browser: ObservedSolve | null;
  server: VerifiedCompletion | null;
}

export interface CompletionSummary {
  byId: ReadonlyMap<string, ChallengeCompletion>;
  /** Completed by either origin. */
  completed: number;
  verified: number;
  browserOnly: number;
  verifiedElsewhere: number;
  /** True when verified completions were read from the server (state "ready"). */
  verificationAvailable: boolean;
}

function classify(browser: ObservedSolve | null, server: VerifiedCompletion | null): CompletionClass | null {
  if (server) return browser ? "verified" : "verified-elsewhere";
  return browser ? "browser-only" : null;
}

export function mergeCompletions(source: ProgressSource, published: readonly PublicChallenge[]): CompletionSummary {
  const publishedIds = new Set(published.map((challenge) => challenge.id));
  const server = new Map<string, VerifiedCompletion>();
  const available = source.verified.status === "ready";
  if (source.verified.status === "ready") {
    for (const completion of source.verified.completions) {
      if (!publishedIds.has(completion.challengeId)) continue;
      const seen = server.get(completion.challengeId);
      if (!seen || completion.completedAt < seen.completedAt) server.set(completion.challengeId, completion);
    }
  }

  const byId = new Map<string, ChallengeCompletion>();
  for (const id of publishedIds) {
    const browser = Object.hasOwn(source.record.solves, id) ? source.record.solves[id] : null;
    const verified = server.get(id) ?? null;
    const classification = classify(browser, verified);
    if (classification) byId.set(id, { challengeId: id, classification, verified: verified !== null, browser, server: verified });
  }

  const count = (kind: CompletionClass) => [...byId.values()].filter((entry) => entry.classification === kind).length;
  return {
    byId,
    completed: byId.size,
    verified: count("verified") + count("verified-elsewhere"),
    browserOnly: count("browser-only"),
    verifiedElsewhere: count("verified-elsewhere"),
    verificationAvailable: available,
  };
}

/** Completed by either origin: what recommendations skip. */
export const isCompleted = (summary: CompletionSummary, challengeId: string) => summary.byId.has(challengeId);

/** Confirmed by the server. */
export const isVerified = (summary: CompletionSummary, challengeId: string) => summary.byId.get(challengeId)?.verified === true;
