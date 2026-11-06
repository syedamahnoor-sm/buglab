/*
 * Account and authentication pages, and the one place return destinations are
 * made safe. Browser-safe and pure.
 */

export const AUTH_ROUTES = Object.freeze({
  signIn: "/login",
  signUp: "/signup",
  verifyEmail: "/verify-email",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  account: "/account",
  profile: "/account/profile",
  security: "/account/security",
  linkHistory: "/account/link",
});

/** The query parameter that carries where to go after signing in. */
export const RETURN_PARAM = "next";

/** Pages a return destination must never point back to: they would loop or re-run a one-time action. */
const NOT_A_DESTINATION = [
  AUTH_ROUTES.signIn,
  AUTH_ROUTES.signUp,
  AUTH_ROUTES.verifyEmail,
  AUTH_ROUTES.forgotPassword,
  AUTH_ROUTES.resetPassword,
];

const MAX_RETURN_LENGTH = 512;

/**
 * A same-site path to return to, or null.
 *
 * Accepts only a plain absolute path on this site. Refused: anything with a
 * scheme or host ("https://x", "//x", "/\x", "\\x"), control characters and
 * whitespace (browsers strip some of them, turning "/\t/x" into "//x"),
 * backslashes anywhere, encoded slashes or backslashes that a later decode
 * could turn into a host, the API, the authentication pages themselves, and
 * anything over 512 characters. The result is re-checked by parsing it
 * against a dummy origin: it must stay on that origin.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RETURN_LENGTH) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\u0000- \u007f-\u009f\\]/.test(raw)) return null;
  if (/%(2f|5c|00|09|0a|0d)/i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://buglab.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://buglab.invalid") return null;
  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) return null;
  if (NOT_A_DESTINATION.some((page) => path === page || path.startsWith(`${page}/`))) return null;
  return `${path}${url.search}${url.hash}`;
}

/** The sign-in URL that returns to `path` afterwards (when it is safe). */
export function signInHref(path?: string | null, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  const safe = safeReturnPath(path ?? null);
  if (safe && safe !== "/") params.set(RETURN_PARAM, safe);
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  const query = params.toString();
  return query ? `${AUTH_ROUTES.signIn}?${query}` : AUTH_ROUTES.signIn;
}

/** Carries a safe return destination from one auth page to another (sign in ↔ sign up). */
export function withReturn(page: string, returnPath: string | null): string {
  const safe = safeReturnPath(returnPath);
  return safe && safe !== "/" ? `${page}?${RETURN_PARAM}=${encodeURIComponent(safe)}` : page;
}

/** The Google sign-in start URL. The server validates `next` again before redirecting to it. */
export function googleStartHref(base: string, returnPath: string | null): string {
  const safe = safeReturnPath(returnPath);
  return safe ? `${base}?${RETURN_PARAM}=${encodeURIComponent(safe)}` : base;
}

/** Errors the Google callback may send back to the sign-in page as `?error=`. Anything else is ignored. */
export type OAuthErrorCode = "oauth-cancelled" | "oauth-failed" | "oauth-account-conflict" | "oauth-email-unverified";

const OAUTH_ERRORS: ReadonlySet<string> = new Set<OAuthErrorCode>(["oauth-cancelled", "oauth-failed", "oauth-account-conflict", "oauth-email-unverified"]);

export function parseOAuthError(raw: string | null): OAuthErrorCode | null {
  return raw !== null && OAUTH_ERRORS.has(raw) ? (raw as OAuthErrorCode) : null;
}

/**
 * Reads a one-time token from the URL fragment (`#token=...`) and removes it
 * from the address bar at once. Email links put tokens in the fragment so they
 * never reach a server log, a proxy or a Referer header.
 */
export function takeFragmentToken(location: { hash: string }, replace: (url: string) => void, pathAndQuery: string): string | null {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  if (!hash) return null;
  const token = new URLSearchParams(hash).get("token");
  replace(pathAndQuery);
  return token && /^[A-Za-z0-9._~-]{16,4096}$/.test(token) ? token : null;
}
