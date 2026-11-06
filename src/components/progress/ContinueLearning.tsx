"use client";

import Link from "next/link";
import { dueLabel, plural } from "@/components/journal/format";
import type { LearningActions } from "@/components/journal/useLearning";
import { focusRing } from "@/components/journal/ui";
import { ArrowRightIcon } from "@/components/ui/icons";
import { categoryLabel } from "@/data/catalog/categories";
import { challengePath, journalSection, ROUTES } from "@/lib/challenge-routes";
import type { LocalDay } from "@/lib/learning/model";
import type { NextStep } from "@/lib/progress/next-steps";
import { categoryAccent } from "../challenge/library/category-style";
import { CategoryIcon } from "../challenge/library/CategoryIcon";
import { challengeMeta, SectionHeading } from "./shared";

const KIND = {
  recall: { label: "Recall due", className: "border-warning/30 bg-warning/10 text-warning" },
  reflect: { label: "Reflect", className: "border-accent/30 bg-accent/10 text-accent" },
  apply: { label: "Apply", className: "border-success/30 bg-success/10 text-success" },
  explore: { label: "Explore", className: "border-card-border bg-field text-muted" },
} as const;

const BASIS = { "your-record": "From your journal", catalog: "From the catalog" } as const;

interface StepCopy {
  title: string;
  detail: string;
  note?: string;
  cta: string;
  href: string;
  onOpen?: () => void;
}

function copy(step: NextStep, today: LocalDay, actions: LearningActions): StepCopy {
  switch (step.kind) {
    case "recall":
      return {
        title: `Recall your takeaway from ${step.challenge.title}`,
        detail: `${dueLabel(step.dueOn, today)}. Write what you remember before you look.`,
        note: step.more ? `${plural(step.more, "more review")} due` : undefined,
        cta: "Start recall",
        href: journalSection("recall"),
      };
    case "reflect":
      return {
        title: `Write a takeaway for ${step.challenge.title}`,
        detail: "Solved, but not reflected on yet. A takeaway is what comes back for recall.",
        note: step.more ? `${plural(step.more, "more challenge")} to reflect on` : undefined,
        cta: "Reflect in the Journal",
        href: journalSection("awaiting"),
      };
    case "apply":
      return {
        title: `Practise on ${step.challenge.title}`,
        detail: `Apply what you learned on ${step.from.title}.${step.reasons[0] ? ` ${step.reasons[0]}` : ""}`,
        note: step.status === "opened" ? "Opened · not solved yet" : undefined,
        cta: `Open Challenge ${step.challenge.number}`,
        href: challengePath(step.challenge.id),
        // The same record the Journal keeps, so "Applied" can follow a later confirmed solve.
        onOpen: () => actions.recordPracticeOpened(step.from.id, step.challenge.id),
      };
    case "explore":
      return {
        title: step.firstSolve ? `Start with ${step.challenge.title}` : step.newCategory ? `Explore ${categoryLabel(step.category)}` : `Next: ${step.challenge.title}`,
        detail: step.newCategory && !step.firstSolve
          ? `Nothing solved in this category yet. ${step.challenge.title} is the library's recommended starting point.`
          : `${challengeMeta(step.challenge)}. The library's recommended next challenge.`,
        cta: `Open Challenge ${step.challenge.number}`,
        href: challengePath(step.challenge.id),
      };
  }
}

/**
 * Continue Learning: the next few steps, most time-sensitive first. Each one
 * opens the place where the work is done (the Journal or a challenge), so
 * nothing here is a second copy of the Journal.
 */
export function ContinueLearning({ id, steps, today, actions }: { id: string; steps: NextStep[]; today: LocalDay; actions: LearningActions }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <SectionHeading
        id={id}
        eyebrow="02"
        title="Continue learning"
        detail="Due recall first, then reflections you haven't written, then practice and new ground."
      />
      {steps.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-card px-6 py-8 text-sm leading-relaxed text-muted shadow-card">
          <p className="font-medium text-foreground">Nothing waiting right now.</p>
          <p className="mt-1">
            Every published challenge is solved here and no review is due. Recall reviews appear when they come round; see the{" "}
            <Link href={ROUTES.journal} className={`rounded text-accent underline-offset-4 hover:underline ${focusRing}`}>
              Journal
            </Link>{" "}
            for their dates.
          </p>
        </div>
      ) : (
        <ol className="grid gap-4 sm:grid-cols-2">
          {steps.map((step, index) => {
            const text = copy(step, today, actions);
            const kind = KIND[step.kind];
            return (
              <li
                key={`${step.kind}-${step.challenge.id}`}
                style={categoryAccent(step.challenge.category)}
                className="category-accent group relative flex flex-col rounded-2xl border border-card-border bg-card p-5 shadow-card transition-[border-color,box-shadow,background-color] duration-200 hover:border-[var(--cat-edge)] hover:bg-card-hover hover:shadow-card-hover"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-subtle">{String(index + 1).padStart(2, "0")}</span>
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${kind.className}`}>{kind.label}</span>
                  </span>
                  <span className="text-xs text-subtle">{BASIS[step.basis]}</span>
                </div>
                <div className="mt-4 flex gap-3">
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--cat-ring)] bg-[var(--cat-tint)] text-[var(--cat)]">
                    <CategoryIcon category={step.challenge.category} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground">{text.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{text.detail}</p>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                  {text.note ? <span className="text-xs text-subtle">{text.note}</span> : <span aria-hidden="true" />}
                  <Link
                    href={text.href}
                    onClick={text.onOpen}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-xl border border-accent/40 px-3.5 text-sm font-medium text-accent transition-colors duration-200 hover:border-accent/70 hover:bg-accent/10 ${focusRing}`}
                  >
                    {text.cta}
                    <ArrowRightIcon />
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-xs leading-relaxed text-subtle">
        &ldquo;From your journal&rdquo; steps come from what you have done in this browser. &ldquo;From the catalog&rdquo; steps follow the
        Challenge Library&apos;s recommended order, the same for everyone. Nothing here is personalised, and there is no account behind it.
      </p>
    </section>
  );
}
