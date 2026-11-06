/*
 * The BugLab account API, as the frontend expects it. Browser-safe.
 *
 * Routes are mounted in src/server/account over Better Auth. The shared
 * learner-link adapter remains unavailable until Habin's implementation is
 * supplied. The frontend uses this boundary rather than provider endpoints.
 * The full contract, with statuses and the reasons for each rule, is in
 * docs/architecture/account-frontend-contract.md. Tests hold the two in step.
 *
 * Every parser here is total: an unexpected status or body becomes a typed
 * failure, never a thrown error and never an assumed success.
 */
import type { AccountRole, AccountSession, AccountUser, SignInMethod } from "./model";

export const ACCOUNT_API = Object.freeze({
  session: "/api/account/session",
  signIn: "/api/account/sign-in",
  signUp: "/api/account/sign-up",
  signOut: "/api/account/sign-out",
  verifyEmail: "/api/account/verify-email",
  resendVerification: "/api/account/verify-email/resend",
  forgotPassword: "/api/account/password/forgot",
  resetPassword: "/api/account/password/reset",
  changePassword: "/api/account/password/change",
  profile: "/api/account/profile",
  sessions: "/api/account/sessions",
  revokeOtherSessions: "/api/account/sessions/revoke-others",
  link: "/api/account/link",
  /** A navigation, not a fetch: the server redirects to Google and back to its own callback. */
  googleStart: "/api/account/oauth/google",
});

/**
 * Machine-readable reasons the backend may give. The first group is from the
 * authorization matrix and threat model (Habin); the rest are needed by the
 * flows here and are proposed in the contract document.
 */
export type AccountErrorCode =
  // Guards (src/server/auth/guards.ts) and request guards.
  | "unauthenticated"
  | "forbidden"
  | "cross-origin"
  // Proposed for the account flows.
  | "invalid"
  | "invalid-credentials"
  | "email-unverified"
  | "account-disabled"
  | "token-invalid"
  | "token-expired"
  | "reauthentication-required"
  | "rate-limited"
  | "unavailable";

const ERROR_CODES: ReadonlySet<string> = new Set<AccountErrorCode>([
  "unauthenticated",
  "forbidden",
  "cross-origin",
  "invalid",
  "invalid-credentials",
  "email-unverified",
  "account-disabled",
  "token-invalid",
  "token-expired",
  "reauthentication-required",
  "rate-limited",
  "unavailable",
]);

/** Transport-level failures, decided by the client rather than sent by the server. */
export type TransportFailure = "network" | "timeout" | "server" | "invalid-response" | "unsupported-browser" | "not-connected";

export type FieldName = "email" | "password" | "currentPassword" | "newPassword" | "displayName" | "token";

export interface AccountError {
  /** A server code when one was sent and recognised, else the transport failure. */
  kind: AccountErrorCode | TransportFailure;
  status: number | null;
  /** Field problems the server reported, by field. Only for `invalid`. */
  fields?: Partial<Record<FieldName, string>>;
  /** Seconds until a retry may succeed, for `rate-limited`. */
  retryAfterSeconds?: number;
}

export type AccountResult<T> = { ok: true; data: T } | { ok: false; error: AccountError };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const isInstant = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const ROLES: ReadonlySet<string> = new Set<AccountRole>(["learner", "admin"]);
const METHODS: ReadonlySet<string> = new Set<SignInMethod>(["password", "google"]);
const FIELDS: ReadonlySet<string> = new Set<FieldName>(["email", "password", "currentPassword", "newPassword", "displayName", "token"]);

/**
 * An account from the server, or null if it does not have the expected shape.
 * An unknown role makes the whole account invalid: the interface never guesses
 * a role, and never upgrades one.
 */
export function parseAccountUser(value: unknown): AccountUser | null {
  if (!isRecord(value)) return null;
  const { id, email, displayName, emailVerified, role, signInMethods, createdAt } = value;
  if (!isText(id, 256) || !isText(email, 254) || typeof emailVerified !== "boolean") return null;
  if (typeof role !== "string" || !ROLES.has(role)) return null;
  if (displayName !== null && displayName !== undefined && !(typeof displayName === "string" && displayName.length <= 80)) return null;
  const methods = Array.isArray(signInMethods) ? [...new Set(signInMethods.filter((method): method is SignInMethod => typeof method === "string" && METHODS.has(method)))] : [];
  return {
    id,
    email,
    displayName: typeof displayName === "string" && displayName.trim() ? displayName.trim() : null,
    emailVerified,
    role: role as AccountRole,
    signInMethods: methods,
    createdAt: isInstant(createdAt) ? createdAt : null,
  };
}

export function parseAccountSession(value: unknown): AccountSession | null {
  if (!isRecord(value)) return null;
  const user = parseAccountUser(value.user);
  if (!user || !isInstant(value.expiresAt)) return null;
  return { user, expiresAt: value.expiresAt as string };
}

/** Seconds from a Retry-After header (delta-seconds or an HTTP date). */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

/** The AccountError for a response that is not the expected success. */
export function errorFromResponse(status: number, body: unknown, retryAfter: string | null = null): AccountError {
  const record = isRecord(body) ? body : {};
  const code = typeof record.code === "string" && ERROR_CODES.has(record.code) ? (record.code as AccountErrorCode) : null;
  let kind: AccountError["kind"];
  if (code) kind = code;
  else if (status === 401) kind = "unauthenticated";
  else if (status === 403) kind = "forbidden";
  else if (status === 429) kind = "rate-limited";
  else if (status === 503) kind = "unavailable";
  else if (status >= 500) kind = "server";
  else kind = "invalid-response";

  const error: AccountError = { kind, status };
  if (kind === "invalid" && isRecord(record.fields)) {
    const fields: Partial<Record<FieldName, string>> = {};
    for (const [name, message] of Object.entries(record.fields)) {
      if (FIELDS.has(name) && isText(message, 300)) fields[name as FieldName] = message;
    }
    if (Object.keys(fields).length) error.fields = fields;
  }
  if (kind === "rate-limited") {
    const seconds = parseRetryAfter(retryAfter);
    if (seconds !== undefined) error.retryAfterSeconds = seconds;
  }
  return error;
}

/** Another session of this account, for the security page. Shown, never trusted. */
export interface AccountSessionSummary {
  id: string;
  current: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  /** A short, server-made description such as "Firefox on Windows". Never the raw user agent. */
  device: string | null;
}

export function parseSessionSummaries(body: unknown): AccountSessionSummary[] | null {
  if (!isRecord(body) || !Array.isArray(body.sessions)) return null;
  const out: AccountSessionSummary[] = [];
  for (const item of body.sessions) {
    if (!isRecord(item) || !isText(item.id, 256) || typeof item.current !== "boolean" || !isInstant(item.createdAt)) return null;
    out.push({
      id: item.id,
      current: item.current,
      createdAt: item.createdAt as string,
      lastActiveAt: isInstant(item.lastActiveAt) ? (item.lastActiveAt as string) : null,
      device: isText(item.device, 120) ? item.device : null,
    });
  }
  return out;
}
