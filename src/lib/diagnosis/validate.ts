/*
 * Input validation for diagnosis submissions. Shared by the form (for instant
 * feedback) and the API route (authoritative). It checks shape and
 * membership only; it knows nothing about which answer is correct.
 */
import type { DiagnosisFieldError, DiagnosisSubmission } from "@/types/diagnosis";
import type { EvidenceRef } from "@/types/investigation";

export const EXPLANATION_MIN_LENGTH = 40;
export const EXPLANATION_MAX_LENGTH = 2000;
export const EVIDENCE_MIN_ITEMS = 1;
export const EVIDENCE_MAX_ITEMS = 20;

export interface DiagnosisValidationContext {
  rootCauseIds: ReadonlySet<string>;
  logIds: ReadonlySet<string>;
  requestIds: ReadonlySet<string>;
}

export type DiagnosisValidationResult =
  | { ok: true; value: DiagnosisSubmission }
  | { ok: false; errors: DiagnosisFieldError[] };

// Control characters other than tab and newline.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function normalizeExplanation(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(CONTROL_CHARACTERS, "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvidenceRef(
  value: unknown,
  context: DiagnosisValidationContext,
): EvidenceRef | null {
  if (!isRecord(value)) return null;
  if (value.kind === "log" && typeof value.logId === "string" && context.logIds.has(value.logId)) {
    return { kind: "log", logId: value.logId };
  }
  if (
    value.kind === "network" &&
    typeof value.requestId === "string" &&
    context.requestIds.has(value.requestId)
  ) {
    return { kind: "network", requestId: value.requestId };
  }
  return null;
}

/** Validates untrusted input. Unknown extra fields are ignored. */
export function validateDiagnosisSubmission(
  input: unknown,
  context: DiagnosisValidationContext,
): DiagnosisValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: [{ field: "body", message: "Expected a JSON object." }] };
  }

  const errors: DiagnosisFieldError[] = [];

  const rootCauseId = input.rootCauseId;
  if (typeof rootCauseId !== "string" || !context.rootCauseIds.has(rootCauseId)) {
    errors.push({ field: "rootCauseId", message: "Select one of the listed root causes." });
  }

  let explanation = "";
  if (typeof input.explanation !== "string") {
    errors.push({ field: "explanation", message: "Explain your diagnosis." });
  } else {
    explanation = normalizeExplanation(input.explanation);
    if (explanation.length < EXPLANATION_MIN_LENGTH) {
      errors.push({
        field: "explanation",
        message: `Write at least ${EXPLANATION_MIN_LENGTH} characters explaining your reasoning.`,
      });
    } else if (explanation.length > EXPLANATION_MAX_LENGTH) {
      errors.push({
        field: "explanation",
        message: `Keep your explanation under ${EXPLANATION_MAX_LENGTH} characters.`,
      });
    }
  }

  const evidence: EvidenceRef[] = [];
  if (!Array.isArray(input.evidence)) {
    errors.push({ field: "evidence", message: "Evidence must be a list of collected items." });
  } else if (input.evidence.length > EVIDENCE_MAX_ITEMS) {
    errors.push({
      field: "evidence",
      message: `Submit at most ${EVIDENCE_MAX_ITEMS} evidence items.`,
    });
  } else {
    const seen = new Set<string>();
    let invalid = false;
    for (const item of input.evidence) {
      const ref = parseEvidenceRef(item, context);
      if (!ref) {
        invalid = true;
        continue;
      }
      const key = ref.kind === "log" ? `log:${ref.logId}` : `network:${ref.requestId}`;
      if (!seen.has(key)) {
        seen.add(key);
        evidence.push(ref);
      }
    }
    if (invalid) {
      errors.push({
        field: "evidence",
        message: "Some evidence refers to log entries or requests that don't exist.",
      });
    } else if (evidence.length < EVIDENCE_MIN_ITEMS) {
      errors.push({
        field: "evidence",
        message: "Collect at least one log entry or network request as evidence.",
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { rootCauseId: rootCauseId as string, explanation, evidence } };
}
