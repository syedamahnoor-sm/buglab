/*
 * POST /api/challenges/:challengeId/diagnosis. Server-only.
 *
 * Built as a factory so tests can inject a registry, limiters, and proxy
 * settings. Uses only web-standard Request/Response.
 */
import "server-only";
import { validateDiagnosisSubmission } from "@/lib/diagnosis/validate";
import type { AttemptStatus, DiagnosisResponse } from "@/types/diagnosis";
import type { FixedWindowLimiter, LimitStatus } from "./attempt-limiter";
import { getTrustedClientIp } from "./client-ip";
import { evaluateDiagnosis } from "./evaluate";
import { isSameOriginRequest, shouldSetSecureCookie } from "./origin";
import type { DiagnosisRegistry } from "./registry";

export const MAX_BODY_BYTES = 16 * 1024;
export const ATTEMPT_COOKIE = "buglab_attempt";
const ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface DiagnosisHandlerOptions {
  registry: DiagnosisRegistry;
  /** Wrong attempts per attempt-cookie, per challenge. */
  wrongAttempts: FixedWindowLimiter;
  /** All valid submissions per trusted client IP, per challenge. */
  ipSubmissions: FixedWindowLimiter;
  trustedProxyHops: number;
  /**
   * The app's canonical origin (BUGLAB_APP_ORIGIN, from parseAppOrigin), or
   * null for the development fallback. See origin.ts.
   */
  appOrigin: string | null;
}

interface RouteContext {
  params: Promise<{ challengeId: string }>;
}

function respond(status: number, body: DiagnosisResponse, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { status, headers });
}

function toAttemptStatus(status: LimitStatus): AttemptStatus {
  return {
    used: status.used,
    limit: status.limit,
    remaining: status.remaining,
    resetsAt: status.resetsAt ? new Date(status.resetsAt).toISOString() : undefined,
  };
}

/** Reads the body as text, refusing anything over `maxBytes`. */
async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
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

function readAttemptId(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ATTEMPT_COOKIE) {
      const value = rest.join("=");
      return ATTEMPT_ID_PATTERN.test(value) ? value : null;
    }
  }
  return null;
}

function attemptCookie(id: string, request: Request, appOrigin: string | null) {
  const secure = shouldSetSecureCookie(request, appOrigin) ? "; Secure" : "";
  return `${ATTEMPT_COOKIE}=${id}; Path=/api; Max-Age=86400; HttpOnly; SameSite=Strict${secure}`;
}

export function createDiagnosisHandler(options: DiagnosisHandlerOptions) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    try {
      const contentType = request.headers.get("content-type") ?? "";
      if (!/^application\/json\s*(;|$)/i.test(contentType)) {
        return respond(415, { status: "error", message: "Content-Type must be application/json." });
      }
      if (!isSameOriginRequest(request, options.appOrigin)) {
        return respond(403, { status: "error", message: "Cross-origin submissions are not allowed." });
      }

      const { challengeId } = await context.params;
      const challenge = options.registry.get(challengeId);
      if (!challenge) {
        return respond(404, { status: "error", message: "Unknown challenge." });
      }

      const text = await readBodyText(request, MAX_BODY_BYTES);
      if (text === null) {
        return respond(413, { status: "error", message: "Request body is too large." });
      }

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return respond(400, {
          status: "invalid",
          errors: [{ field: "body", message: "Request body must be valid JSON." }],
        });
      }

      const validation = validateDiagnosisSubmission(body, challenge.validation);
      if (!validation.ok) {
        return respond(400, { status: "invalid", errors: validation.errors });
      }

      // Limits are checked before evaluation, so a blocked response never
      // depends on whether the submitted answer would have been correct.
      const existingAttemptId = readAttemptId(request);
      const attemptId = existingAttemptId ?? crypto.randomUUID();
      const headers = new Headers();
      if (!existingAttemptId) headers.append("Set-Cookie", attemptCookie(attemptId, request, options.appOrigin));

      const attemptKey = `${challengeId}:${attemptId}`;
      const attempts = options.wrongAttempts.status(attemptKey);
      if (attempts.blocked) {
        headers.set("Retry-After", String(attempts.retryAfterSeconds));
        return respond(
          429,
          {
            status: "rate-limited",
            retryAfterSeconds: attempts.retryAfterSeconds,
            attempts: toAttemptStatus(attempts),
          },
          headers,
        );
      }

      const clientIp = getTrustedClientIp(request.headers, options.trustedProxyHops);
      if (clientIp) {
        const ipKey = `${challengeId}:${clientIp}`;
        const ipStatus = options.ipSubmissions.status(ipKey);
        if (ipStatus.blocked) {
          headers.set("Retry-After", String(ipStatus.retryAfterSeconds));
          return respond(429, { status: "rate-limited", retryAfterSeconds: ipStatus.retryAfterSeconds }, headers);
        }
        options.ipSubmissions.increment(ipKey);
      }

      const result = evaluateDiagnosis(validation.value, challenge.answerKey);
      if (result.status === "incorrect") {
        const updated = options.wrongAttempts.increment(attemptKey);
        return respond(200, { ...result, attempts: toAttemptStatus(updated) }, headers);
      }
      return respond(200, { ...result, attempts: toAttemptStatus(attempts) }, headers);
    } catch {
      return respond(500, {
        status: "error",
        message: "The diagnosis could not be evaluated. Please try again.",
      });
    }
  };
}
