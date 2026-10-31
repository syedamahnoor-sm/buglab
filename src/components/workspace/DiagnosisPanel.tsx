import { useState, type FormEvent } from "react";
import { Panel } from "@/components/ui/Panel";
import { ClipboardIcon } from "@/components/ui/icons";
import {
  validateDiagnosisSubmission,
  type DiagnosisValidationContext,
} from "@/lib/diagnosis/validate";
import type { EvidenceSummary } from "@/lib/evidence";
import type { DiagnosisFieldError, RootCauseOption } from "@/types/diagnosis";
import type { EvidenceRef } from "@/types/investigation";
import { DiagnosisResult } from "./diagnosis/DiagnosisResult";
import { EVIDENCE_FIELD_ID, EvidenceReview } from "./diagnosis/EvidenceReview";
import { EXPLANATION_FIELD_ID, ExplanationField } from "./diagnosis/ExplanationField";
import { ROOT_CAUSE_FIELD_ID, RootCauseOptions } from "./diagnosis/RootCauseOptions";
import { useDiagnosisSubmission } from "./diagnosis/useDiagnosisSubmission";
import { useSecondsUntil } from "./diagnosis/useSecondsUntil";

interface DiagnosisPanelProps {
  challengeId: string;
  options: RootCauseOption[];
  evidenceRefs: EvidenceRef[];
  evidence: EvidenceSummary[];
  validationContext: DiagnosisValidationContext;
  onManageEvidence: () => void;
  className?: string;
}

function firstError(errors: DiagnosisFieldError[], field: DiagnosisFieldError["field"]) {
  return errors.find((error) => error.field === field)?.message;
}

function focusField(field: DiagnosisFieldError["field"]) {
  const target =
    field === "rootCauseId"
      ? document.querySelector<HTMLElement>(`#${ROOT_CAUSE_FIELD_ID} input`)
      : document.getElementById(field === "explanation" ? EXPLANATION_FIELD_ID : EVIDENCE_FIELD_ID);
  target?.focus();
}

export function DiagnosisPanel({
  challengeId,
  options,
  evidenceRefs,
  evidence,
  validationContext,
  onManageEvidence,
  className,
}: DiagnosisPanelProps) {
  const [rootCauseId, setRootCauseId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const { state, submit, retry, reset } = useDiagnosisSubmission(challengeId);

  const response = state.phase === "done" ? state.response : null;
  const secondsUntilRetry = useSecondsUntil(
    state.phase === "done" ? state.retryAt : undefined,
    response?.status === "rate-limited" ? response.retryAfterSeconds : 0,
  );

  const isSubmitting = state.phase === "submitting";
  const isConfirmed = response?.status === "correct";
  const isRateLimited = response?.status === "rate-limited" && secondsUntilRetry > 0;

  const validation = validateDiagnosisSubmission(
    { rootCauseId, explanation, evidence: evidenceRefs },
    validationContext,
  );
  const clientErrors = showErrors && !validation.ok ? validation.errors : [];
  const serverErrors = response?.status === "invalid" ? response.errors : [];
  const errors = clientErrors.length > 0 ? clientErrors : serverErrors;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || isConfirmed || isRateLimited) return;

    if (!validation.ok) {
      setShowErrors(true);
      focusField(validation.errors[0].field);
      return;
    }
    void submit(validation.value);
  }

  function revise() {
    reset();
    document.querySelector<HTMLElement>(`#${ROOT_CAUSE_FIELD_ID} input:checked`)?.focus();
  }

  return (
    <Panel
      title="Diagnosis"
      icon={<ClipboardIcon />}
      className={className}
      bodyClassName="p-3"
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <fieldset disabled={isSubmitting || isConfirmed} className="flex flex-col gap-4">
          <RootCauseOptions
            options={options}
            value={rootCauseId}
            onChange={setRootCauseId}
            error={firstError(errors, "rootCauseId")}
          />
          <ExplanationField
            value={explanation}
            onChange={setExplanation}
            error={firstError(errors, "explanation")}
          />
        </fieldset>

        <EvidenceReview
          evidence={evidence}
          error={firstError(errors, "evidence")}
          onManage={onManageEvidence}
        />

        <DiagnosisResult
          state={state}
          secondsUntilRetry={secondsUntilRetry}
          onRevise={revise}
          onRetry={retry}
        />

        {!isConfirmed && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-subtle">
              Your draft and evidence reset on refresh.
            </p>
            <button
              type="submit"
              disabled={isSubmitting || isRateLimited}
              aria-busy={isSubmitting || undefined}
              className="h-8 shrink-0 rounded-md bg-accent px-3 text-sm font-medium text-background hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? "Submitting…" : "Submit diagnosis"}
            </button>
          </div>
        )}
      </form>
    </Panel>
  );
}
