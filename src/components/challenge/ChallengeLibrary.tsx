import { Suspense } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { SkipLinks, SkipTarget } from "@/components/layout/SkipLinks";
import type { PublicChallenge } from "@/types/catalog";
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
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12"
      >
        <header className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-wider text-accent">Challenge Library</p>
          <h1 id={LIBRARY_HEADING_ID} className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Every bug has a story.
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted">
            Each case is a production incident in a realistic codebase. Read the code, follow the logs and network
            traffic, and diagnose the root cause.
          </p>
        </header>
        <SkipTarget id={LIST_TARGET_ID} label="Challenges" />
        <Suspense fallback={<StaticChallengeList challenges={challenges} />}>
          <ChallengeExplorer challenges={challenges} />
        </Suspense>
      </main>
    </>
  );
}
