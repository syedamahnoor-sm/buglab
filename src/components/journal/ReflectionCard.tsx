"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { categoryLabel } from "@/data/catalog/categories";
import { challengePath } from "@/lib/challenge-routes";
import type { LocalDay, ObservedSolve, ReflectionEntry } from "@/lib/learning/model";
import { isDue } from "@/lib/learning/schedule";
import type { PublicChallenge } from "@/types/catalog";
import { categoryAccent } from "../challenge/library/category-style";
import { CategoryIcon } from "../challenge/library/CategoryIcon";
import { dueLabel, formatInstant } from "./format";
import { REFLECTION_PROMPTS, ReflectionForm } from "./ReflectionForm";
import { buttonDanger, buttonQuiet, buttonSmall, focusRing } from "./ui";
import type { ActionResult } from "./useLearning";

/**
 * One reflection in the journal: the challenge, when it was solved and
 * reflected on, when it is next due, the takeaway, and the learner's notes.
 * Edit in place; delete asks first.
 */
export function ReflectionCard({
  entry,
  solve,
  challenge,
  today,
  onReview,
  onSave,
  onDelete,
}: {
  entry: ReflectionEntry;
  solve: ObservedSolve | undefined;
  challenge: PublicChallenge;
  today: LocalDay;
  onReview: () => void;
  onSave: (reflection: ReflectionEntry["reflection"]) => ActionResult;
  onDelete: () => ActionResult;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const due = isDue(entry, today);
  const notes = REFLECTION_PROMPTS.filter((prompt) => entry.reflection[prompt.key]);

  useEffect(() => {
    if (mode === "confirm-delete") confirmRef.current?.focus();
  }, [mode]);

  return (
    <article
      aria-labelledby={`${id}-title`}
      style={categoryAccent(challenge.category)}
      className="category-accent relative rounded-2xl border border-card-border bg-card p-5 shadow-card transition-[border-color,box-shadow] duration-200 hover:border-[var(--cat-edge)] hover:shadow-card-hover sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--cat-ring)] bg-[var(--cat-tint)] text-[var(--cat)]">
            <CategoryIcon category={challenge.category} />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted">
              {categoryLabel(challenge.category)} · Challenge {challenge.number}
            </p>
            <h3 id={`${id}-title`} className="mt-0.5 text-base font-semibold tracking-tight">
              <Link href={challengePath(challenge.id)} className={`rounded-sm text-foreground hover:text-accent ${focusRing}`}>
                {challenge.title}
              </Link>
            </h3>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${
            due ? "border-accent/40 bg-accent/10 text-accent" : "border-card-border bg-field text-muted"
          }`}
        >
          <span aria-hidden="true" className={`size-1.5 rounded-full ${due ? "bg-accent" : "bg-subtle"}`} />
          {dueLabel(entry.recall.dueOn, today)}
        </span>
      </header>

      <p className="mt-2 text-xs text-subtle">
        {solve && <>Solved {formatInstant(solve.lastSolvedAt)} · </>}Reflected {formatInstant(entry.reflectedAt)}
        {entry.updatedAt !== entry.reflectedAt && <> · edited {formatInstant(entry.updatedAt)}</>}
        {entry.recall.attempts.length > 0 && <> · reviewed {entry.recall.attempts.length}×</>}
      </p>

      {mode === "edit" ? (
        <div className="mt-4">
          <ReflectionForm
            initial={entry.reflection}
            submitLabel="Save changes"
            onCancel={() => setMode("view")}
            onSubmit={(reflection) => {
              const result = onSave(reflection);
              if (!result.ok) return result.message;
              setMode("view");
              return null;
            }}
          />
        </div>
      ) : (
        <>
          <blockquote className="mt-4 border-l-2 border-[var(--cat)] pl-3.5 text-[0.9375rem] leading-relaxed text-foreground">
            {entry.reflection.takeaway}
          </blockquote>
          {notes.length > 0 && (
            <details className="mt-3">
              <summary className={`cursor-pointer rounded-sm text-sm font-medium text-accent marker:text-subtle ${focusRing}`}>
                Your notes ({notes.length})
              </summary>
              <dl className="mt-3 grid gap-3 rounded-xl border border-panel-border bg-panel p-3.5 sm:grid-cols-2">
                {notes.map((prompt) => (
                  <div key={prompt.key}>
                    <dt className="text-xs text-muted">{prompt.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-line text-sm text-foreground">{entry.reflection[prompt.key]}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}

          {mode === "confirm-delete" ? (
            <div role="group" aria-label="Confirm delete" className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-danger/30 bg-danger/[0.06] p-3">
              <p className="mr-auto text-sm text-foreground">Delete this reflection and its recall schedule? The solve stays recorded.</p>
              <button
                ref={confirmRef}
                type="button"
                onClick={() => {
                  const result = onDelete();
                  if (!result.ok) setError(result.message);
                }}
                className={buttonDanger}
              >
                Yes, delete
              </button>
              <button type="button" onClick={() => setMode("view")} className={buttonQuiet}>
                Keep it
              </button>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={onReview} className={buttonSmall}>
                {due ? "Start recall" : "Review now"}
              </button>
              <button type="button" onClick={() => setMode("edit")} className={buttonSmall}>
                Edit
              </button>
              <button type="button" onClick={() => setMode("confirm-delete")} className={buttonQuiet}>
                Delete
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </article>
  );
}
