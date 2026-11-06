import type { ReactNode } from "react";
import { sectionTitle } from "@/components/journal/ui";
import type { PublicChallenge } from "@/types/catalog";
import { difficultyDisplay } from "../challenge/difficulty";

/** A section heading with an optional line of context, matching the Journal. */
export function SectionHeading({ id, title, detail, eyebrow }: { id: string; title: string; detail?: ReactNode; eyebrow?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {eyebrow ? <p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-subtle">{eyebrow}</p> : null}
      <h2 id={id} className={sectionTitle}>
        {title}
      </h2>
      {detail ? <p className="text-sm leading-relaxed text-muted">{detail}</p> : null}
    </div>
  );
}

/** "Challenge 4 · Beginner · ~15 min" */
export function challengeMeta(challenge: PublicChallenge): string {
  return `Challenge ${challenge.number} · ${difficultyDisplay[challenge.difficulty].label} · ~${challenge.estimatedMinutes} min`;
}

/** A challenge's title by ID, or a plain description when it is no longer published. */
export function titleOf(byId: ReadonlyMap<string, PublicChallenge>, challengeId: string): string {
  return byId.get(challengeId)?.title ?? "a challenge no longer in the catalog";
}
