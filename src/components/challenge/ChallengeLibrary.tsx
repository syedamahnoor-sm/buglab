import { Suspense } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { SkipLinks, SkipTarget } from "@/components/layout/SkipLinks";
import { categoryCounts, difficultyCounts } from "@/lib/catalog/discovery";
import type { PublicChallenge } from "@/types/catalog";
import { difficultyDisplay } from "./difficulty";
import { ChallengeExplorer } from "./library/ChallengeExplorer";
import { DiscoveryCard } from "./library/DiscoveryCard";

interface ChallengeLibraryProps {
  /** Published challenges, public metadata only, in catalog order. */
  challenges: PublicChallenge[];
}

export const LIBRARY_HEADING_ID = "challenge-library-heading";
const LIST_TARGET_ID = "challenges";

/**
 * Shown until the interactive explorer is ready (it reads the URL's filters in
 * the browser): every published challenge, unfiltered, so the page is useful
 * without JavaScript and the static shell carries real content.
 */
export function StaticChallengeList({ challenges }: ChallengeLibraryProps) {
  if (challenges.length === 0) return <p className="text-sm text-muted">No challenges are published yet.</p>;
  return (
    <section aria-labelledby="static-all-heading" className="flex flex-col gap-3">
      <h2 id="static-all-heading" className="text-base font-semibold tracking-tight text-foreground">
        All investigations
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {challenges.map((challenge) => (
          <li key={challenge.id}>
            <DiscoveryCard challenge={challenge} idPrefix="static" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Challenge Library page: app header, introduction and the discovery
 * explorer. A server component; it takes the published catalog as props and
 * reads no challenge data itself.
 */
export function ChallengeLibrary({ challenges }: ChallengeLibraryProps) {
  return (
    <>
      <SkipLinks links={[{ target: LIST_TARGET_ID, label: "Skip to challenges" }]} />
      <AppHeader current="challenges" />
      <main
        aria-labelledby={LIBRARY_HEADING_ID}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10"
      >
        <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-wider text-accent">Challenge Library</p>
            <h1 id={LIBRARY_HEADING_ID} className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Every bug has a story.
            </h1>
            <p className="mt-3 text-base leading-relaxed text-muted">
              Each case is a production incident in a realistic codebase. Read the code, follow the logs and network
              traffic, and diagnose the root cause.
            </p>
          </div>
          <LibraryStats challenges={challenges} />
        </header>
        <SkipTarget id={LIST_TARGET_ID} label="Challenges" />
        <Suspense fallback={<StaticChallengeList challenges={challenges} />}>
          <ChallengeExplorer challenges={challenges} />
        </Suspense>
      </main>
    </>
  );
}

/** What the library holds, from the published catalog: totals and the spread of difficulty. */
function LibraryStats({ challenges }: ChallengeLibraryProps) {
  if (challenges.length === 0) return null;
  const difficulties = difficultyCounts(challenges).filter(({ count }) => count > 0);
  return (
    <dl className="hidden shrink-0 flex-wrap gap-x-8 gap-y-3 text-sm sm:flex">
      <div>
        <dt className="text-xs text-subtle">Investigations</dt>
        <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{challenges.length}</dd>
      </div>
      <div>
        <dt className="text-xs text-subtle">Categories</dt>
        <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{categoryCounts(challenges).length}</dd>
      </div>
      <div>
        <dt className="text-xs text-subtle">Difficulty</dt>
        <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
          {difficulties.map(({ id, count }) => (
            <span key={id}>
              <span className="tabular-nums text-foreground">{count}</span> {difficultyDisplay[id].label.toLowerCase()}
            </span>
          ))}
        </dd>
      </div>
    </dl>
  );
}
