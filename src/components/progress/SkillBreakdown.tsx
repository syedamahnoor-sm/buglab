import Link from "next/link";
import { focusRing } from "@/components/journal/ui";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/icons";
import { challengePath, ROUTES } from "@/lib/challenge-routes";
import type { CategoryProgress } from "@/lib/progress/skills";
import { categoryAccent } from "../challenge/library/category-style";
import { CategoryIcon } from "../challenge/library/CategoryIcon";
import { SectionHeading } from "./shared";

const libraryLink = (category: string) => `${ROUTES.library}?category=${encodeURIComponent(category)}`;

/**
 * Skill Breakdown: solved out of published for each category, as counts and
 * a segmented bar (one segment per challenge). Coverage only: no mastery or
 * skill scores, because one solve says nothing reliable about either.
 */
export function SkillBreakdown({ id, categories }: { id: string; categories: CategoryProgress[] }) {
  const explored = categories.filter((category) => category.explored).length;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <SectionHeading
        id={id}
        eyebrow="03"
        title="Skill breakdown"
        detail={`${explored} of ${categories.length} categories explored. Counts of solved challenges, not a measure of skill.`}
      />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => (
          <CategoryCard key={category.id} category={category} />
        ))}
      </ul>
    </section>
  );
}

function CategoryCard({ category }: { category: CategoryProgress }) {
  const headingId = `skill-${category.id}`;
  const ordered = [...category.challenges].sort((a, b) => Number(b.solved) - Number(a.solved));
  return (
    <li
      style={categoryAccent(category.id)}
      className="category-accent flex flex-col rounded-2xl border border-card-border bg-card p-5 shadow-card transition-[border-color,box-shadow] duration-200 hover:border-[var(--cat-edge)] hover:shadow-card-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--cat-ring)] bg-[var(--cat-tint)] text-[var(--cat)]">
            <CategoryIcon category={category.id} />
          </span>
          <h3 id={headingId} className="min-w-0 text-[0.9375rem] font-semibold leading-snug tracking-tight text-foreground">
            {category.label}
          </h3>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${
            category.explored ? "border-[var(--cat-ring)] bg-[var(--cat-tint)] text-foreground" : "border-card-border bg-field text-muted"
          }`}
        >
          {category.explored ? "Explored" : "Not explored yet"}
        </span>
      </div>

      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{category.solved}</span>
        <span className="text-sm text-muted">of {category.total} solved</span>
      </p>
      <div role="img" aria-label={`${category.solved} of ${category.total} solved`} className="mt-2 flex gap-1">
        {ordered.map(({ challenge, solved }) => (
          <span key={challenge.id} className={`h-1.5 flex-1 rounded-full ${solved ? "bg-[var(--cat)]" : "bg-field ring-1 ring-inset ring-card-border"}`} />
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">{category.description}</p>

      <details className="group/details mt-4 rounded-xl border border-panel-border bg-panel">
        <summary className={`flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden ${focusRing}`}>
          {category.total} challenges
          <span aria-hidden="true" className="transition-transform duration-200 group-open/details:rotate-90">
            <ArrowRightIcon />
          </span>
        </summary>
        <ul className="flex flex-col gap-0.5 px-1.5 pb-1.5">
          {category.challenges.map(({ challenge, solved, completion }) => (
            <li key={challenge.id}>
              <Link
                href={challengePath(challenge.id)}
                className={`flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs transition-colors hover:bg-hover-fill ${focusRing}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-4 shrink-0 place-items-center rounded-full ${solved ? "bg-[var(--cat)] text-background" : "ring-1 ring-inset ring-card-border-hover"}`}
                >
                  {solved ? <CheckIcon width={10} height={10} strokeWidth={2.2} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{challenge.title}</span>
                <span className="shrink-0 text-subtle">{completion === "verified" || completion === "verified-elsewhere" ? "Verified" : solved ? "Solved" : `#${challenge.number}`}</span>
              </Link>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-4 text-sm">
        {category.next ? (
          <Link href={challengePath(category.next.id)} className={`min-w-0 rounded font-medium text-accent underline-offset-4 hover:underline ${focusRing}`}>
            {category.explored ? "Next" : "Start"}: Challenge {category.next.number}
          </Link>
        ) : (
          <span className="text-xs font-medium text-success">All {category.total} solved here</span>
        )}
        <Link href={libraryLink(category.id)} className={`rounded text-xs text-muted underline-offset-4 hover:text-foreground hover:underline ${focusRing}`}>
          View in library
        </Link>
      </div>
    </li>
  );
}
