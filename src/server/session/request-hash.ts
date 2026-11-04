/*
 * A stable fingerprint of a validated diagnosis submission. Server-only.
 *
 * It lets the attempt store tell a retry (same submission id, same content) from
 * a reused id (same submission id, different content). The submission has already
 * been validated and de-duplicated, so the hash covers exactly what was judged:
 * the root cause, the normalized explanation and the set of evidence. Evidence is
 * sorted, so the order the learner collected it in does not matter.
 */
import "server-only";
import { createHash } from "node:crypto";
import { getEvidenceId } from "@/lib/evidence";
import type { DiagnosisSubmission } from "@/types/diagnosis";

export function hashSubmission(submission: DiagnosisSubmission): string {
  const canonical = JSON.stringify([
    submission.rootCauseId,
    submission.explanation,
    submission.evidence.map(getEvidenceId).sort(),
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
