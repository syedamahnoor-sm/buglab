import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { useChallengeJourney } from "@/components/challenge/ChallengeJourney";
import { ReflectionPanel } from "@/components/journal/ReflectionPanel";
import { SolveRecorder } from "@/components/journal/SolveRecorder";
import type { AttemptStatus, DiagnosisFeedback } from "@/types/diagnosis";
import type { SubmissionState } from "./useDiagnosisSubmission";

interface DiagnosisResultProps {
  state: SubmissionState;
  secondsUntilRetry: number;
  onRevise: () => void;
  onRetry: () => void;
}

const actionClass =
  "h-7 rounded-md border border-border-strong px-2.5 text-xs text-foreground hover:bg-surface-raised focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function Hints({ feedback }: { feedback: DiagnosisFeedback }) {
  return (
    <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-foreground/85">
      {feedback.hints.map((hint) => (
        <li key={hint}>{hint}</li>
      ))}
    </ul>
  );
}

/**
 * The Learning Loop after a server-confirmed correct diagnosis: record the
 * observed solve (once per confirmation), then offer the optional reflection.
 * Only rendered in the correct branch, so nothing else can record a solve.
 */
function Reflect({ confirmation }: { confirmation: object }) {
  const journey = useChallengeJourney();
  if (!journey) return null;
  return (
    <>
      <SolveRecorder challengeId={journey.challengeId} confirmation={confirmation} />
      <ReflectionPanel challengeId={journey.challengeId} />
    </>
  );
}

/** Where to go once the challenge is solved. The resolution above stays on screen. */
function NextSteps() {
  const journey = useChallengeJourney();
  if (!journey) return null;
  const link =
    "inline-flex h-8 items-center rounded-md px-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return (
    <nav aria-label="Next steps" className="flex flex-wrap items-center gap-2 pt-1">
      {journey.next ? (
        <Link href={journey.next.href} className={`${link} bg-accent text-background hover:bg-accent/90`}>
          Next: Challenge {journey.next.number} · {journey.next.title} →
        </Link>
      ) : (
        <p className="text-xs text-foreground/85">That was the last challenge in the library.</p>
      )}
      <Link href={journey.libraryHref} className={`${link} border border-border-strong text-foreground hover:bg-surface-raised`}>
        Back to the Challenge Library
      </Link>
    </nav>
  );
}

function AttemptsLine({ attempts }: { attempts: AttemptStatus }) {
  return (
    <p className="text-xs text-subtle">
      {attempts.remaining} of {attempts.limit} incorrect attempts left in this 10-minute window.
    </p>
  );
}

export function DiagnosisResult({ state, secondsUntilRetry, onRevise, onRetry }: DiagnosisResultProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const response = state.phase === "done" ? state.response : null;

  // Move focus to the outcome so keyboard and screen reader users hear it.
  useEffect(() => {
    if (response && response.status !== "invalid") regionRef.current?.focus();
  }, [response]);

  let content: ReactNode = null;

  if (state.phase === "submitting") {
    content = (
      <p className="flex items-center gap-2 text-xs text-muted">
        <span
          aria-hidden="true"
          className="size-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent motion-reduce:animate-none"
        />
        Evaluating your diagnosis…
      </p>
    );
  } else if (response?.status === "correct") {
    content = (
      <div className="space-y-2 rounded-md border border-success/40 bg-success/5 p-3">
        <p className="text-sm font-semibold text-success">{response.feedback.headline}</p>
        <p className="text-xs leading-5 text-foreground/90">{response.resolution.summary}</p>
        <Hints feedback={response.feedback} />
        <Reflect confirmation={response} />
        <NextSteps />
      </div>
    );
  } else if (response?.status === "incorrect") {
    content = (
      <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
        <p className="text-sm font-semibold text-warning">{response.feedback.headline}</p>
        <Hints feedback={response.feedback} />
        <AttemptsLine attempts={response.attempts} />
        <button type="button" onClick={onRevise} className={actionClass}>
          Revise diagnosis
        </button>
      </div>
    );
  } else if (response?.status === "rate-limited") {
    content = (
      <div className="space-y-2 rounded-md border border-danger/40 bg-danger/5 p-3">
        <p className="text-sm font-semibold text-danger">Too many incorrect attempts.</p>
        <p className="text-xs text-foreground/85">
          {secondsUntilRetry > 0
            ? `Take another look at the evidence. You can submit again in ${formatDuration(secondsUntilRetry)}.`
            : "You can submit again now."}
        </p>
        <button type="button" onClick={onRevise} disabled={secondsUntilRetry > 0} className={actionClass}>
          Continue
        </button>
      </div>
    );
  } else if (response?.status === "invalid") {
    content = (
      <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-danger">
        Some fields need attention. See the messages above.
      </div>
    );
  } else if (response?.status === "error") {
    content = (
      <div className="space-y-2 rounded-md border border-danger/40 bg-danger/5 p-3">
        <p className="text-sm font-semibold text-danger">Submission failed</p>
        <p className="text-xs text-foreground/85">{response.message}</p>
        <button type="button" onClick={onRetry} className={actionClass}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div ref={regionRef} tabIndex={-1} aria-live="polite" className="outline-none">
      {content}
    </div>
  );
}
