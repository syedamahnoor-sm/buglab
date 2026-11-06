/*
 * Where verified completions come from. Pages depend on this interface only.
 *
 * Production uses notConnectedSource: it makes no request and reports
 * "not-connected", because no completions endpoint is mounted. When Habin's
 * GET /api/learner/completions exists, an HTTP source (http-source.ts, built
 * to the contract in contract.ts) can be passed in its place.
 */
import { NOT_CONNECTED, type VerifiedState } from "./model";

export interface VerifiedCompletionsSource {
  /** "not-connected" sources answer at once and never touch the network. */
  readonly kind: "not-connected" | "http";
  /** Reads the learner's verified completions. Never throws, except to rethrow the caller's own abort. */
  load(signal?: AbortSignal): Promise<VerifiedState>;
}

export const notConnectedSource: VerifiedCompletionsSource = Object.freeze({
  kind: "not-connected" as const,
  load: () => Promise.resolve(NOT_CONNECTED),
});
