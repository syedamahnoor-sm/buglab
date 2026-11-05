import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ArrowRightIcon, ClockIcon } from "@/components/ui/icons";
import { categoryLabel } from "@/data/catalog/categories";
import { challengePath } from "@/lib/challenge-routes";
import type { PublicChallenge } from "@/types/catalog";
import { difficultyDisplay } from "../difficulty";
import { categoryAccent } from "./category-style";
import { CategoryIcon } from "./CategoryIcon";

export const discoveryCardTitleId = (prefix: string, id: string) => `${prefix}-${id}-title`;

/** Technologies shown on a card before the rest are summarised as "+N". */
const VISIBLE_TECHNOLOGIES = 3;

const chip = "inline-flex items-center rounded-md border border-card-border bg-background/50 px-2 py-0.5 text-xs text-muted";

/**
 * A linked challenge card for the library grid. The whole card is one link,
 * named by its title, so there is exactly one thing to click or tab to.
 * `idPrefix` keeps title ids unique if a challenge is ever rendered twice.
 *
 * The card sits on the page as a raised surface: a lighter fill, a border and
 * a faint top highlight. Its category shows as a small tinted icon tile. On
 * hover or keyboard focus it lifts slightly and its edge and top hairline take
 * the category's hue; under reduced motion only the colours change.
 */
export function DiscoveryCard({ challenge, idPrefix }: { challenge: PublicChallenge; idPrefix: string }) {
  const difficulty = difficultyDisplay[challenge.difficulty];
  const titleId = discoveryCardTitleId(idPrefix, challenge.id);
  const shown = challenge.technologies.slice(0, VISIBLE_TECHNOLOGIES);
  const hidden = challenge.technologies.slice(VISIBLE_TECHNOLOGIES);
  return (
    <Link
      href={challengePath(challenge.id)}
      aria-labelledby={titleId}
      style={categoryAccent(challenge.category)}
      className="category-accent group block h-full rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent"
    >
      <article className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-card-border bg-card p-5 shadow-card transition-[translate,background-color,border-color,box-shadow] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:border-[var(--cat-edge)] group-hover:bg-card-hover group-hover:shadow-card-hover group-focus-visible:border-[var(--cat-edge)] group-focus-visible:bg-card-hover group-active:translate-y-0 group-active:duration-75 motion-reduce:transition-colors motion-reduce:group-hover:translate-y-0">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--cat)] to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2.5 text-xs font-medium text-muted">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-[var(--cat-ring)] bg-[var(--cat-tint)] text-[var(--cat)] transition-colors duration-200 group-hover:bg-[var(--cat-tint-strong)]">
              <CategoryIcon category={challenge.category} />
            </span>
            <span className="truncate">{categoryLabel(challenge.category)}</span>
          </p>
          <Badge tone={difficulty.tone} className="shrink-0">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {difficulty.label}
          </Badge>
        </div>

        <h3
          id={titleId}
          className="mt-4 text-[1.0625rem] font-semibold leading-snug tracking-tight text-foreground transition-colors duration-200 group-hover:text-accent motion-reduce:transition-none"
        >
          {challenge.title}
        </h3>
        <p className="mt-2 line-clamp-3 min-h-[4.875em] text-sm leading-relaxed text-muted">{challenge.description}</p>

        <ul aria-label="Technologies" className="mt-4 flex flex-wrap gap-1.5">
          {shown.map((technology) => (
            <li key={technology}>
              <span className={chip}>{technology}</span>
            </li>
          ))}
          {hidden.length > 0 && (
            <li>
              <span className={chip}>
                <span aria-hidden="true">+{hidden.length}</span>
                <span className="sr-only">and {hidden.join(", ")}</span>
              </span>
            </li>
          )}
        </ul>

        <div className="mt-auto pt-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-card-border pt-4 text-xs">
            <span className="flex items-center gap-3 font-mono text-muted">
              <span>Challenge {challenge.number}</span>
              <span className="flex items-center gap-1">
                <ClockIcon />
                <span className="sr-only">Estimated time: </span>~{challenge.estimatedMinutes} min
              </span>
            </span>
            <span className="flex items-center gap-1 text-sm font-medium text-accent">
              Investigate
              <ArrowRightIcon className="transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
