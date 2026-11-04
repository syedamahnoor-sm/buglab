/*
 * Idempotency keys for diagnosis submissions.
 *
 * One key per logical submission: the same submission (as the server judges
 * sameness) keeps its key, so a retry after a timeout or a dropped connection
 * replays the stored result instead of counting a second attempt. Any change to
 * the submission gets a new key. Keys live only in memory.
 *
 * Sameness mirrors the server's fingerprint of a submission: the root cause,
 * the normalised explanation and the set of evidence (order and duplicates do
 * not matter). Reusing a key for a different submission would be refused (409).
 */
import { getEvidenceId } from "@/lib/evidence";
import { normalizeExplanation } from "@/lib/diagnosis/validate";
import type { DiagnosisSubmission } from "@/types/diagnosis";

/** A random version-4 UUID. Throws if the browser has no Web Crypto. */
export function randomUuid(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues !== "function") throw new Error("Web Crypto is not available.");
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** What makes two submissions the same one. */
export function submissionFingerprint(submission: DiagnosisSubmission): string {
  const evidence = [...new Set(submission.evidence.map(getEvidenceId))].sort();
  return JSON.stringify([submission.rootCauseId, normalizeExplanation(submission.explanation), evidence]);
}

export function createSubmissionKeys(newKey: () => string = randomUuid) {
  let current: { fingerprint: string; key: string } | null = null;
  return {
    /** The key for this submission: the previous one if it is the same submission, else a new one. */
    keyFor(submission: DiagnosisSubmission): string {
      const fingerprint = submissionFingerprint(submission);
      if (current?.fingerprint !== fingerprint) current = { fingerprint, key: newKey() };
      return current.key;
    },
    /** Forget the current key, e.g. after the session restarts, so the next submission is new. */
    reset(): void {
      current = null;
    },
  };
}

export type SubmissionKeys = ReturnType<typeof createSubmissionKeys>;
