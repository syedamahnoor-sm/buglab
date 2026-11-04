/*
 * HTTP handler factories for the learner session service. Server-only.
 *
 * Plain Request-to-Response functions, built from an injected service so tests
 * can run them against any store. NOTHING MOUNTS THEM: there are deliberately no
 * route files yet, so this module adds no public API. A route would be a
 * one-line export of one of these functions.
 *
 * What each endpoint may do:
 *
 *   POST learner                      creates or resumes the anonymous learner (the only place one is born)
 *   GET  learner                      reports none | expired | active. Read-only.
 *   GET  challenge session            the learner's own session, or none. Read-only.
 *   POST challenge session            starts or resumes it. The learner must already exist. If the challenge
 *                                     changed since an unfinished session started, replaces it (`restarted`).
 *   GET  attempts                     the learner's own attempt history. Read-only.
 *
 * Every response is `no-store`, carries only allow-listed fields, and never
 * contains an internal id, a token or a hash. The cookie is set on a write, and
 * on a read only when it refreshed the idle expiry.
 */
import "server-only";
import { readLearnerCookie, serializeLearnerCookie, type IssuedCookie } from "./cookie";
import type { LearnerSessionService, Rejection, RejectionCode } from "./service";

const MAX_BODY_BYTES = 1024;

interface ChallengeContext {
  params: Promise<{ challengeId: string }>;
}

type ErrorCode = RejectionCode | "bad-request" | "forbidden" | "unsupported-media-type" | "internal";

const REJECTIONS: Record<RejectionCode, { status: number; message: string }> = {
  "learner-missing": { status: 401, message: "There is no learner session. Start one first." },
  "learner-expired": { status: 401, message: "The learner session has expired. Start a new one." },
  "unknown-challenge": { status: 404, message: "Unknown challenge." },
  "session-missing": { status: 404, message: "This challenge has not been started." },
  "session-outdated": { status: 409, message: "This challenge has changed since you started it. Start it again to continue." },
  "submission-id-conflict": { status: 409, message: "That submission id was already used for a different answer." },
};

function respond(status: number, body: unknown, request: Request, cookie?: IssuedCookie): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  });
  if (cookie) headers.append("Set-Cookie", serializeLearnerCookie(cookie, new URL(request.url).protocol === "https:"));
  return Response.json(body, { status, headers });
}

function error(status: number, code: ErrorCode, message: string, request: Request): Response {
  return respond(status, { status: "error", code, message }, request);
}

function reject(rejection: Rejection, request: Request): Response {
  const { status, message } = REJECTIONS[rejection.code];
  return error(status, rejection.code, message, request);
}

/**
 * Reads a small body as text, refusing anything over the cap. Null means too large.
 * It reads the stream chunk by chunk and stops at the cap, so a body with no
 * declared length (a chunked upload) can never make the server buffer more than
 * the cap before it is refused.
 */
async function readSmallBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
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
 * Whether the browser says this request came from this site: the Origin, parsed,
 * must be the same origin as the request's own URL, meaning the same scheme, host
 * and port. Comparing only the host would accept http://example.com for
 * https://example.com, and trusting the Host header would let a client vouch for
 * its own Origin. Without an Origin, only Fetch Metadata saying same-origin counts.
 *
 * "Same as the request's URL" is as reliable as the URL the server is given. If the
 * app ever sits behind a proxy that rewrites the scheme or host, check that the URL
 * seen here is the one the browser used.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";

  let claimed: URL;
  try {
    claimed = new URL(origin);
  } catch {
    return false; // malformed
  }
  // An opaque origin (a sandboxed frame, for example) serializes as "null" and is never ours.
  return claimed.origin !== "null" && claimed.origin === new URL(request.url).origin;
}

/**
 * The checks every state-changing request must pass before anything is created:
 * JSON content type (which forces a CORS preflight from another site), proof that
 * the request came from this site, and not a prefetch. A missing Origin is not
 * enough: the browser must say the request is same-origin.
 */
async function guardWrite(request: Request): Promise<Response | null> {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return error(415, "unsupported-media-type", "Content-Type must be application/json.", request);
  }
  if (!isSameOrigin(request)) return error(403, "forbidden", "Cross-origin requests are not allowed.", request);

  const purpose = `${request.headers.get("sec-purpose") ?? ""} ${request.headers.get("purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch")) return error(403, "forbidden", "Prefetch requests are not allowed.", request);

  // The body is not used, but if one is sent it must be a JSON object and small.
  const text = await readSmallBody(request);
  if (text === null) return error(400, "bad-request", "Request body is too large.", request);
  if (text.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return error(400, "bad-request", "Request body must be valid JSON.", request);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return error(400, "bad-request", "Request body must be a JSON object.", request);
    }
  }
  return null;
}

const cookieOf = (request: Request) => readLearnerCookie(request.headers.get("cookie"));

function internalError(request: Request): Response {
  return error(500, "internal", "Something went wrong. Please try again.", request);
}

export function createLearnerHandlers({ service }: { service: LearnerSessionService }) {
  return {
    async GET(request: Request): Promise<Response> {
      try {
        const status = await service.checkLearner(cookieOf(request));
        const cookie = status.state === "active" ? status.cookie : undefined;
        return respond(200, { learner: { state: status.state } }, request, cookie);
      } catch {
        return internalError(request);
      }
    },

    async POST(request: Request): Promise<Response> {
      try {
        const refused = await guardWrite(request);
        if (refused) return refused;
        const { created, cookie } = await service.startLearner(cookieOf(request));
        return respond(created ? 201 : 200, { learner: { state: "active", created } }, request, cookie);
      } catch {
        return internalError(request);
      }
    },
  };
}

export function createChallengeSessionHandlers({ service }: { service: LearnerSessionService }) {
  return {
    async GET(request: Request, context: ChallengeContext): Promise<Response> {
      try {
        const { challengeId } = await context.params;
        const result = await service.getChallengeSession(cookieOf(request), challengeId);
        if (result.status === "rejected") return reject(result, request);
        const body = result.session ? { session: { state: "active", ...result.session } } : { session: { state: "none" } };
        return respond(200, body, request, result.cookie);
      } catch {
        return internalError(request);
      }
    },

    async POST(request: Request, context: ChallengeContext): Promise<Response> {
      try {
        const refused = await guardWrite(request);
        if (refused) return refused;
        const { challengeId } = await context.params;
        const result = await service.startChallenge(cookieOf(request), challengeId);
        if (result.status === "rejected") return reject(result, request);
        return respond(
          result.created ? 201 : 200,
          { session: { state: "active", created: result.created, restarted: result.restarted, ...result.session } },
          request,
          result.cookie,
        );
      } catch {
        return internalError(request);
      }
    },
  };
}

export function createAttemptHistoryHandler({ service }: { service: LearnerSessionService }) {
  return {
    async GET(request: Request, context: ChallengeContext): Promise<Response> {
      try {
        const { challengeId } = await context.params;
        const result = await service.listAttempts(cookieOf(request), challengeId);
        if (result.status === "rejected") return reject(result, request);
        return respond(200, { attempts: result.attempts }, request, result.cookie);
      } catch {
        return internalError(request);
      }
    },
  };
}
