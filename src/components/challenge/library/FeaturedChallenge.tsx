import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ArrowRightIcon, ClockIcon } from "@/components/ui/icons";
import { categoryLabel } from "@/data/catalog/categories";
import { challengePath } from "@/lib/challenge-routes";
import type { PublicChallenge } from "@/types/catalog";
import { difficultyDisplay } from "../difficulty";
import { categoryAccent } from "./category-style";
import { CategoryIcon } from "./CategoryIcon";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The recommended first case for newcomers: the first challenge labelled
 * beginner, shown with its own description and authored metadata. A curated
 * pointer, not a promotion: no ratings, counts or claims beyond the catalog.
 */
export function FeaturedChallenge({ challenge }: { challenge: PublicChallenge }) {
  const difficulty = difficultyDisplay[challenge.difficulty];
  return (
    <aside
      aria-labelledby="start-here-heading"
      style={categoryAccent(challenge.category)}
      className="relative overflow-hidden rounded-2xl border border-accent/30 bg-card shadow-card"
    >
      <span
        aria-hidden="true"
        className="featured-glow pointer-events-none absolute inset-0"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-accent/80 via-accent/25 to-transparent"
      />
      <div className="relative grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-10">
        <div className="min-w-0">
          <h2 id="start-here-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            New to BugLab? Start here
          </h2>
          <p className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{challenge.title}</p>
          <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted">{challenge.description}</p>
          <ul aria-label="About this challenge" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
            <li>
              <Badge tone={difficulty.tone}>
                <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                {difficulty.label}
              </Badge>
            </li>
            <li className="flex items-center gap-1.5">
              <ClockIcon />
              <span className="sr-only">Estimated time: </span>~{challenge.estimatedMinutes} min
            </li>
            <li className="flex items-center gap-1.5">
              <CategoryIcon category={challenge.category} className="text-[var(--cat)]" />
              {categoryLabel(challenge.category)}
            </li>
            <li className="font-mono">Challenge {challenge.number}</li>
          </ul>
        </div>
        <Link
          href={challengePath(challenge.id)}
          className={`group inline-flex h-11 shrink-0 items-center justify-center gap-2 justify-self-stretch rounded-xl bg-accent cta-gradient px-5 sm:justify-self-start lg:justify-self-end text-sm font-semibold text-background shadow-[0_8px_24px_-10px_var(--accent)] transition-[background-color,box-shadow,scale] duration-200 hover:bg-accent/90 hover:shadow-[0_10px_30px_-8px_var(--accent)] active:scale-[0.98] motion-reduce:transition-colors motion-reduce:active:scale-100 ${focusRing}`}
        >
          Open Challenge {challenge.number}
          <ArrowRightIcon className="transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
        </Link>
      </div>
    </aside>
  );
}
