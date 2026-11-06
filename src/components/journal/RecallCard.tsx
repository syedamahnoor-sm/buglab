"use client";

import { useEffect, useId, useRef, useState } from "react";
import { categoryLabel } from "@/data/catalog/categories";
import type { LocalDay, RecallResponse, ReflectionEntry } from "@/lib/learning/model";
import type { PublicChallenge } from "@/types/catalog";
import { categoryAccent } from "../challenge/library/category-style";
import { CategoryIcon } from "../challenge/library/CategoryIcon";
import { dueLabel, nextReviewLabel } from "./format";
import { REFLECTION_PROMPTS } from "./ReflectionForm";
import { buttonPrimary, buttonQuiet, buttonSecondary, field } from "./ui";
import type { ActionResult } from "./useLearning";

type Step = "recall" | "revealed" | "recorded";

/**
 * One recall: the learner writes what they remember, then reveals their own
 * saved takeaway, then says how it went. Self-reported, not graded; what they
 * write while recalling is not stored.
 */
export function RecallCard({
  entry,
  challenge,
  today,
  onRecord,
  onClose,
}: {
  entry: ReflectionEntry;
  challenge: PublicChallenge;
  today: LocalDay;
  onRecord: (response: RecallResponse) => ActionResult;
  onClose?: () => void;
}) {
  const [step, setStep] = useState<Step>("recall");
  const [attempt, setAttempt] = useState("");
  const [response, setResponse] = useState<RecallResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revealedRef = useRef<HTMLHeadingElement>(null);
  const recordedRef = useRef<HTMLParagraphElement>(null);
  const id = useId();

  // Move focus to what just appeared, so keyboard and screen-reader users follow along.
  useEffect(() => {
    if (step === "revealed") revealedRef.current?.focus();
    if (step === "recorded") recordedRef.current?.focus();
  }, [step]);

  function record(choice: RecallResponse) {
    const result = onRecord(choice);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setResponse(choice);
    setStep("recorded");
  }

  const notes = REFLECTION_PROMPTS.filter((prompt) => entry.reflection[prompt.key]);

  return (
    <article aria-labelledby={`${id}-title`} style={categoryAccent(challenge.category)} className="category-accent space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--cat-ring)] bg-[var(--cat-tint)] text-[var(--cat)]">
            <CategoryIcon category={challenge.category} />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted">
              Challenge {challenge.number} · {categoryLabel(challenge.category)} · <span className="text-foreground">{dueLabel(entry.recall.dueOn, today)}</span>
            </p>
            <h3 id={`${id}-title`} className="mt-1 text-lg font-semibold tracking-tight text-foreground">
              {challenge.title}
            </h3>
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className={buttonQuiet}>
            Close
          </button>
        )}
      </header>

      {step === "recall" && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (attempt.trim()) setStep("revealed");
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor={`${id}-attempt`} className="block text-sm font-medium text-foreground">
              Before you look: what caused this bug, and how would you spot it again?
            </label>
            <p id={`${id}-attempt-hint`} className="text-xs text-muted">
              Write it from memory. This is just for you and is not saved.
            </p>
            <textarea
              id={`${id}-attempt`}
              rows={3}
              maxLength={600}
              aria-describedby={`${id}-attempt-hint`}
              value={attempt}
              onChange={(event) => setAttempt(event.target.value)}
              className={field}
            />
          </div>
          <button type="submit" disabled={!attempt.trim()} className={buttonPrimary}>
            Reveal my takeaway
          </button>
        </form>
      )}

      {step !== "recall" && (
        <div className="animate-rise space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-panel-border bg-panel p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">What you just wrote</p>
              <p className="mt-1.5 whitespace-pre-line text-sm text-foreground">{attempt.trim()}</p>
            </div>
            <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-3.5">
              <h4 ref={revealedRef} tabIndex={-1} className="text-xs font-semibold uppercase tracking-wider text-accent outline-none">
                Your saved takeaway
              </h4>
              <blockquote className="mt-1.5 whitespace-pre-line text-sm font-medium text-foreground">{entry.reflection.takeaway}</blockquote>
            </div>
          </div>
          {notes.length > 0 && (
            <details className="group rounded-xl border border-card-border bg-card px-3.5 py-2.5">
              <summary className="cursor-pointer text-sm font-medium text-foreground marker:text-subtle">Your other notes</summary>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {notes.map((prompt) => (
                  <div key={prompt.key}>
                    <dt className="text-xs text-muted">{prompt.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-line text-sm text-foreground">{entry.reflection[prompt.key]}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      )}

      {step === "revealed" && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">How did your recall compare?</p>
          <p className="text-xs text-muted">Your own judgement, not a grade. It only decides when you see this again.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => record("got-it")} className={buttonPrimary}>
              Got it
            </button>
            <button type="button" onClick={() => record("need-practice")} className={buttonSecondary}>
              Need practice
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      {step === "recorded" && (
        <p ref={recordedRef} tabIndex={-1} className="animate-rise rounded-xl border border-success/30 bg-success/10 px-3.5 py-2.5 text-sm text-success outline-none">
          {response === "got-it" ? "Noted." : "Noted: it comes back soon."} {nextReviewLabel(entry.recall.dueOn, today)}.
        </p>
      )}
    </article>
  );
}
