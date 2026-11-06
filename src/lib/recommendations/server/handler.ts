import "server-only";
import { recommend } from "../engine";
import type { Candidate, RecommendationRequest } from "../types";
import { MAX_REQUEST_BYTES, parseRecommendationQuery, parseRecommendationRequest } from "../validation";
import { recommendationCatalog } from "./catalog";
import { disconnectedHistory, sanitizeVerifiedHistory, type VerifiedHistoryProvider } from "./history";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "Vary": "Cookie, Authorization, Origin", "X-Content-Type-Options": "nosniff" };
const error = (status: number, code: string, message: string) => Response.json({ version: 1, error: { code, message } }, { status, headers: HEADERS });
class BodyError extends Error {
  status: number;
  constructor(status: number) { super("Invalid recommendation request body"); this.status = status; }
}
async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) throw new BodyError(413);
  if (!request.body) throw new BodyError(400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BodyError(408)), 5_000); });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) throw new BodyError(413);
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (cause) {
    void reader.cancel().catch(() => {});
    throw cause;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
export interface HandlerOptions {
  catalog?: () => readonly Candidate[];
  verified?: VerifiedHistoryProvider;
  now?: () => Date;
}
/** Stateless, identity-neutral initial API. No body-derived verified history and no response cache. */
export function createRecommendationHandler(options: HandlerOptions = {}) {
  const catalog = options.catalog ?? recommendationCatalog;
  const verified = options.verified ?? disconnectedHistory;
  const now = options.now ?? (() => new Date());
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "POST") return error(405, "method-not-allowed", "Use GET or POST.");
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin !== null && origin !== new URL(request.url).origin)) return error(403, "refused", "The request was refused.");
    let input: RecommendationRequest;
    try {
      if (request.method === "POST" && request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return error(415, "unsupported-media-type", "Send application/json.");
      const parsed = request.method === "GET" ? parseRecommendationQuery(new URL(request.url).searchParams) : parseRecommendationRequest(await readBody(request));
      if (!parsed.ok) return error(400, "invalid-request", "The recommendation request is invalid.");
      input = parsed.value;
    } catch (cause) {
      const status = cause instanceof BodyError ? cause.status : 400;
      return error(status, status === 413 ? "payload-too-large" : status === 408 ? "request-timeout" : "invalid-request", "The recommendation request could not be read.");
    }
    try {
      // No shared learner object is retained. A provider failure stays unavailable, never ready/empty.
      const history = await verified(request).then(sanitizeVerifiedHistory, () => ({ status: "unavailable" as const }));
      const plan = recommend({ now: now().toISOString(), today: input.today, catalog: catalog(), preferences: input.preferences, local: input.local, verified: history });
      return Response.json(plan, { headers: HEADERS });
    } catch {
      return error(503, "recommendations-unavailable", "Recommendations are temporarily unavailable.");
    }
  };
}