import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ArrowRightIcon, ClockIcon } from "@/components/ui/icons";
import { categoryLabel } from "@/data/catalog/categories";
import { challengePath } from "@/lib/challenge-routes";
import type { PublicChallenge } from "@/types/catalog";
import { difficultyDisplay } from "../difficulty";
import { CategoryIcon } from "./CategoryIcon";

export const discoveryCardTitleId = (prefix: string, id: string) => `${prefix}-${id}-title`;

/**
 * A compact, linked challenge card for discovery lists. The whole card is one
 * link, named by its title; `idPrefix` keeps title ids unique when the same
 * challenge appears in more than one section.
 */
export function DiscoveryCard({ challenge, idPrefix }: { challenge: PublicChallenge; idPrefix: string }) {
  const difficulty = difficultyDisplay[challenge.difficulty];
  const titleId = discoveryCardTitleId(idPrefix, challenge.id);
  return (
    <Link
      href={challengePath(challenge.id)}
      aria-labelledby={titleId}
      className="group block h-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <article className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors duration-150 group-hover:border-accent/40 group-focus-visible:border-accent/60">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">
            <CategoryIcon category={challenge.category} className="text-subtle" />
            {categoryLabel(challenge.category)}
          </p>
          <Badge tone={difficulty.tone}>{difficulty.label}</Badge>
        </div>
        <div className="space-y-1.5">
          <p className="font-mono text-xs text-subtle">Challenge {challenge.number}</p>
          <h3 id={titleId} className="text-base font-semibold tracking-tight text-foreground transition-colors duration-150 group-hover:text-accent">
            {challenge.title}
          </h3>
          <p className="text-sm leading-relaxed text-muted">{challenge.description}</p>
        </div>
        <ul aria-label="Technologies" className="flex flex-wrap gap-1.5">
          {challenge.technologies.map((technology) => (
            <li key={technology}>
              <Badge>{technology}</Badge>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
          <span className="flex items-center gap-1.5 font-mono text-muted">
            <ClockIcon />
            <span className="sr-only">Estimated time: </span>~{challenge.estimatedMinutes} min
          </span>
          <span className="flex items-center gap-1 font-medium text-accent">
            Open
            <ArrowRightIcon className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </span>
        </div>
      </article>
    </Link>
  );
}
