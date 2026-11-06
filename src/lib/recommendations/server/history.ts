import "server-only";
import { toVerifiedCompletion } from "@/lib/verified/model";
import { DIFFICULTIES, DISCONNECTED_HISTORY, type VerifiedHistory } from "../types";
import { isInstant, isRecord } from "../validation";

/** Habin/Claude integration port. Implement per-request identity resolution here only after agreement.
 * Do not trust a request body, invent a learner, link an account, or cache a previous subject's data.
 * A future provider must enforce that subject's consent for browser-local association separately.
 */
export type VerifiedHistoryProvider = (request: Request) => Promise<VerifiedHistory>;
export const disconnectedHistory: VerifiedHistoryProvider = async () => DISCONNECTED_HISTORY;

/** Project even trusted provider results: private session completion/feedback fields are discarded. */
export function sanitizeVerifiedHistory(value: unknown): VerifiedHistory {
  if (!isRecord(value)) return { status: "unavailable" };
  if (["not-connected", "no-learner", "expired", "unavailable"].includes(String(value.status))) return { status: value.status as Exclude<VerifiedHistory["status"], "ready"> };
  if (value.status !== "ready" || !Array.isArray(value.completions) || value.completions.length > 10_000 || !["complete", "partial"].includes(String(value.coverage))) return { status: "unavailable" };
  const completions = value.completions.flatMap((item) => {
    const c = toVerifiedCompletion(item);
    return c && isInstant(c.completedAt) ? [c] : [];
  });
  const evidence = Array.isArray(value.difficultyEvidence) ? value.difficultyEvidence.slice(0,10_000).flatMap((e) =>
    isRecord(e) && typeof e.challengeId === "string" && typeof e.contentVersion === "string" && DIFFICULTIES.includes(e.difficulty as typeof DIFFICULTIES[number])
      ? [{ challengeId: e.challengeId, contentVersion: e.contentVersion, difficulty: e.difficulty as typeof DIFFICULTIES[number] }] : []) : [];
  return { status: "ready", coverage: completions.length === value.completions.length ? value.coverage as "complete" | "partial" : "partial", completions, difficultyEvidence: evidence };
}