"use client";

import Link from "next/link";
import { challengePath } from "@/lib/challenge-routes";
import type { PracticeStatus, Suggestion } from "@/lib/learning/practice";
import type { PublicChallenge } from "@/types/catalog";
import { categoryAccent } from "../challenge/library/category-style";
import { CategoryIcon } from "../challenge/library/CategoryIcon";
import { difficultyDisplay } from "../challenge/difficulty";
import { focusRing } from "./ui";

const STATUS: Record<PracticeStatus, { label: string; className: string }> = {
  suggested: { label: "Suggested", className: "border-card-border bg-field text-muted" },
  opened: { label: "Opened · not solved yet", className: "border-warning/30 bg-warning/10 text-warning" },
  applied: { label: "Applied · confirmed solve after opening", className: "border-success/30 bg-success/10 text-success" },
};

/**
 * Apply: a related challenge to practise after `from`, why it is related, and
 * an honest status. Opening it records only that it was opened; "applied"
 * appears only after a confirmed solve of it that came later.
 */
export function PracticeCard({
  from,
  suggestion,
  status,
  onOpen,
}: {
  from: PublicChallenge;
  suggestion: Suggestion;
  status: PracticeStatus;
  onOpen: () => void;
}) {
  const target = suggestion.challenge;
  const badge = STATUS[status];
  return (
    <li
      style={categoryAccent(target.category)}
      className="category-accent flex h-full flex-col rounded-2xl border border-card-border bg-card p-5 shadow-card transition-[border-color,box-shadow] duration-200 hover:border-[var(--cat-edge)] hover:shadow-card-hover"
    >
      <p className="text-xs text-muted">
        After <span className="text-foreground">{from.title}</span>
      </p>
      <div className="mt-3 flex gap-3">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--cat-ring)] bg-[var(--cat-tint)] text-[var(--cat)]">
          <CategoryIcon category={target.category} />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-foreground">{target.title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            Challenge {target.number} · {difficultyDisplay[target.difficulty].label} · ~{target.estimatedMinutes} min
          </p>
        </div>
      </div>
      <ul aria-label="Why it is related" className="mt-3 flex flex-wrap gap-1.5">
        {suggestion.reasons.map((reason) => (
          <li key={reason} className="rounded-md border border-card-border bg-field px-2 py-0.5 text-xs text-muted">
            {reason}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
        <Link
          href={challengePath(target.id)}
          onClick={onOpen}
          className={`inline-flex h-9 items-center rounded-xl border border-accent/40 px-3.5 text-sm font-medium text-accent transition-colors duration-200 hover:border-accent/70 hover:bg-accent/10 ${focusRing}`}
        >
          {status === "applied" ? "Open again" : `Open Challenge ${target.number}`}
        </Link>
      </div>
    </li>
  );
}
