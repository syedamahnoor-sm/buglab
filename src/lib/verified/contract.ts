/*
 * The proposed contract for listing a learner's verified completions. It is
 * not mounted: Habin's backend has no such route yet. This is what the
 * frontend expects, so the endpoint can be built to it and checked against
 * tests/verified (fixtures plus the real session handlers' views and errors).
 *
 *   GET /api/learner/completions        same-origin, the HttpOnly learner cookie
 *
 *   200  { "learner": { "state": "active" },
 *          "completions": [ { "challengeId", "completedAt", "contentVersion" }, ... ] }
 *        Each entry is a completed challenge session, as the session view
 *        reports it (challengeId, completedAt, contentVersion). Nothing else
 *        is needed; anything else sent is ignored, and the completion details
 *        (resolution, feedback, submission) are never read.
 *   200  { "learner": { "state": "none" | "expired" }, "completions": [] }
 *        also accepted, as GET /api/learner reports learner state.
 *   401  { "code": "learner-missing" | "learner-expired", "message" }
 *        the existing session handlers' errors for no learner or an expired one.
 *   404  the route is not mounted (today), 429 rate-limited, 5xx server error.
 */
import type { ChallengeSession } from "@/types/learner-session";
import { normaliseCompletions, type UnavailableReason, type VerifiedCompletion, type VerifiedState } from "./model";

export const COMPLETIONS_PATH = "/api/learner/completions";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A response from the completions endpoint as a verified state. Never throws. */
export function parseCompletionsResponse(status: number, body: unknown, publishedIds: ReadonlySet<string>): VerifiedState {
  if (status === 200) {
    if (!isRecord(body) || !isRecord(body.learner) || !Array.isArray(body.completions)) return unavailable("invalid-response");
    const state = body.learner.state;
    if (state === "none") return { status: "no-learner" };
    if (state === "expired") return { status: "expired" };
    if (state !== "active") return unavailable("invalid-response");
    return { status: "ready", completions: normaliseCompletions(body.completions, publishedIds) };
  }
  if (status === 401) {
    const code = isRecord(body) ? body.code : undefined;
    return code === "learner-expired" ? { status: "expired" } : { status: "no-learner" };
  }
  if (status === 404) return unavailable("not-found");
  if (status === 403) return unavailable("refused");
  if (status === 429) return unavailable("rate-limited");
  if (status >= 500) return unavailable("server");
  return unavailable("invalid-response");
}

const unavailable = (reason: UnavailableReason): VerifiedState => ({ status: "unavailable", reason });

/**
 * The completion a completed session view stands for, as the endpoint would
 * list it; null for an unfinished session. Only the three kept fields are
 * read, never the session's completion details.
 */
export function completionOfSession(session: ChallengeSession): VerifiedCompletion | null {
  if (session.status !== "completed" || !session.completedAt) return null;
  return { challengeId: session.challengeId, completedAt: session.completedAt, contentVersion: session.contentVersion };
}
