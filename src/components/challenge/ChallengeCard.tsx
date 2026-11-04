import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { BugIcon, ClockIcon } from "@/components/ui/icons";
import type { ChallengeSummary } from "@/types/workspace";
import { difficultyDisplay } from "./difficulty";

interface ChallengeCardProps {
  /** Public metadata only. The card shows the incident, never its cause. */
  challenge: ChallengeSummary;
  /** Optional call to action shown under the metadata, e.g. when the card is a link. */
  action?: ReactNode;
  /** The title's heading level, to fit the page's outline. */
  titleAs?: "h2" | "h3";
}

/** The ID of a card's title, for naming the card from outside (e.g. a link around it). */
export const challengeCardTitleId = (challengeId: string) => `challenge-card-${challengeId}-title`;

const labelClass = "text-[11px] uppercase tracking-wider text-subtle";

/**
 * A challenge presented as a case file: a title strip, the case title and its
 * incident report, then the metadata. It lays itself out by its own width (a
 * container query): side by side when wide, stacked when narrow, so it works
 * full width or in a grid. Its hover and focus styles follow the nearest
 * `group` ancestor, such as a link around it.
 */
export function ChallengeCard({ challenge, action, titleAs: Title = "h2" }: ChallengeCardProps) {
  const difficulty = difficultyDisplay[challenge.difficulty];
  const titleId = challengeCardTitleId(challenge.id);

  return (
    <article
      aria-labelledby={titleId}
      className="@container flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors duration-150 group-hover:border-accent/40 group-focus-visible:border-accent/60"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-4">
        <BugIcon className="shrink-0 text-subtle" />
        <p className="truncate font-mono text-xs text-muted">Challenge {challenge.number}</p>
      </div>

      <div className="flex flex-1 flex-col gap-5 p-4 sm:p-5 @2xl:flex-row @2xl:gap-8">
        <div className="min-w-0 flex-1 space-y-4">
          <Title
            id={titleId}
            className="text-xl font-semibold tracking-tight text-foreground transition-colors duration-150 group-hover:text-accent"
          >
            {challenge.title}
          </Title>
          <div className="overflow-hidden rounded-md border border-border bg-surface-sunken">
            <p className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-danger" />
              Incident report
            </p>
            <p className="px-3 py-2.5 text-sm leading-relaxed text-foreground/90">{challenge.incident}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 @2xl:w-64 @2xl:shrink-0 @2xl:border-l @2xl:border-border @2xl:pl-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm @2xl:grid-cols-1">
            <div>
              <dt className={labelClass}>Difficulty</dt>
              <dd className="mt-1">
                <Badge tone={difficulty.tone}>{difficulty.label}</Badge>
              </dd>
            </div>
            <div>
              <dt className={labelClass}>Est. time</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-mono text-muted">
                <ClockIcon />~{challenge.estimatedMinutes} min
              </dd>
            </div>
            <div className="col-span-2 @2xl:col-span-1">
              <dt className={labelClass}>Topics</dt>
              <dd className="mt-1">
                <ul className="flex flex-wrap gap-1.5">
                  {challenge.tags.map((tag) => (
                    <li key={tag}>
                      <Badge>{tag}</Badge>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
          {action && <div className="mt-auto">{action}</div>}
        </div>
      </div>
    </article>
  );
}
