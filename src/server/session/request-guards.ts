/*
 * Request guards shared by the session module's HTTP handlers. Server-only.
 *
 * These were written inside handlers.ts and moved here, so the diagnosis submission handler applies
 * exactly the checks the learner and challenge-session handlers apply, from one place. The Origin
 * check has since changed: see THE ORIGIN POLICY. Each guard answers with data (a GuardFailure, or
 * null when the request passes), not a Response, so each handler renders a refusal in its own body
 * shape.
 *
 *   hasJsonContentType   a JSON content type, which makes a cross-site fetch need a CORS preflight
 *   isSameOrigin         the browser says the request came from this site (policy below)
 *   isPrefetch           a speculative prefetch, which must never change state
 *   readBoundedBody      the body as text, read as a stream and stopped at a cap
 *   checkWriteHeaders    the three header checks above, in that order
 *   checkSmallJsonWrite  checkWriteHeaders, plus a body of at most 1 KiB that is empty or a JSON object
 *
 * THE ORIGIN POLICY (agreed with Syeda; strict for the learner, session and diagnosis-submission
 * WRITES). The origin comparison itself is the shared helper in src/server/diagnosis/origin.ts
 * (`isSameOriginRequest`), which this file does not copy. This file adds the two rules a state-
 * changing session request needs on top of it:
 *
 *   1. An Origin header that is PRESENT is validated, always: it must be exactly the expected origin
 *      (same scheme, host and effective port, no credentials, path, query or fragment), and an
 *      invalid, malformed or opaque ("null") value is refused whatever Sec-Fetch-Site says.
 *      `Sec-Fetch-Site`, when present, must be `same-origin` as well. Any `@` in the value is refused
 *      here too, which closes the empty-credentials form (`https://@host`) that normalizes away in
 *      the shared helper until Syeda's fix for it lands.
 *   2. With NO Origin header (an empty value counts as none), only `Sec-Fetch-Site: same-origin`
 *      passes. A headerless write is never allowed, unlike the shared helper's own missing-header rule
 *      (which exists for the live diagnosis endpoint's curl and monitor clients and is NOT changed
 *      by this file).
 *
 * The expected origin is `appOrigin`, the parsed BUGLAB_APP_ORIGIN, so a TLS-terminating proxy that
 * rewrites the scheme or host does not break the real origin and Host / X-Forwarded-* are never
 * consulted. With `appOrigin` null (BUGLAB_APP_ORIGIN unset) the expected origin is the request's
 * OWN URL origin, not the client-controlled Host header: behind a rewriting proxy that is not the
 * browser's origin, so every write is refused. That fails closed, and a deployment must set
 * BUGLAB_APP_ORIGIN. The live diagnosis endpoint keeps its own, separate policy.
 */
import "server-only";
import { isSameOriginRequest } from "@/server/diagnosis/origin";

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

/**
 * Whether the browser says this request came from this site. See THE ORIGIN POLICY above.
 * `appOrigin` is the parsed BUGLAB_APP_ORIGIN (parseAppOrigin), or null when it is not configured.
 */
export function isSameOrigin(request: Request, appOrigin: string | null = null): boolean {
  const origin = request.headers.get("origin");
  // No Origin (an empty value counts as none, as it always has here): only the browser's own Fetch
  // Metadata saying same-origin passes. A page cannot forge Sec-Fetch-Site, so this is not a free pass.
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";

  // A serialized origin is scheme://host[:port] and contains no `@`. This also catches the empty
  // credential forms that `new URL` silently drops (`https://@host`, `https://:@host`).
  if (origin.includes("@")) return false;

  // Unconfigured: the request's own URL origin, never the Host header.
  return isSameOriginRequest(request, appOrigin ?? new URL(request.url).origin);
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
 * this order: JSON content type (415), same origin (403), not a prefetch (403). `sameOrigin` is the
 * origin check to apply. A handler passes `(request) => isSameOrigin(request, appOrigin)` to use its
 * configured application origin; left out, it is the strict policy with no configured origin.
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
 * not used but, if one is sent, must be at most 1 KiB and a JSON object. `sameOrigin` is passed on to
 * checkWriteHeaders.
 */
export async function checkSmallJsonWrite(
  request: Request,
  sameOrigin: (request: Request) => boolean = isSameOrigin,
): Promise<GuardFailure | null> {
  const refused = checkWriteHeaders(request, sameOrigin);
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
