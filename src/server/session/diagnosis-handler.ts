/*
 * POST /api/challenges/:challengeId/diagnosis, on top of the learner session service. Server-only.
 *
 * A Request-to-Response handler factory, like the others in this module, and like them NOT MOUNTED:
 * no route imports it and the live diagnosis endpoint (src/server/diagnosis/handler.ts, with its
 * own attempt cookie and limiter) is untouched. A route would be a one-line export of the function
 * this returns, in a later, separately approved step.
 *
 * It does no judging and no recording of its own. It checks the request, then hands the body to
 * LearnerSessionService.submitDiagnosis, which validates it, evaluates it with the existing
 * evaluator, and records the attempt (and, on a correct one, the completion) in one atomic step.
 *
 * WHAT IT KEEPS FROM THE LIVE ENDPOINT. The request body is unchanged: {rootCauseId, explanation,
 * evidence}. The body cap is 16 KiB. An unparsable body is `400 invalid`. A body that fails the
 * diagnosis rules is `400 invalid` with the same field errors. The success bodies are the existing
 * DiagnosisResponse shapes: `correct`, `incorrect`, `invalid` and `rate-limited` are returned exactly
 * as the service built them, and no new field is added to any of them. The per-IP limit (only with
 * trusted proxy hops) stays, and still means "valid submissions per client IP per challenge".
 *
 * WHAT IS NEW.
 *  - The learner is identified by the `buglab_learner` cookie, never by anything in the body. A
 *    learner and a started session are required: this handler never creates either.
 *  - `Idempotency-Key` (a UUID, normalised to lower case) makes a retry safe: the same key and
 *    payload replays the stored result and records nothing; a different payload under the same key
 *    is a 409. Without the header every request is a new attempt. A header that is present but not
 *    a single UUID is `400 invalid`, whatever else is true of the request.
 *  - Failures that have no DiagnosisResponse shape are `{ status: "error", code, message }`. The
 *    `code` is extra: the existing client reads only `status` and `message`.
 *  - The attempt limit is the service's, per learner session over a sliding window, not the live
 *    endpoint's per-cookie fixed window. Nothing here counts attempts.
 *
 * STATUS MAPPING.
 *
 *   415  content type is not JSON
 *   403  not same-origin (or a prefetch)
 *   404  unknown challenge (checked before the body is read), or the session was never started
 *   413  body over 16 KiB
 *   400  body is not JSON, the Idempotency-Key is malformed, or the diagnosis is invalid
 *   401  no learner cookie, an unknown one, or an expired learner
 *   409  the session is out of date (the challenge changed), or the key was used for another answer
 *   429  the attempt window or the IP limit is full (with Retry-After). Checked inside the service,
 *        before the answer is judged, so a blocked correct answer looks like a blocked wrong one.
 *   200  correct or incorrect (including a replay)
 *   500  anything unexpected, with no detail
 *
 * Field validation happens inside the service, after the learner and session are checked, so a
 * request with no learner and a bad body is 401 where the live endpoint answers 400.
 *
 * ORIGIN. The same-origin check is the strict policy of request-guards.ts, or the function passed
 * as `isSameOrigin`. It is not the live endpoint's, and it is not Syeda's unpublished change; read
 * the compatibility requirement at the top of request-guards.ts before mounting this.
 *
 * Every response is `no-store`, `nosniff` and `Vary: Cookie`. The learner cookie is set only on a
 * result the service produced for a verified learner, and only if the cookie it returned is well
 * formed. A refusal never sets one.
 */
import "server-only";
import type { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { getTrustedClientIp } from "@/server/diagnosis/client-ip";
import type { DiagnosisRegistry } from "@/server/diagnosis/registry";
import type { DiagnosisResponse } from "@/types/diagnosis";
import { readLearnerCookie, serializeLearnerCookie, type IssuedCookie } from "./cookie";
import { REJECTIONS } from "./handlers";
import { checkWriteHeaders, isSameOrigin as strictSameOrigin, readBoundedBody } from "./request-guards";
import type { LearnerSessionService, Rejection } from "./service";
import { parseSessionToken } from "./token";

/** The diagnosis body cap, the same as the live endpoint's. */
export const DIAGNOSIS_BODY_LIMIT_BYTES = 16 * 1024;

const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GENERIC_FAILURE = "The diagnosis could not be evaluated. Please try again.";

/** The IP limiter's surface this handler uses, so a test can pass any compatible counter. */
export type IpSubmissionLimiter = Pick<FixedWindowLimiter, "status" | "increment">;

export interface DiagnosisSubmissionHandlerDeps {
  /** Does the judging and the recording. This handler never does either. */
  service: Pick<LearnerSessionService, "submitDiagnosis">;
  /** Which challenges exist. Asked before the body is read, so an unknown challenge is a cheap 404. */
  registry: Pick<DiagnosisRegistry, "has">;
  /** Valid submissions per trusted client IP, per challenge. A blunt abuse limit across learners. */
  ipSubmissions: IpSubmissionLimiter;
  /** How many trusted proxies sit in front of the app. 0 means no client IP is trusted, so no IP limit applies. */
  trustedProxyHops: number;
  /** Replaces the strict same-origin policy of request-guards.ts. Leave it unset unless the policy is being decided. */
  isSameOrigin?: (request: Request) => boolean;
}

interface RouteContext {
  params: Promise<{ challengeId: string }>;
}

type ErrorBody = { status: "error"; code: string; message: string };

/** A cookie is written only if it has the exact form the service issues. A malformed one is dropped, never sent. */
function usable(cookie: IssuedCookie | undefined): cookie is IssuedCookie {
  return (
    cookie !== undefined &&
    parseSessionToken(cookie.value) !== null &&
    Number.isInteger(cookie.maxAgeSeconds) &&
    cookie.maxAgeSeconds >= 0
  );
}

function respond(
  status: number,
  body: DiagnosisResponse | ErrorBody,
  request: Request,
  extra: { cookie?: IssuedCookie; retryAfterSeconds?: number } = {},
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  });
  if (extra.retryAfterSeconds !== undefined) headers.set("Retry-After", String(extra.retryAfterSeconds));
  if (usable(extra.cookie)) {
    headers.append("Set-Cookie", serializeLearnerCookie(extra.cookie, new URL(request.url).protocol === "https:"));
  }
  return Response.json(body, { status, headers });
}

function fail(status: number, code: string, message: string, request: Request): Response {
  return respond(status, { status: "error", code, message }, request);
}

function invalidBody(message: string, request: Request): Response {
  return respond(400, { status: "invalid", errors: [{ field: "body", message }] }, request);
}

function reject(rejection: Rejection, request: Request): Response {
  const { status, message } = REJECTIONS[rejection.code];
  return fail(status, rejection.code, message, request);
}

/** The key as the service stores it, undefined when the header is absent, null when it is present but not one UUID. */
function idempotencyKeyOf(request: Request): string | undefined | null {
  const header = request.headers.get("idempotency-key");
  if (header === null) return undefined;
  return IDEMPOTENCY_KEY.test(header) ? header.toLowerCase() : null;
}

export function createDiagnosisSubmissionHandler(deps: DiagnosisSubmissionHandlerDeps) {
  const sameOrigin = deps.isSameOrigin ?? strictSameOrigin;

  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    try {
      const refused = checkWriteHeaders(request, sameOrigin);
      if (refused) return fail(refused.status, refused.code, refused.message, request);

      const { challengeId } = await context.params;
      if (!deps.registry.has(challengeId)) return reject({ status: "rejected", code: "unknown-challenge" }, request);

      const text = await readBoundedBody(request, DIAGNOSIS_BODY_LIMIT_BYTES);
      if (text === null) return fail(413, "payload-too-large", "Request body is too large.", request);

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return invalidBody("Request body must be valid JSON.", request);
      }

      const submissionId = idempotencyKeyOf(request);
      if (submissionId === null) return invalidBody("Idempotency-Key must be a UUID.", request);

      // The IP limit is read before the service is called, so a blocked client learns nothing about the answer.
      // It is only counted afterwards, for submissions that were really judged.
      const clientIp = getTrustedClientIp(request.headers, deps.trustedProxyHops);
      const ipKey = clientIp ? `${challengeId}:${clientIp}` : null;
      if (ipKey) {
        const ip = deps.ipSubmissions.status(ipKey);
        if (ip.blocked) {
          return respond(429, { status: "rate-limited", retryAfterSeconds: ip.retryAfterSeconds }, request, {
            retryAfterSeconds: ip.retryAfterSeconds,
          });
        }
      }

      const result = await deps.service.submitDiagnosis(
        readLearnerCookie(request.headers.get("cookie")),
        challengeId,
        body,
        submissionId === undefined ? {} : { submissionId },
      );
      if (result.status === "rejected") return reject(result, request);

      const { response, replayed, cookie } = result;
      switch (response.status) {
        case "correct":
        case "incorrect":
          // A judged submission uses up IP quota. A replay was judged before and costs nothing.
          if (ipKey && !replayed) deps.ipSubmissions.increment(ipKey);
          return respond(200, response, request, { cookie });
        case "invalid":
          return respond(400, response, request, { cookie });
        case "rate-limited":
          return respond(429, response, request, { cookie, retryAfterSeconds: response.retryAfterSeconds });
        default:
          // The service never returns `error`. If it ever did, that is a bug and must not be passed on as an answer.
          throw new Error("The session service returned an unexpected response.");
      }
    } catch {
      return fail(500, "internal", GENERIC_FAILURE, request);
    }
  };
}
