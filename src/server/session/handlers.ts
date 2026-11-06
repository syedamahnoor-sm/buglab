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
 *   GET  learner completions          current verified completions. Read-only. Unmounted.
 *
 * Every response is `no-store`, carries only allow-listed fields, and never
 * contains an internal id, a token or a hash. The cookie is set on a write, and
 * on a read only when it refreshed the idle expiry.
 */
import "server-only";
import { shouldSetSecureCookie } from "@/server/diagnosis/origin";
import { readLearnerCookie, serializeLearnerCookie, type IssuedCookie } from "./cookie";
import { checkSmallJsonWrite, isSameOrigin } from "./request-guards";
import type { CreationAdmission, LearnerSessionService, Rejection, RejectionCode } from "./service";

interface ChallengeContext {
  params: Promise<{ challengeId: string }>;
}

type ErrorCode = RejectionCode | "bad-request" | "forbidden" | "unsupported-media-type" | "rate-limited" | "internal";

export const REJECTIONS: Record<RejectionCode, { status: number; message: string }> = {
  "learner-missing": { status: 401, message: "There is no learner session. Start one first." },
  "learner-expired": { status: 401, message: "The learner session has expired. Start a new one." },
  "unknown-challenge": { status: 404, message: "Unknown challenge." },
  "session-missing": { status: 404, message: "This challenge has not been started." },
  "session-outdated": { status: 409, message: "This challenge has changed since you started it. Start it again to continue." },
  "submission-id-conflict": { status: 409, message: "That submission id was already used for a different answer." },
  "validation-failed": { status: 400, message: "One or more fields are invalid." },
  "invalid-cursor": { status: 400, message: "The cursor is not valid." },
};

/**
 * The response helpers, bound to the application origin (the parsed BUGLAB_APP_ORIGIN, or null when it
 * is not configured). The origin decides two things: which Origin a write is accepted from, and whether
 * the learner cookie is `Secure`. Both come from the configured origin, never from a header the client
 * sends: with it set, a TLS-terminating proxy cannot strip `Secure` and a client cannot add it.
 */
function responders(appOrigin: string | null) {
  function respond(status: number, body: unknown, request: Request, cookie?: IssuedCookie, retryAfterSeconds?: number): Response {
    const headers = new Headers({
      "Cache-Control": "no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    });
    if (retryAfterSeconds !== undefined) headers.set("Retry-After", String(retryAfterSeconds));
    if (cookie) headers.append("Set-Cookie", serializeLearnerCookie(cookie, shouldSetSecureCookie(request, appOrigin)));
    return Response.json(body, { status, headers });
  }

  function error(status: number, code: ErrorCode, message: string, request: Request): Response {
    return respond(status, { status: "error", code, message }, request);
  }

  /**
   * 429 for a learner-creation limit. The ordinary error envelope the client already reads, with the wait
   * in both the Retry-After header and the body, so a client can use either. No cookie is ever sent.
   */
  function rateLimited(retryAfterSeconds: number, request: Request): Response {
    const body = {
      status: "error",
      code: "rate-limited",
      message: "Too many new sessions were started from your network. Please wait and try again.",
      retryAfterSeconds,
    };
    return respond(429, body, request, undefined, retryAfterSeconds);
  }

  function reject(rejection: Rejection, request: Request): Response {
    const { status, message } = REJECTIONS[rejection.code];
    return error(status, rejection.code, message, request);
  }

  /** Turns a guard refusal into this module's error response, or null when the request may proceed. */
  async function guardWrite(request: Request): Promise<Response | null> {
    const refused = await checkSmallJsonWrite(request, (candidate) => isSameOrigin(candidate, appOrigin));
    return refused ? error(refused.status, refused.code, refused.message, request) : null;
  }

  function internalError(request: Request): Response {
    return error(500, "internal", "Something went wrong. Please try again.", request);
  }

  return { respond, reject, rateLimited, guardWrite, internalError };
}

const cookieOf = (request: Request) => readLearnerCookie(request.headers.get("cookie"));

/** `appOrigin` is the parsed BUGLAB_APP_ORIGIN. Left out, it is null: the request's own URL decides, which fails closed behind a rewriting proxy. */
interface HandlerDeps {
  service: LearnerSessionService;
  appOrigin?: string | null;
}

interface LearnerHandlerDeps extends HandlerDeps {
  /**
   * Asked once, when a POST would create a NEW learner (never when it resumes one). It may refuse, which
   * answers 429 with Retry-After and creates nothing. Left out, creation is not limited. If it throws, the
   * request fails with 500 and no learner is created: it fails closed.
   */
  learnerCreation?: (request: Request) => Promise<CreationAdmission>;
}

export function createLearnerHandlers({ service, appOrigin = null, learnerCreation }: LearnerHandlerDeps) {
  const { respond, rateLimited, guardWrite, internalError } = responders(appOrigin);
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
        const outcome = learnerCreation
          ? await service.startLearnerAdmitted(cookieOf(request), () => learnerCreation(request))
          : await service.startLearner(cookieOf(request));
        if ("status" in outcome) return rateLimited(outcome.retryAfterSeconds, request);
        const { created, cookie } = outcome;
        return respond(created ? 201 : 200, { learner: { state: "active", created } }, request, cookie);
      } catch {
        return internalError(request);
      }
    },
  };
}

export function createChallengeSessionHandlers({ service, appOrigin = null }: HandlerDeps) {
  const { respond, reject, guardWrite, internalError } = responders(appOrigin);
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

/** A query parameter that may appear at most once. */
function oneQuery(url: URL, name: string): { state: "absent" } | { state: "one"; value: string } | { state: "repeated" } {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) return { state: "absent" };
  return values.length === 1 ? { state: "one", value: values[0]! } : { state: "repeated" };
}

/**
 * GET /api/learner/completions. Mounted via src/app/api/learner/completions/route.ts.
 * The learner is the cookie. Query `limit` and `cursor` only; any other query field is ignored.
 */
export function createLearnerCompletionsHandler({ service, appOrigin = null }: HandlerDeps) {
  const { respond, reject, internalError } = responders(appOrigin);
  return {
    async GET(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        const limit = oneQuery(url, "limit");
        if (limit.state === "repeated") {
          return respond(400, { status: "error", code: "bad-request", message: "limit may be given only once." }, request);
        }
        const cursor = oneQuery(url, "cursor");
        if (cursor.state === "repeated") {
          return respond(400, { status: "error", code: "bad-request", message: "cursor may be given only once." }, request);
        }
        let parsedLimit: number | undefined;
        if (limit.state === "one") {
          parsedLimit = /^[0-9]{1,15}$/.test(limit.value) ? Number(limit.value) : Number.NaN;
          if (!Number.isSafeInteger(parsedLimit)) {
            return respond(400, { status: "error", code: "bad-request", message: "limit must be a positive integer." }, request);
          }
        }
        const result = await service.listCompletions(readLearnerCookie(request.headers.get("cookie")), {
          ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
          ...(cursor.state === "one" ? { cursor: cursor.value } : {}),
        });
        if (result.status === "rejected") return reject(result, request);
        return respond(200, { completions: result.completions, nextCursor: result.nextCursor }, request, result.cookie);
      } catch {
        return internalError(request);
      }
    },
  };
}

export function createAttemptHistoryHandler({ service, appOrigin = null }: HandlerDeps) {
  const { respond, reject, internalError } = responders(appOrigin);
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
