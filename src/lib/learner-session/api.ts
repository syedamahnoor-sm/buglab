/*
 * Typed client for the learner-session API. Browser-safe: it imports nothing
 * from src/server and never reads or stores the learner cookie, which is
 * HttpOnly and travels only as a same-origin credential.
 *
 * Not used by the UI yet: the routes it calls are not mounted (Phase 1).
 *
 *   GET  /api/learner                       learner state
 *   POST /api/learner                       create or resume the learner
 *   GET  /api/challenges/:id/session        the learner's session, or none
 *   POST /api/challenges/:id/session        start or resume (restarts an outdated one)
 *   GET  /api/challenges/:id/attempts       the learner's attempt history
 *   POST /api/challenges/:id/diagnosis      submit, with an Idempotency-Key
 *
 * Every call returns an ApiResult instead of throwing, except when the caller's
 * own AbortSignal aborts it: that rethrows, as the existing diagnosis client does.
 */
import { isDiagnosisResponse } from "@/lib/diagnosis/response";
import { createRequestAbort, UnsupportedBrowserError, type RequestAbort } from "@/lib/diagnosis/request-abort";
import type { DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";
import type {
  ApiError,
  ApiErrorKind,
  ApiResult,
  AttemptSummary,
  ChallengeSession,
  LearnerState,
} from "@/types/learner-session";
import { isAttemptSummary, isBoolean, isChallengeSession, isLearnerState, isRecord, isString, sessionOf } from "./parse";

const DEFAULT_TIMEOUT_MS = 15_000;

const KIND_BY_STATUS: Record<number, ApiErrorKind> = {
  400: "bad-request",
  401: "unauthorized",
  403: "forbidden",
  404: "not-found",
  409: "conflict",
  413: "payload-too-large",
  415: "unsupported-media-type",
  429: "rate-limited",
};

const DEFAULT_MESSAGES: Record<ApiErrorKind, string> = {
  "bad-request": "The request was not accepted.",
  unauthorized: "Your learner session is missing or has expired.",
  forbidden: "The request was refused.",
  "not-found": "Not found.",
  conflict: "The request conflicts with the current session.",
  "payload-too-large": "The request is too large.",
  "unsupported-media-type": "The request format was not accepted.",
  "rate-limited": "Too many requests. Please wait and try again.",
  server: "Something went wrong on the server. Please try again.",
  network: "Couldn't reach the server. Check your connection.",
  timeout: "The server took too long to respond.",
  "invalid-response": "Unexpected response from the server.",
  "unsupported-browser": "This browser can't cancel or time out requests. Please use a current browser.",
};

export type LearnerSessionView = { state: "none" } | { state: "active"; session: ChallengeSession };

export interface StartedSession {
  created: boolean;
  restarted: boolean;
  session: ChallengeSession;
}

/** A diagnosis answer the workspace can show (correct, incorrect, invalid, rate-limited), or a failure. */
export type DiagnosisCallResult =
  | { kind: "response"; status: number; response: Exclude<DiagnosisResponse, { status: "error" }> }
  | { kind: "error"; error: ApiError };

export interface LearnerSessionApiOptions {
  /** Defaults to the global fetch. Injected in tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Seconds from a Retry-After header: delta-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

/** The ApiError for a response this client could not use. */
export function errorFromResponse(status: number, body: unknown, retryAfterHeader: string | null): ApiError {
  const kind: ApiErrorKind = KIND_BY_STATUS[status] ?? (status >= 500 ? "server" : "invalid-response");
  const record = isRecord(body) ? body : {};
  const error: ApiError = {
    kind,
    status,
    code: isString(record.code) ? record.code : null,
    message: isString(record.message) && record.message.trim() !== "" ? record.message : DEFAULT_MESSAGES[kind],
  };
  if (kind === "rate-limited") {
    const seconds =
      parseRetryAfter(retryAfterHeader) ??
      (Number.isInteger(record.retryAfterSeconds) ? (record.retryAfterSeconds as number) : undefined);
    if (seconds !== undefined) error.retryAfterSeconds = seconds;
  }
  return error;
}

const failure = (kind: ApiErrorKind, status: number | null = null): ApiError => ({
  kind,
  status,
  code: null,
  message: DEFAULT_MESSAGES[kind],
});

interface RawResponse {
  status: number;
  body: unknown;
  retryAfter: string | null;
}

export function createLearnerSessionApi(options: LearnerSessionApiOptions = {}) {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** One request: same-origin credentials, a timeout, and the body parsed as JSON when possible. */
  async function send(
    method: "GET" | "POST",
    path: string,
    init: { body?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<{ ok: true; raw: RawResponse } | { ok: false; error: ApiError }> {
    let request: RequestAbort | undefined;
    try {
      request = createRequestAbort(timeoutMs, init.signal);
      const response = await fetchImpl(path, {
        method,
        credentials: "same-origin",
        headers: method === "POST" ? { "Content-Type": "application/json", ...init.headers } : init.headers,
        body: init.body,
        signal: request.signal,
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch (error) {
        if (request.signal.aborted) throw error;
      }
      return { ok: true, raw: { status: response.status, body, retryAfter: response.headers.get("retry-after") } };
    } catch (error) {
      if (error instanceof UnsupportedBrowserError) return { ok: false, error: failure("unsupported-browser") };
      if (init.signal?.aborted) throw error;
      return { ok: false, error: failure(request?.timedOut() ? "timeout" : "network") };
    } finally {
      request?.dispose();
    }
  }

  /** Runs a request and turns a 2xx body into data with `parse`, or anything else into an ApiError. */
  async function call<T>(
    method: "GET" | "POST",
    path: string,
    parse: (body: unknown) => T | undefined,
    signal?: AbortSignal,
  ): Promise<ApiResult<T>> {
    const sent = await send(method, path, { body: method === "POST" ? "{}" : undefined, signal });
    if (!sent.ok) return sent;
    const { status, body, retryAfter } = sent.raw;
    if (status < 200 || status > 299) return { ok: false, error: errorFromResponse(status, body, retryAfter) };
    const data = parse(body);
    return data === undefined ? { ok: false, error: failure("invalid-response", status) } : { ok: true, status, data };
  }

  const challengePath = (challengeId: string, leaf: string) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/${leaf}`;

  return {
    getLearner(signal?: AbortSignal): Promise<ApiResult<{ state: LearnerState }>> {
      return call("GET", "/api/learner", (body) =>
        isRecord(body) && isRecord(body.learner) && isLearnerState(body.learner.state)
          ? { state: body.learner.state }
          : undefined,
      signal);
    },

    startLearner(signal?: AbortSignal): Promise<ApiResult<{ created: boolean }>> {
      return call("POST", "/api/learner", (body) =>
        isRecord(body) && isRecord(body.learner) && body.learner.state === "active" && isBoolean(body.learner.created)
          ? { created: body.learner.created }
          : undefined,
      signal);
    },

    getSession(challengeId: string, signal?: AbortSignal): Promise<ApiResult<LearnerSessionView>> {
      return call("GET", challengePath(challengeId, "session"), (body) => {
        if (!isRecord(body) || !isRecord(body.session)) return undefined;
        if (body.session.state === "none") return { state: "none" };
        if (body.session.state !== "active") return undefined;
        const session = sessionOf(body.session);
        return isChallengeSession(session) ? { state: "active", session } : undefined;
      }, signal);
    },

    startSession(challengeId: string, signal?: AbortSignal): Promise<ApiResult<StartedSession>> {
      return call("POST", challengePath(challengeId, "session"), (body) => {
        if (!isRecord(body) || !isRecord(body.session) || body.session.state !== "active") return undefined;
        const { created, restarted } = body.session;
        const session = sessionOf(body.session);
        return isBoolean(created) && isBoolean(restarted) && isChallengeSession(session)
          ? { created, restarted, session }
          : undefined;
      }, signal);
    },

    listAttempts(challengeId: string, signal?: AbortSignal): Promise<ApiResult<AttemptSummary[]>> {
      return call("GET", challengePath(challengeId, "attempts"), (body) =>
        isRecord(body) && Array.isArray(body.attempts) && body.attempts.every(isAttemptSummary)
          ? (body.attempts as AttemptSummary[])
          : undefined,
      signal);
    },

    /**
     * Submits a diagnosis. Pass the key from a SubmissionKeys tracker, so a retry of the same
     * submission is recognised by the server and never counted twice.
     */
    async submitDiagnosis(
      challengeId: string,
      submission: DiagnosisSubmission,
      { idempotencyKey, signal }: { idempotencyKey: string; signal?: AbortSignal },
    ): Promise<DiagnosisCallResult> {
      const sent = await send("POST", challengePath(challengeId, "diagnosis"), {
        body: JSON.stringify(submission),
        headers: { "Idempotency-Key": idempotencyKey },
        signal,
      });
      if (!sent.ok) return { kind: "error", error: sent.error };
      const { status, body, retryAfter } = sent.raw;

      // 200 correct/incorrect, 400 invalid and 429 rate-limited are answers the workspace shows.
      if (isDiagnosisResponse(body) && body.status !== "error") {
        const expected = { correct: 200, incorrect: 200, invalid: 400, "rate-limited": 429 }[body.status];
        if (status === expected) {
          if (body.status === "rate-limited") {
            const seconds = parseRetryAfter(retryAfter);
            return { kind: "response", status, response: seconds === undefined ? body : { ...body, retryAfterSeconds: seconds } };
          }
          return { kind: "response", status, response: body };
        }
      }
      if (status >= 200 && status <= 299) return { kind: "error", error: failure("invalid-response", status) };
      return { kind: "error", error: errorFromResponse(status, body, retryAfter) };
    },
  };
}

export type LearnerSessionApi = ReturnType<typeof createLearnerSessionApi>;
