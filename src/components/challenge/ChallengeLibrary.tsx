import { Suspense } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SkipLinks, SkipTarget } from "@/components/layout/SkipLinks";
import { categoryCounts, difficultyCounts } from "@/lib/catalog/discovery";
import type { PublicChallenge } from "@/types/catalog";
import { difficultyDisplay } from "./difficulty";
import { ChallengeExplorer } from "./library/ChallengeExplorer";
import { DiscoveryCard } from "./library/DiscoveryCard";
import { CHALLENGE_GRID } from "./library/layout";

interface ChallengeLibraryProps {
  /** Published challenges, public metadata only, in catalog order. */
  challenges: PublicChallenge[];
}

export const LIBRARY_HEADING_ID = "challenge-library-heading";
const LIST_TARGET_ID = "challenges";

/** What a learner does with a challenge, in order. Describes the workspace as it is. */
const STEPS = [
  { title: "Pick a case", detail: "Choose an incident by category or difficulty." },
  { title: "Investigate", detail: "Read the code, logs and network traffic." },
  { title: "Diagnose", detail: "Name the root cause and back it with evidence." },
] as const;

const DOT: Record<string, string> = { success: "text-success", warning: "text-warning", danger: "text-danger" };

/**
 * Shown until the interactive explorer is ready (it reads the URL's filters in
 * the browser): every published challenge, unfiltered, so the page is useful
 * without JavaScript and the static shell carries real content. With scripts
 * on, CSS shows only the first page, as the explorer will.
 */
export function StaticChallengeList({ challenges }: ChallengeLibraryProps) {
  if (challenges.length === 0) return <p className="text-sm text-muted">No challenges are published yet.</p>;
  return (
    <section aria-labelledby="static-all-heading" className="flex flex-col gap-4">
      <h2 id="static-all-heading" className="text-base font-semibold tracking-tight text-foreground">
        All investigations
      </h2>
      <ul className={`library-static-grid ${CHALLENGE_GRID}`}>
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
 * The Challenge Library page: app header, a compact introduction, the
 * discovery explorer and the site footer. A server component; it takes the
 * published catalog as props and reads no challenge data itself.
 */
export function ChallengeLibrary({ challenges }: ChallengeLibraryProps) {
  return (
    <>
      <SkipLinks links={[{ target: LIST_TARGET_ID, label: "Skip to challenges" }]} />
      <AppHeader current="challenges" />
      <main aria-labelledby={LIBRARY_HEADING_ID} className="library-canvas flex w-full flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
          <header className="grid animate-rise gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:items-center lg:gap-12">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">Challenge Library</p>
              <h1
                id={LIBRARY_HEADING_ID}
                className="mt-3 text-[2rem] font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl"
              >
                Every bug has a story.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-muted sm:text-[1.0625rem]">
                Real production incidents in realistic codebases. Read the code, follow the logs and network traffic,
                and find the root cause.
              </p>
              <LibraryStats challenges={challenges} />
            </div>
            <HowItWorks />
          </header>
          <SkipTarget id={LIST_TARGET_ID} label="Challenges" />
          <Suspense fallback={<StaticChallengeList challenges={challenges} />}>
            <ChallengeExplorer challenges={challenges} />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * The three steps as one connected sequence: a vertical line joining the
 * numbers on phones and beside the hero on wide screens, a horizontal one on
 * tablets where the steps sit side by side.
 */
function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      className="rounded-2xl border border-card-border bg-card/70 p-4 shadow-card sm:p-5"
    >
      <h2 id="how-it-works-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        How it works
      </h2>
      <ol className="mt-3.5 grid gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-1 lg:gap-3.5">
        {STEPS.map((step, index) => (
          <li key={step.title} className="relative flex gap-3 sm:flex-col sm:gap-2 lg:flex-row lg:gap-3">
            {index < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-3 top-7 -bottom-3 w-px bg-gradient-to-b from-accent/40 to-card-border sm:left-8 sm:right-[-1rem] sm:top-3 sm:bottom-auto sm:h-px sm:w-auto sm:bg-gradient-to-r lg:left-3 lg:right-auto lg:top-7 lg:-bottom-3.5 lg:h-auto lg:w-px lg:bg-gradient-to-b"
              />
            )}
            <span
              aria-hidden="true"
              className="relative grid size-6 shrink-0 place-items-center rounded-full border border-accent/35 bg-panel font-mono text-xs text-accent"
            >
              {index + 1}
            </span>
            <p className="text-sm leading-snug">
              <span className="font-medium text-foreground">{step.title}.</span>{" "}
              <span className="text-muted">{step.detail}</span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What the library holds, from the published catalog, as one quiet line under the introduction. */
function LibraryStats({ challenges }: ChallengeLibraryProps) {
  if (challenges.length === 0) return null;
  const difficulties = difficultyCounts(challenges).filter(({ count }) => count > 0);
  const number = "font-semibold tabular-nums text-foreground";
  return (
    <dl className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
      <div className="flex items-center gap-1.5">
        <dt className="sr-only">Investigations</dt>
        <dd>
          <span className={number}>{challenges.length}</span> investigations
        </dd>
      </div>
      <div className="flex items-center gap-1.5">
        <dt className="sr-only">Categories</dt>
        <dd>
          <span className={number}>{categoryCounts(challenges).length}</span> categories
        </dd>
      </div>
      <div className="flex items-center gap-1.5">
        <dt className="sr-only">Difficulty</dt>
        <dd className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {difficulties.map(({ id, count }) => (
            <span key={id} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-1.5 rounded-full bg-current ${DOT[difficultyDisplay[id].tone]}`} />
              <span className={number}>{count}</span> {difficultyDisplay[id].label.toLowerCase()}
            </span>
          ))}
        </dd>
      </div>
    </dl>
  );
}
