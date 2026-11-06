/*
 * A VerifiedCompletionsSource for the proposed GET /api/learner/completions
 * (contract.ts). Not used by any page: the route is not mounted. It exists so
 * the contract is exercised end to end in tests, and so connecting the real
 * endpoint later is a one-line change where the source is chosen.
 *
 * Same-origin credentials only (the learner cookie is HttpOnly and never read
 * here), a timeout, and every failure reported as a state, never thrown.
 */
import { createRequestAbort, UnsupportedBrowserError, type RequestAbort } from "@/lib/diagnosis/request-abort";
import { COMPLETIONS_PATH, parseCompletionsResponse } from "./contract";
import type { VerifiedState } from "./model";
import type { VerifiedCompletionsSource } from "./source";

const DEFAULT_TIMEOUT_MS = 15_000;

export function createHttpCompletionsSource(options: {
  /** IDs of published challenges: completions for anything else are dropped. */
  publishedIds: ReadonlySet<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): VerifiedCompletionsSource {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    kind: "http",
    async load(signal?: AbortSignal): Promise<VerifiedState> {
      let request: RequestAbort | undefined;
      try {
        request = createRequestAbort(timeoutMs, signal);
        const response = await fetchImpl(COMPLETIONS_PATH, { method: "GET", credentials: "same-origin", signal: request.signal });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch (error) {
          if (request.signal.aborted) throw error;
        }
        return parseCompletionsResponse(response.status, body, options.publishedIds);
      } catch (error) {
        if (error instanceof UnsupportedBrowserError) return { status: "unavailable", reason: "unsupported-browser" };
        if (signal?.aborted) throw error;
        return { status: "unavailable", reason: request?.timedOut() ? "timeout" : "network" };
      } finally {
        request?.dispose();
      }
    },
  };
}
