/*
 * HTTP handler factories for the Learning Loop: reflections, journal and activity. Server-only.
 *
 * Plain Request-to-Response functions built from an injected LearningLoopService, in the same
 * shape as the session handlers. NOTHING MOUNTS THEM: there are deliberately no route files under
 * src/app/api/learning, so this module adds no public API. A route would be a one-line export of
 * one of these functions, in a later, separately approved step.
 *
 *   POST   reflections               creates the learner's single active reflection for a completed challenge
 *   GET    reflections               lists active reflections (optional ?challengeId=)
 *   GET    reflections/:id           one active reflection
 *   PATCH  reflections/:id           updates the body; needs the matching `revision`
 *   DELETE reflections/:id           soft-deletes; needs the matching `revision`. 200 { reflection: { id,
 *                                    challengeId, revision, deleted: true, deletedAt } } (deletedAt is ISO-8601 UTC; under clock skew it may equal createdAt)
 *   GET    journal                   read-only view of reflections: ?limit= and ?cursor=
 *   GET    activity                  read-only derived feed: ?limit=, ?cursor= and ?kinds= (comma-separated)
 *
 * Writes pass the session module's request guards first (JSON content type, same origin, no prefetch,
 * a small JSON-object body), before any identity is looked up. Every response is `no-store`, `Vary: Cookie`
 * and `nosniff`, carries only the service's allow-listed fields, and never an internal id, token or hash.
 * The learner cookie is set on a write, and on a read only when it refreshed the idle expiry.
 *
 * Query parameters are parsed here and are a 400 `bad-request` when wrong: a `limit` that is not a plain
 * positive integer, a repeated `limit` or `cursor`, a cursor the service cannot decode, an unknown `kinds`
 * value. An empty `kinds` is the same as none. Everything the service refuses in a body is its own
 * `validation-failed`.
 */
import "server-only";
import { shouldSetSecureCookie } from "@/server/diagnosis/origin";
import { readLearnerCookie, serializeLearnerCookie, type IssuedCookie } from "../session/cookie";
import { checkWriteHeaders, isSameOrigin, readJsonObjectBody } from "../session/request-guards";
import type { LearningLoopRejection, LearningLoopRejectionCode, LearningLoopService } from "./service";

interface ReflectionContext {
  params: Promise<{ reflectionId: string }>;
}

type ErrorCode =
  | Exclude<LearningLoopRejectionCode, "invalid-cursor">
  | "bad-request"
  | "forbidden"
  | "unsupported-media-type"
  | "internal";

/**
 * A reflection body is at most 16 KiB of UTF-8 after trimming, and JSON escaping can make it several times
 * larger on the wire, so the request body cap is generous but still bounded.
 */
export const LEARNING_BODY_LIMIT_BYTES = 64 * 1024;

type Response4xx = { status: number; code: ErrorCode; message: string };

/**
 * THE one map from a service rejection to its HTTP status, error code and message. (A store error never reaches here:
 * the service has already turned it into one of these codes, so nothing is mapped twice.)
 */
const REJECTIONS: Record<LearningLoopRejectionCode, Response4xx> = {
  "learner-missing": { status: 401, code: "learner-missing", message: "There is no learner session. Start one first." },
  "learner-expired": { status: 401, code: "learner-expired", message: "The learner session has expired. Start a new one." },
  "unknown-challenge": { status: 404, code: "unknown-challenge", message: "Unknown challenge." },
  "completion-required": { status: 404, code: "completion-required", message: "Complete this challenge before writing a reflection." },
  "not-found": { status: 404, code: "not-found", message: "Reflection not found." },
  "validation-failed": { status: 400, code: "validation-failed", message: "One or more fields are invalid." },
  "reflection-already-exists": {
    status: 409,
    code: "reflection-already-exists",
    message: "You already have a reflection for this challenge. Edit the existing one.",
  },
  "revision-conflict": { status: 409, code: "revision-conflict", message: "This reflection was updated elsewhere. Reload and try again." },
  "invalid-cursor": { status: 400, code: "bad-request", message: "The cursor is not valid." },
};

/** On the list reads a bad parameter is a malformed request, not a body field error: `validation-failed` becomes `bad-request`. */
const BAD_QUERY_PARAMETER: Response4xx = { status: 400, code: "bad-request", message: "A query parameter is not valid." };

/** Where a rejection came from: a request body, or the query string of a list read. */
type Where = "body" | "query";

interface HandlerDeps {
  service: LearningLoopService;
  /** The parsed BUGLAB_APP_ORIGIN. Left out, it is null: the request's own URL decides, which fails closed behind a rewriting proxy. */
  appOrigin?: string | null;
}

const cookieOf = (request: Request) => readLearnerCookie(request.headers.get("cookie"));

function responders(appOrigin: string | null) {
  function respond(status: number, body: unknown, request: Request, cookie?: IssuedCookie): Response {
    const headers = new Headers({
      "Cache-Control": "no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    });
    if (cookie) headers.append("Set-Cookie", serializeLearnerCookie(cookie, shouldSetSecureCookie(request, appOrigin)));
    return Response.json(body, { status, headers });
  }

  function error(status: number, code: ErrorCode, message: string, request: Request, extra: object = {}): Response {
    return respond(status, { status: "error", code, message, ...extra }, request);
  }

  const badRequest = (message: string, request: Request) => error(400, "bad-request", message, request);
  const internalError = (request: Request) => error(500, "internal", "Something went wrong. Please try again.", request);

  function reject(rejection: LearningLoopRejection, request: Request, where: Where = "body"): Response {
    const { status, code, message } =
      rejection.code === "validation-failed" && where === "query" ? BAD_QUERY_PARAMETER : REJECTIONS[rejection.code];
    const extra =
      rejection.code === "revision-conflict" && rejection.currentRevision !== undefined
        ? { currentRevision: rejection.currentRevision }
        : rejection.code === "reflection-already-exists" && rejection.existingReflectionId !== undefined
          ? { existingReflectionId: rejection.existingReflectionId }
          : {};
    return error(status, code, message, request, extra);
  }

  /**
   * The write guards, then the JSON object body (an empty body is `{}`, so DELETE can say "no revision"
   * in the service's own words). A Response is a refusal; otherwise the parsed object.
   */
  async function readWrite(request: Request): Promise<Response | Record<string, unknown>> {
    const refused = checkWriteHeaders(request, (candidate) => isSameOrigin(candidate, appOrigin));
    if (refused) return error(refused.status, refused.code, refused.message, request);

    const read = await readJsonObjectBody(request, { maxBytes: LEARNING_BODY_LIMIT_BYTES });
    if (!read.ok) return error(read.failure.status, read.failure.code, read.failure.message, request);
    return read.body;
  }

  return { respond, reject, badRequest, readWrite, internalError };
}

/** A query parameter that may appear at most once: not there, there once (with its value), or repeated. */
type OneQuery = { state: "absent" } | { state: "one"; value: string } | { state: "repeated" };

function oneQuery(url: URL, name: string): OneQuery {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) return { state: "absent" };
  return values.length === 1 ? { state: "one", value: values[0]! } : { state: "repeated" };
}

type Paging = { limit?: number; cursor?: string };

/** `limit` and `cursor` from the query, or a message when one is malformed. The service clamps and range-checks. */
function readPaging(url: URL): Paging | string {
  const paging: Paging = {};
  const limit = oneQuery(url, "limit");
  if (limit.state === "repeated") return "limit may be given only once.";
  if (limit.state === "one") {
    const parsed = /^[0-9]{1,15}$/.test(limit.value) ? Number(limit.value) : NaN;
    if (!Number.isSafeInteger(parsed)) return "limit must be a positive integer.";
    paging.limit = parsed;
  }
  const cursor = oneQuery(url, "cursor");
  if (cursor.state === "repeated") return "cursor may be given only once.";
  if (cursor.state === "one") paging.cursor = cursor.value;
  return paging;
}

/**
 * `kinds` is one comma-separated string (a repeated parameter is joined). Blank segments are dropped; nothing
 * left means the parameter was not given. Which kinds exist is the service's call.
 */
function readKinds(url: URL): string[] | undefined {
  const kinds = url.searchParams
    .getAll("kinds")
    .flatMap((value) => value.split(","))
    .map((kind) => kind.trim())
    .filter((kind) => kind !== "");
  return kinds.length === 0 ? undefined : kinds;
}

export function createLearningLoopHandlers({ service, appOrigin = null }: HandlerDeps) {
  const { respond, reject, badRequest, readWrite, internalError } = responders(appOrigin);

  return {
    reflections: {
      async GET(request: Request): Promise<Response> {
        try {
          const challengeId = oneQuery(new URL(request.url), "challengeId");
          if (challengeId.state === "repeated") return badRequest("challengeId may be given only once.", request);
          const result = await service.listReflections(
            cookieOf(request),
            challengeId.state === "one" ? { challengeId: challengeId.value } : {},
          );
          if (result.status === "rejected") return reject(result, request);
          return respond(200, { reflections: result.reflections }, request, result.cookie);
        } catch {
          return internalError(request);
        }
      },

      async POST(request: Request): Promise<Response> {
        try {
          const body = await readWrite(request);
          if (body instanceof Response) return body;
          const result = await service.createReflection(cookieOf(request), { challengeId: body.challengeId, body: body.body });
          if (result.status === "rejected") return reject(result, request);
          return respond(201, { reflection: result.reflection }, request, result.cookie);
        } catch {
          return internalError(request);
        }
      },
    },

    reflection: {
      async GET(request: Request, context: ReflectionContext): Promise<Response> {
        try {
          const { reflectionId } = await context.params;
          const result = await service.getReflection(cookieOf(request), reflectionId);
          if (result.status === "rejected") return reject(result, request);
          return respond(200, { reflection: result.reflection }, request, result.cookie);
        } catch {
          return internalError(request);
        }
      },

      async PATCH(request: Request, context: ReflectionContext): Promise<Response> {
        try {
          const body = await readWrite(request);
          if (body instanceof Response) return body;
          const { reflectionId } = await context.params;
          const result = await service.updateReflection(cookieOf(request), reflectionId, { body: body.body, revision: body.revision });
          if (result.status === "rejected") return reject(result, request);
          return respond(200, { reflection: result.reflection }, request, result.cookie);
        } catch {
          return internalError(request);
        }
      },

      async DELETE(request: Request, context: ReflectionContext): Promise<Response> {
        try {
          const body = await readWrite(request);
          if (body instanceof Response) return body;
          const { reflectionId } = await context.params;
          const result = await service.deleteReflection(cookieOf(request), reflectionId, { revision: body.revision });
          if (result.status === "rejected") return reject(result, request);
          return respond(200, { reflection: result.reflection }, request, result.cookie);
        } catch {
          return internalError(request);
        }
      },
    },

    journal: {
      async GET(request: Request): Promise<Response> {
        try {
          const paging = readPaging(new URL(request.url));
          if (typeof paging === "string") return badRequest(paging, request);
          const result = await service.listJournal(cookieOf(request), paging);
          if (result.status === "rejected") return reject(result, request, "query");
          return respond(200, { entries: result.entries, nextCursor: result.nextCursor }, request, result.cookie);
        } catch {
          return internalError(request);
        }
      },
    },

    activity: {
      async GET(request: Request): Promise<Response> {
        try {
          const url = new URL(request.url);
          const paging = readPaging(url);
          if (typeof paging === "string") return badRequest(paging, request);
          const kinds = readKinds(url);
          const result = await service.listActivity(cookieOf(request), kinds ? { ...paging, kinds } : paging);
          if (result.status === "rejected") return reject(result, request, "query");
          return respond(200, { items: result.items, nextCursor: result.nextCursor }, request, result.cookie);
        } catch {
          return internalError(request);
        }
      },
    },
  };
}
