import Link from "next/link";
import type { ChallengeSummary } from "@/types/workspace";
import { ChallengeCard, challengeCardTitleId } from "./ChallengeCard";

export interface ChallengeLibraryEntry {
  /** Public metadata only, as the catalog lists it. */
  challenge: ChallengeSummary;
  /** Where the challenge is played. */
  href: string;
}

interface ChallengeLibraryProps {
  /** In display order. */
  entries: readonly ChallengeLibraryEntry[];
}

export const LIBRARY_HEADING_ID = "challenge-library-heading";

const countLabel = (count: number) => `${count} ${count === 1 ? "challenge" : "challenges"} available`;

/**
 * The challenge library: one linked card per challenge. A server component;
 * it takes its entries as props and reads no challenge data itself.
 */
export function ChallengeLibrary({ entries }: ChallengeLibraryProps) {
  return (
    <main
      aria-labelledby={LIBRARY_HEADING_ID}
      className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10"
    >
      <header className="flex max-w-3xl flex-col gap-2">
        <p className="font-mono text-xs text-subtle">BugLab</p>
        <h1 id={LIBRARY_HEADING_ID} className="text-2xl font-semibold tracking-tight text-foreground">
          Challenge Library
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          Each challenge is a production incident in a realistic codebase. Read the code, follow the logs
          and network traffic, and diagnose the root cause.
        </p>
        <p className="font-mono text-xs text-subtle">{countLabel(entries.length)}</p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-muted">No challenges are available yet.</p>
      ) : (
        <ul aria-labelledby={LIBRARY_HEADING_ID} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map(({ challenge, href }) => (
            <li key={challenge.id}>
              {/* Named by the card's title; the card itself holds no controls. */}
              <Link
                href={href}
                aria-labelledby={challengeCardTitleId(challenge.id)}
                className="block h-full rounded-lg transition-colors hover:[&>article]:border-border-strong hover:[&>article]:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <ChallengeCard challenge={challenge} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
