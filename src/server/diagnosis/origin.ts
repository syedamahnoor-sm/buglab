/*
 * Same-origin policy for diagnosis submissions. Server-only.
 *
 * A browser request is accepted only if it comes from the app's own origin:
 *  - Sec-Fetch-Site, when present, must be "same-origin". Browsers set it and
 *    pages cannot forge it, so it needs no proxy or Host configuration.
 *  - Origin, when present, must be exactly the expected origin: same scheme,
 *    hostname and effective port. Opaque ("null") and malformed values fail.
 *
 * The expected origin is BUGLAB_APP_ORIGIN when it is configured. Host,
 * X-Forwarded-Host and X-Forwarded-Proto are then never consulted.
 *
 * Without BUGLAB_APP_ORIGIN (local development) the expected origin falls back
 * to the Host header, which the client controls, with the scheme taken from the
 * Origin itself. That fallback cannot detect a spoofed Host or a scheme
 * mismatch (Sec-Fetch-Site still catches the latter in current browsers), so
 * deployments must configure BUGLAB_APP_ORIGIN.
 *
 * Missing headers: a request with neither Origin nor Sec-Fetch-Site is not from
 * a current browser making a cross-origin request (browsers send Origin on
 * every POST, and the JSON content type forces a CORS preflight this API never
 * grants). It is accepted, so curl, scripts and tests keep working. Those
 * clients can send any header they like, so rejecting them would add no
 * protection.
 */
import "server-only";

const WEB_SCHEMES = new Set(["http:", "https:"]);

/**
 * The serialized origin ("https://host[:port]", lowercase, default port
 * omitted) of a value that is exactly an http(s) origin, or null. Paths,
 * queries, fragments, credentials, a trailing slash and opaque origins fail.
 */
export function normalizeOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!WEB_SCHEMES.has(url.protocol) || value.endsWith("/")) return null;
  // href adds "/" for an empty path, so anything beyond the origin shows up here.
  return url.href === `${url.origin}/` ? url.origin : null;
}

/**
 * Parses BUGLAB_APP_ORIGIN. Unset or empty means "not configured". Anything
 * else must be an exact http(s) origin, or this throws, so a typo fails at
 * startup instead of silently changing which origins are accepted.
 */
export function parseAppOrigin(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  const origin = normalizeOrigin(value.trim());
  if (!origin) {
    throw new Error(
      `BUGLAB_APP_ORIGIN must be an origin such as "https://buglab.example" (no path or trailing slash), got "${value}"`,
    );
  }
  return origin;
}

/**
 * The development fallback: the Host header (or, without one, the request
 * URL's host) under the Origin's own scheme. Both are client-influenced.
 */
function originFromHost(request: Request, originScheme: string): string | null {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  return normalizeOrigin(`${originScheme}//${host}`);
}

/** Whether a request may be treated as coming from the app's own origin. */
export function isSameOriginRequest(request: Request, appOrigin: string | null): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;

  const originHeader = request.headers.get("origin");
  if (originHeader === null) return true;

  const origin = normalizeOrigin(originHeader);
  if (!origin) return false;

  const expected = appOrigin ?? originFromHost(request, new URL(origin).protocol);
  return origin === expected;
}

/**
 * Whether cookies get the Secure attribute. With BUGLAB_APP_ORIGIN, its scheme
 * decides, so a TLS-terminating proxy cannot strip Secure by omitting
 * X-Forwarded-Proto, and a client cannot add it by sending one. Without it, the
 * request URL's scheme decides, as before.
 */
export function shouldSetSecureCookie(request: Request, appOrigin: string | null): boolean {
  return (appOrigin ?? new URL(request.url).origin).startsWith("https:");
}
