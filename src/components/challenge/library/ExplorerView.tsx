"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ArrowRightIcon, CloseIcon, SearchIcon, SlidersIcon } from "@/components/ui/icons";
import { categoryLabel } from "@/data/catalog/categories";
import { challengePath } from "@/lib/challenge-routes";
import {
  discover,
  EMPTY_QUERY,
  featuredChallenges,
  isFiltered,
  SORT_OPTIONS,
  type DiscoveryQuery,
  type SortKey,
} from "@/lib/catalog/discovery";
import type { PublicChallenge } from "@/types/catalog";
import { difficultyDisplay } from "../difficulty";
import { DiscoveryCard } from "./DiscoveryCard";
import { FilterPanel } from "./FilterPanel";

export const RESULTS_ID = "challenge-results";
const SEARCH_DEBOUNCE_MS = 250;

interface ExplorerViewProps {
  /** Every published challenge, public metadata only. */
  challenges: readonly PublicChallenge[];
  query: DiscoveryQuery;
  onQueryChange: (next: DiscoveryQuery) => void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One removable chip per active filter. */
function activeFilters(query: DiscoveryQuery): { key: string; label: string; remove: DiscoveryQuery }[] {
  const chips: { key: string; label: string; remove: DiscoveryQuery }[] = [];
  if (query.q.trim()) chips.push({ key: "q", label: `“${query.q.trim()}”`, remove: { ...query, q: "" } });
  if (query.category) chips.push({ key: "category", label: categoryLabel(query.category), remove: { ...query, category: null } });
  for (const difficulty of query.difficulties) {
    chips.push({
      key: `difficulty-${difficulty}`,
      label: difficultyDisplay[difficulty].label,
      remove: { ...query, difficulties: query.difficulties.filter((value) => value !== difficulty) },
    });
  }
  for (const technology of query.technologies) {
    chips.push({
      key: `tech-${technology}`,
      label: technology,
      remove: { ...query, technologies: query.technologies.filter((value) => value !== technology) },
    });
  }
  return chips;
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div>
        <h2 id={id} className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function CardGrid({ challenges, idPrefix }: { challenges: readonly PublicChallenge[]; idPrefix: string }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {challenges.map((challenge) => (
        <li key={challenge.id}>
          <DiscoveryCard challenge={challenge} idPrefix={idPrefix} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The Challenge Library's discovery experience: search, filters, sort and the
 * curated sections. Every list comes from the published catalog; sections with
 * nothing to show are left out rather than padded.
 */
export function ExplorerView({ challenges, query, onQueryChange }: ExplorerViewProps) {
  const [search, setSearch] = useState(query.q);
  const [syncedQ, setSyncedQ] = useState(query.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawer = useRef<HTMLDialogElement>(null);

  // Keep the box in step when the query changes elsewhere (Clear filters, a chip, a link).
  if (query.q !== syncedQ) {
    setSyncedQ(query.q);
    setSearch(query.q);
  }
  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  function changeSearch(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => onQueryChange({ ...query, q: value }), SEARCH_DEBOUNCE_MS);
  }

  if (challenges.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-6 py-12 text-center">
        <h2 className="text-base font-semibold text-foreground">No challenges are published yet</h2>
        <p className="mt-1 text-sm text-muted">New investigations appear here as soon as they are published.</p>
      </div>
    );
  }

  const filtered = isFiltered(query);
  const results = discover(challenges, query);
  const chips = activeFilters(query);
  const featured = featuredChallenges(challenges)[0];
  const clear = () => onQueryChange({ ...EMPTY_QUERY, sort: query.sort });

  const panel = (idPrefix: string) => (
    <FilterPanel challenges={challenges} query={query} onQueryChange={onQueryChange} idPrefix={idPrefix} />
  );

  return (
    <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
      <aside aria-label="Filters" className="hidden lg:block">
        <div className="sticky top-20">{panel("sidebar")}</div>
      </aside>

      <div className="flex min-w-0 flex-col gap-8">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="challenge-search" className="relative min-w-0 flex-1 basis-56">
              <span className="sr-only">Search challenges</span>
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
              <input
                id="challenge-search"
                type="search"
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    if (searchTimer.current) clearTimeout(searchTimer.current);
                    onQueryChange({ ...query, q: search });
                  }
                }}
                placeholder="Search by title, technology or topic"
                maxLength={100}
                className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted focus-within:outline focus-within:outline-2 focus-within:outline-accent">
              <span>Sort</span>
              <select
                value={query.sort}
                onChange={(event) => onQueryChange({ ...query, sort: event.target.value as SortKey })}
                className="bg-transparent text-foreground focus:outline-none"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id} className="bg-surface">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => drawer.current?.showModal()}
              aria-haspopup="dialog"
              className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:hidden"
            >
              <SlidersIcon />
              Filters
              {chips.length > 0 && <Badge tone="accent">{chips.length}</Badge>}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <p id={RESULTS_ID} aria-live="polite" className="font-mono text-xs text-subtle">
              {filtered ? `${results.length} of ${plural(challenges.length, "challenge")}` : `${plural(challenges.length, "challenge")} available`}
            </p>
            {chips.length > 0 && (
              <>
                <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
                  {chips.map((chip) => (
                    <li key={chip.key}>
                      <button
                        type="button"
                        onClick={() => onQueryChange(chip.remove)}
                        className="flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <span className="sr-only">Remove filter: </span>
                        {chip.label}
                        <CloseIcon width={10} height={10} />
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={clear}
                  className="text-xs font-medium text-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
        </div>

        {filtered ? (
          results.length > 0 ? (
            <Section id="results-heading" title="Results">
              <CardGrid challenges={results} idPrefix="results" />
            </Section>
          ) : (
            <div className="rounded-lg border border-border bg-surface px-6 py-10 text-center">
              <h2 className="text-base font-semibold text-foreground">No challenges match these filters</h2>
              <p className="mt-1 text-sm text-muted">Try a different search, or remove a filter.</p>
              <button
                type="button"
                onClick={clear}
                className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Clear filters
              </button>
            </div>
          )
        ) : (
          <>
            {featured && (
              <aside
                aria-labelledby="start-here-heading"
                className="flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h2 id="start-here-heading" className="text-xs font-semibold uppercase tracking-wider text-accent">
                    New to BugLab? Start here
                  </h2>
                  <p className="mt-1 text-sm text-foreground">
                    Challenge {featured.number} · {featured.title}
                    <span className="text-muted">
                      {" "}
                      · {difficultyDisplay[featured.difficulty].label} · ~{featured.estimatedMinutes} min
                    </span>
                  </p>
                </div>
                <Link
                  href={challengePath(featured.id)}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Open Challenge {featured.number}
                  <ArrowRightIcon />
                </Link>
              </aside>
            )}

            <Section id="all-heading" title="All investigations">
              <CardGrid challenges={results} idPrefix="all" />
            </Section>
          </>
        )}
      </div>

      <dialog
        ref={drawer}
        aria-labelledby="filters-drawer-heading"
        className="m-0 h-dvh max-h-none w-[min(22rem,100vw)] max-w-none bg-background p-0 text-foreground backdrop:bg-black/60 lg:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id="filters-drawer-heading" className="text-sm font-semibold">
              Filters
            </h2>
            <button
              type="button"
              aria-label="Close filters"
              onClick={() => drawer.current?.close()}
              className="rounded-md p-1.5 text-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">{panel("drawer")}</div>
          <div className="flex gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={clear}
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => drawer.current?.close()}
              className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-background hover:bg-accent/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Show {plural(results.length, "result")}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
