/*
 * Request guards shared by the session module's HTTP handlers. Server-only.
 *
 * These were written inside handlers.ts and are moved here unchanged, so the diagnosis submission
 * handler applies exactly the checks the learner and challenge-session handlers apply, from one
 * place. Each guard answers with data (a GuardFailure, or null when the request passes), not a
 * Response, so each handler renders a refusal in its own body shape.
 *
 *   hasJsonContentType   a JSON content type, which makes a cross-site fetch need a CORS preflight
 *   isSameOrigin         the browser says the request came from this site (policy below)
 *   isPrefetch           a speculative prefetch, which must never change state
 *   readBoundedBody      the body as text, read as a stream and stopped at a cap
 *   checkWriteHeaders    the three header checks above, in that order
 *   checkSmallJsonWrite  checkWriteHeaders, plus a body of at most 1 KiB that is empty or a JSON object
 *
 * THE ORIGIN POLICY (strict). The Origin header, parsed, must be the same origin as the request's
 * own URL: the same scheme, host and port. Comparing only the host would accept http://example.com
 * for https://example.com, and trusting the Host header would let a client vouch for its own
 * Origin. With no Origin header, only `Sec-Fetch-Site: same-origin` passes. A missing Origin alone
 * is never enough, and an opaque origin ("null") is never ours.
 *
 * COMPATIBILITY REQUIREMENT BEFORE ANYTHING IS MOUNTED. This is the policy the learner and session
 * handlers already follow. It is NOT the policy of the live diagnosis handler
 * (src/server/diagnosis/handler.ts), which compares only the host and lets a missing Origin through.
 * Syeda's reported change to that check is not on any branch this repository can see, and nothing
 * here assumes what it contains. Before the diagnosis submission handler is mounted, her version
 * must be compared with this one, and the learner, session and diagnosis endpoints must end up
 * with ONE policy. This file is the only place to change for that, and `isSameOrigin` is also an
 * injectable option of the diagnosis handler for the same reason.
 *
 * "Same as the request's URL" is as reliable as the URL the server is given. If the app sits
 * behind a proxy that rewrites the scheme or host, check that the URL seen here is the one the
 * browser used, or every request from the app is refused.
 */
import "server-only";

/** The body cap for the small state-changing requests (learner and session). The diagnosis body has its own. */
export const SMALL_BODY_LIMIT_BYTES = 1024;

export interface GuardFailure {
  readonly status: 400 | 403 | 415;
  readonly code: "bad-request" | "forbidden" | "unsupported-media-type";
  readonly message: string;
}

const failure = (status: GuardFailure["status"], code: GuardFailure["code"], message: string): GuardFailure => ({
  status,
  code,
  message,
});

export function hasJsonContentType(request: Request): boolean {
  return /^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "");
}

/** Whether the browser says this request came from this site. See THE ORIGIN POLICY above. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";

  let claimed: URL;
  try {
    claimed = new URL(origin);
  } catch {
    return false; // malformed
  }
  // A browser serializes an Origin as scheme://host[:port]: it never carries credentials. Parsing
  // would drop them and compare only the host behind them, so `http://evil.example@localhost:3000`
  // would pass as `http://localhost:3000`. Refuse any Origin that has credentials, including the
  // empty forms (`http://@host`, `http://:@host`) that parse to an empty username and password.
  if (claimed.username !== "" || claimed.password !== "" || origin.includes("@")) return false;
  // An opaque origin (a sandboxed frame, for example) serializes as "null" and is never ours.
  return claimed.origin !== "null" && claimed.origin === new URL(request.url).origin;
}

export function isPrefetch(request: Request): boolean {
  const purpose = `${request.headers.get("sec-purpose") ?? ""} ${request.headers.get("purpose") ?? ""}`.toLowerCase();
  return purpose.includes("prefetch");
}

/**
 * Reads a body as text, refusing anything over the cap. Null means too large.
 * It reads the stream chunk by chunk and stops at the cap, so a body with no
 * declared length (a chunked upload) can never make the server buffer more than
 * the cap before it is refused.
 */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * The header checks every state-changing request must pass before anything is read or created, in
 * this order: JSON content type (415), same origin (403), not a prefetch (403). `sameOrigin` lets a
 * caller supply a different origin check (see the compatibility requirement above); it defaults to
 * the strict policy.
 */
export function checkWriteHeaders(
  request: Request,
  sameOrigin: (request: Request) => boolean = isSameOrigin,
): GuardFailure | null {
  if (!hasJsonContentType(request)) {
    return failure(415, "unsupported-media-type", "Content-Type must be application/json.");
  }
  if (!sameOrigin(request)) return failure(403, "forbidden", "Cross-origin requests are not allowed.");
  if (isPrefetch(request)) return failure(403, "forbidden", "Prefetch requests are not allowed.");
  return null;
}

/**
 * The full guard for the small state-changing requests: the header checks, then a body that is
 * not used but, if one is sent, must be at most 1 KiB and a JSON object.
 */
export async function checkSmallJsonWrite(request: Request): Promise<GuardFailure | null> {
  const refused = checkWriteHeaders(request);
  if (refused) return refused;

  const text = await readBoundedBody(request, SMALL_BODY_LIMIT_BYTES);
  if (text === null) return failure(400, "bad-request", "Request body is too large.");
  if (text.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return failure(400, "bad-request", "Request body must be valid JSON.");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return failure(400, "bad-request", "Request body must be a JSON object.");
    }
  }
  return null;
}
