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
import { checkSmallJsonWrite } from "./request-guards";
import type { LearnerSessionService, Rejection, RejectionCode } from "./service";

interface ChallengeContext {
  params: Promise<{ challengeId: string }>;
}

type ErrorCode = RejectionCode | "bad-request" | "forbidden" | "unsupported-media-type" | "internal";

export const REJECTIONS: Record<RejectionCode, { status: number; message: string }> = {
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

/** Turns a guard refusal into this module's error response, or null when the request may proceed. */
async function guardWrite(request: Request): Promise<Response | null> {
  const refused = await checkSmallJsonWrite(request);
  return refused ? error(refused.status, refused.code, refused.message, request) : null;
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
