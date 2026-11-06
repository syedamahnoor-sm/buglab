/*
 * The account API client. Browser-safe.
 *
 * Two implementations of one interface:
 *
 *   createHttpAccountApi   calls the mounted /api/account routes (contract.ts).
 *                          Same-origin credentials only: the account cookie is
 *                          HttpOnly and is never read, stored or sent by script.
 *   disconnectedAccountApi answers every call with `not-connected` at once and
 *                          never touches the network. Retained for explicitly
 *                          disconnected consumers; mounted UI uses HTTP.
 *
 * Every call returns an AccountResult and never throws, except to rethrow the
 * caller's own abort. No success is ever assumed: a 2xx with an unexpected body
 * is `invalid-response`.
 */
import { createRequestAbort, UnsupportedBrowserError, type RequestAbort } from "@/lib/diagnosis/request-abort";
import {
  ACCOUNT_API,
  errorFromResponse,
  parseAccountSession,
  parseAccountUser,
  parseSessionSummaries,
  type AccountError,
  type AccountResult,
  type AccountSessionSummary,
  type TransportFailure,
} from "./contract";
import { isLinkOutcome, parseLinkStatus, type LinkOutcome, type LinkStatus } from "./link";
import type { AccountSession, AccountUser } from "./model";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface SignUpRequest {
  email: string;
  password: string;
  displayName: string | null;
}

/**
 * What sign-up reports. Deliberately the same whether or not the address was
 * already registered, so the form cannot reveal who has an account.
 */
export interface SignUpAccepted {
  status: "verification-required";
}

export interface AccountApi {
  readonly kind: "http" | "not-connected";
  /** The current session, or null when nobody is signed in. */
  getSession(signal?: AbortSignal): Promise<AccountResult<AccountSession | null>>;
  signIn(input: { email: string; password: string }): Promise<AccountResult<AccountSession>>;
  signUp(input: SignUpRequest): Promise<AccountResult<SignUpAccepted>>;
  signOut(): Promise<AccountResult<null>>;
  verifyEmail(token: string): Promise<AccountResult<null>>;
  resendVerification(email: string): Promise<AccountResult<null>>;
  requestPasswordReset(email: string): Promise<AccountResult<null>>;
  resetPassword(input: { token: string; password: string }): Promise<AccountResult<null>>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<AccountResult<null>>;
  updateProfile(input: { displayName: string | null }): Promise<AccountResult<AccountUser>>;
  listSessions(signal?: AbortSignal): Promise<AccountResult<AccountSessionSummary[]>>;
  revokeSession(id: string): Promise<AccountResult<null>>;
  revokeOtherSessions(): Promise<AccountResult<null>>;
  getLinkStatus(signal?: AbortSignal): Promise<AccountResult<LinkStatus>>;
  /** Links with explicit consent. `consent` must be the literal `true`; the type enforces it. */
  linkBrowserHistory(consent: true): Promise<AccountResult<LinkOutcome>>;
}

const failure = (kind: TransportFailure, status: number | null = null): { ok: false; error: AccountError } => ({
  ok: false,
  error: { kind, status },
});

export function createHttpAccountApi(options: { fetch?: typeof fetch; timeoutMs?: number } = {}): AccountApi {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  interface Raw {
    status: number;
    body: unknown;
    retryAfter: string | null;
  }

  async function send(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<{ ok: true; raw: Raw } | { ok: false; error: AccountError }> {
    let request: RequestAbort | undefined;
    try {
      request = createRequestAbort(timeoutMs, signal);
      const response = await fetchImpl(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        // Writes are JSON, which the server's same-origin write guard requires.
        headers: method === "GET" ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
        signal: request.signal,
      });
      let parsed: unknown = null;
      if (response.status !== 204) {
        try {
          parsed = await response.json();
        } catch (error) {
          if (request.signal.aborted) throw error;
        }
      }
      return { ok: true, raw: { status: response.status, body: parsed, retryAfter: response.headers.get("retry-after") } };
    } catch (error) {
      if (error instanceof UnsupportedBrowserError) return failure("unsupported-browser");
      if (signal?.aborted) throw error;
      return failure(request?.timedOut() ? "timeout" : "network");
    } finally {
      request?.dispose();
    }
  }

  /** Runs a request; `accept` turns an expected success into data, or returns undefined to reject it. */
  async function call<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    accept: (status: number, body: unknown) => T | undefined,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<AccountResult<T>> {
    const sent = await send(method, path, body, signal);
    if (!sent.ok) return sent;
    const { status, body: responseBody, retryAfter } = sent.raw;
    if (status >= 200 && status <= 299) {
      const data = accept(status, responseBody);
      return data === undefined ? failure("invalid-response", status) : { ok: true, data };
    }
    return { ok: false, error: errorFromResponse(status, responseBody, retryAfter) };
  }

  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  /** A write whose success carries no data. */
  const done = (status: number): null | undefined => (status === 200 || status === 202 || status === 204 ? null : undefined);

  return {
    kind: "http",

    async getSession(signal) {
      const result = await call(
        "GET",
        ACCOUNT_API.session,
        (_status, body) => {
          if (!isRecord(body)) return undefined;
          if (body.session === null) return null;
          return parseAccountSession(body.session) ?? undefined;
        },
        undefined,
        signal,
      );
      // A 401 on the session read means "nobody is signed in", not a failure.
      if (!result.ok && result.error.kind === "unauthenticated") return { ok: true, data: null };
      return result;
    },

    signIn: ({ email, password }) =>
      call("POST", ACCOUNT_API.signIn, (_s, body) => (isRecord(body) ? (parseAccountSession(body.session) ?? undefined) : undefined), { email, password }),

    signUp: ({ email, password, displayName }) =>
      call(
        "POST",
        ACCOUNT_API.signUp,
        (_s, body) => (isRecord(body) && body.status === "verification-required" ? { status: "verification-required" as const } : undefined),
        // Exactly these fields. There is no role: the server assigns learner.
        { email, password, displayName },
      ),

    signOut: () => call("POST", ACCOUNT_API.signOut, done),
    verifyEmail: (token) => call("POST", ACCOUNT_API.verifyEmail, done, { token }),
    resendVerification: (email) => call("POST", ACCOUNT_API.resendVerification, done, { email }),
    requestPasswordReset: (email) => call("POST", ACCOUNT_API.forgotPassword, done, { email }),
    resetPassword: ({ token, password }) => call("POST", ACCOUNT_API.resetPassword, done, { token, password }),
    changePassword: ({ currentPassword, newPassword }) => call("POST", ACCOUNT_API.changePassword, done, { currentPassword, newPassword }),

    updateProfile: ({ displayName }) =>
      call("PATCH", ACCOUNT_API.profile, (_s, body) => (isRecord(body) ? (parseAccountUser(body.user) ?? undefined) : undefined), { displayName }),

    listSessions: (signal) => call("GET", ACCOUNT_API.sessions, (_s, body) => parseSessionSummaries(body) ?? undefined, undefined, signal),
    revokeSession: (id) => call("DELETE", `${ACCOUNT_API.sessions}/${encodeURIComponent(id)}`, done),
    revokeOtherSessions: () => call("POST", ACCOUNT_API.revokeOtherSessions, done),

    getLinkStatus: (signal) => call("GET", ACCOUNT_API.link, (_s, body) => parseLinkStatus(body) ?? undefined, undefined, signal),

    async linkBrowserHistory(consent) {
      const result = await call(
        "POST",
        ACCOUNT_API.link,
        (_s, body) => (isRecord(body) && isLinkOutcome(body.outcome) ? body.outcome : undefined),
        // Consent and nothing else. No learner id, account id or list of solves is ever sent.
        { consent },
      );
      // Guard refusals map onto the backend's own link outcomes, so the page has one vocabulary.
      if (!result.ok && result.error.kind === "unauthenticated") return { ok: true, data: "unauthenticated" };
      if (!result.ok && result.error.kind === "unavailable") return { ok: true, data: "unavailable" };
      return result;
    },
  };
}

const NOT_CONNECTED = Object.freeze({ ok: false as const, error: Object.freeze({ kind: "not-connected" as const, status: null }) });
const notConnected = () => Promise.resolve(NOT_CONNECTED);

/** Accounts are not connected: every call answers at once, with no request. */
export const disconnectedAccountApi: AccountApi = Object.freeze({
  kind: "not-connected" as const,
  getSession: notConnected,
  signIn: notConnected,
  signUp: notConnected,
  signOut: notConnected,
  verifyEmail: notConnected,
  resendVerification: notConnected,
  requestPasswordReset: notConnected,
  resetPassword: notConnected,
  changePassword: notConnected,
  updateProfile: notConnected,
  listSessions: notConnected,
  revokeSession: notConnected,
  revokeOtherSessions: notConnected,
  getLinkStatus: notConnected,
  linkBrowserHistory: notConnected,
});
