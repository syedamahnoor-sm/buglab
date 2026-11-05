"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { categoryLabel } from "@/data/catalog/categories";
import { challengePath } from "@/lib/challenge-routes";
import type { JournalEntry, RecallResponse } from "@/lib/journal/model";
import { suggestRelated } from "@/lib/journal/related";
import { INTERVAL_DAYS } from "@/lib/journal/schedule";
import type { PublicChallenge } from "@/types/catalog";
import { focusRing } from "./ReflectionForm";
import type { ActionResult } from "./useJournal";

type Step = "recall" | "revealed" | "recorded";

/**
 * One recall: the learner writes what they remember, then reveals their own
 * saved takeaway, then says how it went. Self-reported, not graded; what they
 * write while recalling is not stored.
 */
export function RecallCard({
  entry,
  challenge,
  published,
  reflectedIds,
  onRecord,
  onClose,
}: {
  entry: JournalEntry;
  challenge: PublicChallenge;
  published: readonly PublicChallenge[];
  reflectedIds: ReadonlySet<string>;
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

  const suggestion = suggestRelated(challenge, published, reflectedIds);
  // After recording, `entry` is the updated one: its stage is the interval just scheduled.
  const nextDays = INTERVAL_DAYS[Math.min(entry.recall.stage, INTERVAL_DAYS.length - 1)];

  return (
    <article aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-accent/30 bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">
            Challenge {challenge.number} · {categoryLabel(challenge.category)}
          </p>
          <h3 id={`${id}-title`} className="mt-1 text-base font-semibold text-foreground">
            Recall: {challenge.title}
          </h3>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className={`h-8 rounded-md px-2.5 text-xs text-muted hover:text-foreground ${focusRing}`}>
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
          <div className="space-y-1">
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
              className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground focus:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            />
          </div>
          <button
            type="submit"
            disabled={!attempt.trim()}
            className={`h-9 rounded-md bg-accent px-3.5 text-sm font-medium text-background hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          >
            Reveal my takeaway
          </button>
        </form>
      )}

      {step !== "recall" && (
        <div className="space-y-3">
          <h4 ref={revealedRef} tabIndex={-1} className="text-sm font-semibold text-foreground outline-none">
            Your saved takeaway
          </h4>
          <blockquote className="whitespace-pre-line rounded-md border-l-2 border-accent bg-surface-sunken px-3 py-2 text-sm text-foreground">
            {entry.reflection.takeaway}
          </blockquote>
          {attempt.trim() && (
            <div className="text-xs text-muted">
              <p className="font-medium text-foreground">What you just wrote</p>
              <p className="mt-1 whitespace-pre-line">{attempt.trim()}</p>
            </div>
          )}
        </div>
      )}

      {step === "revealed" && (
        <div className="space-y-2">
          <p className="text-sm text-foreground">How did your recall compare?</p>
          <p className="text-xs text-muted">Your own judgement, not a grade. It only decides when you see this again.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => record("got-it")} className={`h-9 rounded-md bg-accent px-3.5 text-sm font-medium text-background hover:bg-accent/90 ${focusRing}`}>
              Got it
            </button>
            <button
              type="button"
              onClick={() => record("need-practice")}
              className={`h-9 rounded-md border border-border-strong px-3.5 text-sm text-foreground hover:bg-surface-raised ${focusRing}`}
            >
              Need practice
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      {step === "recorded" && (
        <div className="space-y-4">
          <p ref={recordedRef} tabIndex={-1} className="text-sm text-success outline-none">
            {response === "got-it" ? "Noted." : "Noted, we'll bring it back soon."} Next recall in {nextDays} {nextDays === 1 ? "day" : "days"}.
          </p>
          {suggestion && (
            <div className="rounded-lg border border-border bg-surface-sunken p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">Apply it</p>
              <p className="mt-1 text-sm text-foreground">
                Try a related investigation: Challenge {suggestion.challenge.number} · {suggestion.challenge.title}
              </p>
              <ul className="mt-1 text-xs text-muted">
                {suggestion.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <Link
                href={challengePath(suggestion.challenge.id)}
                className={`mt-3 inline-flex h-9 items-center rounded-md border border-accent/50 px-3.5 text-sm font-medium text-accent hover:bg-accent/10 ${focusRing}`}
              >
                Open Challenge {suggestion.challenge.number}
              </Link>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
