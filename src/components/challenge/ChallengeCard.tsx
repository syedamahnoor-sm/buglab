import { Badge } from "@/components/ui/Badge";
import type { ChallengeSummary } from "@/types/workspace";
import { difficultyDisplay } from "./difficulty";

interface ChallengeCardProps {
  /** Public metadata only. The card shows the incident, never its cause. */
  challenge: ChallengeSummary;
}

/** The ID of a card's title, for naming the card from outside (e.g. a link around it). */
export const challengeCardTitleId = (challengeId: string) => `challenge-card-${challengeId}-title`;

/** A compact, presentational summary of one challenge, for lists of challenges. */
export function ChallengeCard({ challenge }: ChallengeCardProps) {
  const difficulty = difficultyDisplay[challenge.difficulty];
  const titleId = challengeCardTitleId(challenge.id);

  return (
    <article
      aria-labelledby={titleId}
      className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle">Challenge {challenge.number}</p>
        <Badge tone={difficulty.tone}>{difficulty.label}</Badge>
      </div>

      <h2 id={titleId} className="text-base font-semibold tracking-tight text-foreground">
        {challenge.title}
      </h2>

      <p className="rounded-md border-l-2 border-danger/60 bg-surface-sunken px-3 py-1.5 text-sm leading-relaxed text-foreground/90">
        <span className="mr-2 text-[11px] font-semibold uppercase tracking-wider text-danger/90">
          Incident
        </span>
        {challenge.incident}
      </p>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <ul aria-label="Topics" className="flex flex-wrap gap-1.5">
          {challenge.tags.map((tag) => (
            <li key={tag}>
              <Badge>{tag}</Badge>
            </li>
          ))}
        </ul>
        <p className="font-mono text-xs text-muted">
          <span className="sr-only">Estimated time: </span>~{challenge.estimatedMinutes} min
        </p>
      </div>
    </article>
  );
}
