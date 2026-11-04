import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { SkipLinks, SkipTarget } from "@/components/layout/SkipLinks";
import { ArrowRightIcon, FolderIcon } from "@/components/ui/icons";
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
const AVAILABLE_HEADING_ID = "available-challenges-heading";
const LIST_TARGET_ID = "challenges";

const countLabel = (count: number) => `${count} ${count === 1 ? "challenge" : "challenges"} available`;

/**
 * The challenge library page: app header, an editorial introduction and one
 * linked case-file card per challenge, in a reading-width column. A server
 * component; it takes its entries as props and reads no challenge data itself.
 */
export function ChallengeLibrary({ entries }: ChallengeLibraryProps) {
  return (
    <>
      <SkipLinks links={[{ target: LIST_TARGET_ID, label: "Skip to challenges" }]} />
      <AppHeader current="challenges" />
      <main
        aria-labelledby={LIBRARY_HEADING_ID}
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14"
      >
        <header className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-wider text-accent">Challenge Library</p>
          <h1
            id={LIBRARY_HEADING_ID}
            className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Every bug has a story.
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted">
            Each case is a production incident in a realistic codebase. Read the code, follow the logs and network
            traffic, and diagnose the root cause.
          </p>
        </header>

        <section aria-labelledby={AVAILABLE_HEADING_ID} className="flex flex-col gap-2">
          <div className="flex h-9 items-center justify-between gap-2 px-1">
            <h2
              id={AVAILABLE_HEADING_ID}
              className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted"
            >
              <FolderIcon className="text-subtle" />
              Available challenges
            </h2>
            <p className="font-mono text-[11px] text-subtle">{countLabel(entries.length)}</p>
          </div>
          <SkipTarget id={LIST_TARGET_ID} label="Challenges" />

          {entries.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
              No challenges are available yet.
            </p>
          ) : (
            // One case spans the column; from two cases up they pair off on wide screens.
            <ul
              aria-labelledby={AVAILABLE_HEADING_ID}
              className={entries.length > 1 ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}
            >
              {entries.map(({ challenge, href }) => (
                <li key={challenge.id}>
                  {/* Named by the card's title; the card itself holds no controls. */}
                  <Link
                    href={href}
                    aria-labelledby={challengeCardTitleId(challenge.id)}
                    className="group block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <ChallengeCard
                      challenge={challenge}
                      titleAs="h3"
                      action={
                        <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-background transition-colors duration-150 group-hover:bg-accent/85">
                          Open investigation
                          <ArrowRightIcon className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                        </span>
                      }
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
