import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ArrowRightIcon, ClockIcon } from "@/components/ui/icons";
import { categoryLabel } from "@/data/catalog/categories";
import { challengePath } from "@/lib/challenge-routes";
import type { PublicChallenge } from "@/types/catalog";
import { difficultyDisplay } from "../difficulty";
import { CategoryIcon } from "./CategoryIcon";

export const discoveryCardTitleId = (prefix: string, id: string) => `${prefix}-${id}-title`;

/** Technologies shown on a card before the rest are summarised as "+N". */
const VISIBLE_TECHNOLOGIES = 3;

/**
 * A linked challenge card for the library grid. The whole card is one link,
 * named by its title, so there is exactly one thing to click or tab to.
 * `idPrefix` keeps title ids unique if a challenge is ever rendered twice.
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
      className="group block h-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <article className="relative flex h-full flex-col rounded-xl border border-border bg-surface p-5 transition-colors duration-150 group-hover:border-border-strong group-hover:bg-surface-raised motion-reduce:transition-none">
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <CategoryIcon category={challenge.category} className="shrink-0 text-subtle" />
            <span className="truncate">{categoryLabel(challenge.category)}</span>
          </p>
          <Badge tone={difficulty.tone}>{difficulty.label}</Badge>
        </div>

        <h3
          id={titleId}
          className="mt-4 text-base font-semibold leading-snug tracking-tight text-foreground transition-colors duration-150 group-hover:text-accent motion-reduce:transition-none"
        >
          {challenge.title}
        </h3>
        <p className="mt-2 line-clamp-3 min-h-[4.875em] text-sm leading-relaxed text-muted">{challenge.description}</p>

        <ul aria-label="Technologies" className="mt-4 flex flex-wrap gap-1.5">
          {shown.map((technology) => (
            <li key={technology}>
              <Badge>{technology}</Badge>
            </li>
          ))}
          {hidden.length > 0 && (
            <li>
              <Badge>
                <span aria-hidden="true">+{hidden.length}</span>
                <span className="sr-only">and {hidden.join(", ")}</span>
              </Badge>
            </li>
          )}
        </ul>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-5 text-xs">
          <span className="flex items-center gap-3 font-mono text-subtle">
            <span>Challenge {challenge.number}</span>
            <span className="flex items-center gap-1">
              <ClockIcon />
              <span className="sr-only">Estimated time: </span>~{challenge.estimatedMinutes} min
            </span>
          </span>
          <span className="flex items-center gap-1 text-sm font-medium text-accent">
            Investigate
            <ArrowRightIcon className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </span>
        </div>
      </article>
    </Link>
  );
}
