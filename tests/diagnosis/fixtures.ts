import { challenge001 } from "@/data/challenge-001";
import { provisionalAnswerKey } from "@/data/challenge-001/answer-key.server";
import { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { createDiagnosisHandler } from "@/server/diagnosis/handler";
import { createDefaultRegistry, validationContextFor } from "@/server/diagnosis/registry";
import type { DiagnosisSubmission } from "@/types/diagnosis";

export const CHALLENGE_ID = challenge001.challenge.id;
export const CORRECT_ID = provisionalAnswerKey.correctRootCauseId;
export const RESOLUTION = provisionalAnswerKey.resolutionSummary;
export const WRONG_IDS = challenge001.rootCauseOptions
  .map((option) => option.id)
  .filter((id) => id !== CORRECT_ID);
export const CORRECT_LABEL = challenge001.rootCauseOptions.find(
  (option) => option.id === CORRECT_ID,
)!.label;

export const validationContext = validationContextFor(challenge001);

export const EXPLANATION =
  "The browser sends the session cookie on every request, but the server still rejects it with 401.";

export function submission(overrides: Partial<DiagnosisSubmission> = {}): DiagnosisSubmission {
  return {
    rootCauseId: WRONG_IDS[0],
    explanation: EXPLANATION,
    evidence: [{ kind: "network", requestId: "req-04" }],
    ...overrides,
  };
}

/** A handler with fresh limiters and a controllable clock. */
export function createTestHandler(options: { trustedProxyHops?: number } = {}) {
  let now = Date.parse("2026-10-31T10:00:00Z");
  const clock = () => now;
  const handler = createDiagnosisHandler({
    registry: createDefaultRegistry(),
    wrongAttempts: new FixedWindowLimiter({ limit: 3, windowMs: 10 * 60_000, now: clock }),
    ipSubmissions: new FixedWindowLimiter({ limit: 10, windowMs: 10 * 60_000, now: clock }),
    trustedProxyHops: options.trustedProxyHops ?? 0,
  });
  return {
    handler,
    advance(ms: number) {
      now += ms;
    },
  };
}

interface PostOptions {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  challengeId?: string;
}

export async function post(
  handler: ReturnType<typeof createDiagnosisHandler>,
  { body, rawBody, headers = {}, challengeId = CHALLENGE_ID }: PostOptions = {},
) {
  const request = new Request(`http://localhost:3000/api/challenges/${challengeId}/diagnosis`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
    body: rawBody ?? JSON.stringify(body ?? submission()),
  });
  const response = await handler(request, { params: Promise.resolve({ challengeId }) });
  const text = await response.text();
  return { response, text, json: JSON.parse(text) as Record<string, unknown> };
}

/** Cookie header value to resend the attempt cookie from a previous response. */
export function attemptCookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0];
}
