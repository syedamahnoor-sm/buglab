"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon, CloseIcon, SearchIcon, SlidersIcon } from "@/components/ui/icons";
import { categoryLabel } from "@/data/catalog/categories";
import { challengePath } from "@/lib/challenge-routes";
import {
  beginnerChallenges,
  discover,
  EMPTY_QUERY,
  isFiltered,
  SORT_OPTIONS,
  type DiscoveryQuery,
  type SortKey,
} from "@/lib/catalog/discovery";
import type { PublicChallenge } from "@/types/catalog";
import { difficultyDisplay } from "../difficulty";
import { DiscoveryCard } from "./DiscoveryCard";
import { CategoryBar, DifficultyFilter, TechnologyFilter } from "./LibraryFilters";

export const RESULTS_ID = "challenge-results";
/** Only the URL waits for typing to pause; results update on every keystroke. */
const URL_DEBOUNCE_MS = 300;

export interface QueryChangeOptions {
  /** Replace the history entry instead of adding one (used while typing a search). */
  replace?: boolean;
}

interface ExplorerViewProps {
  /** Every published challenge, public metadata only. */
  challenges: readonly PublicChallenge[];
  query: DiscoveryQuery;
  onQueryChange: (next: DiscoveryQuery, options?: QueryChangeOptions) => void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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

/**
 * The Challenge Library's discovery experience: one toolbar (search, sort,
 * technologies), the category bar, difficulty toggles, and a single grid of
 * every matching challenge. Counts come from the whole published catalog.
 */
export function ExplorerView({ challenges, query, onQueryChange }: ExplorerViewProps) {
  const [search, setSearch] = useState(query.q);
  const [syncedQ, setSyncedQ] = useState(query.q);
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawer = useRef<HTMLDialogElement>(null);

  // Keep the box in step when the query changes elsewhere (a chip, Clear all, back/forward).
  if (query.q !== syncedQ) {
    setSyncedQ(query.q);
    setSearch(query.q);
  }
  useEffect(() => () => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
  }, []);

  // What the learner sees follows the search box immediately; the URL catches up.
  const current: DiscoveryQuery = { ...query, q: search };

  function change(next: DiscoveryQuery) {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    onQueryChange(next);
  }

  function changeSearch(value: string) {
    setSearch(value);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => onQueryChange({ ...query, q: value }, { replace: true }), URL_DEBOUNCE_MS);
  }

  if (challenges.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-6 py-12 text-center">
        <h2 className="text-base font-semibold text-foreground">No challenges are published yet</h2>
        <p className="mt-1 text-sm text-muted">New investigations appear here as soon as they are published.</p>
      </div>
    );
  }

  const filtered = isFiltered(current);
  const results = discover(challenges, current);
  const chips = activeFilters(current);
  const technologyCount = current.technologies.length;
  // The first beginner challenge in catalog order: the place to start is one that is labelled for beginners.
  const starter = beginnerChallenges(challenges)[0];
  const clear = () => {
    setSearch("");
    change({ ...EMPTY_QUERY, sort: query.sort });
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="challenge-search" className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search challenges</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            id="challenge-search"
            type="search"
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") change({ ...query, q: search });
            }}
            placeholder="Search by title, technology or topic"
            maxLength={100}
            className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>
        <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-muted focus-within:outline focus-within:outline-2 focus-within:outline-accent">
          <span>Sort</span>
          <select
            value={query.sort}
            onChange={(event) => change({ ...current, sort: event.target.value as SortKey })}
            className="h-full bg-transparent text-foreground focus:outline-none"
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
          className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-sm ${focusRing} ${
            technologyCount > 0 ? "border-accent/50 bg-accent/10 text-foreground" : "border-border bg-surface text-foreground hover:border-border-strong"
          }`}
        >
          <SlidersIcon />
          Technologies
          {technologyCount > 0 && (
            <span className="rounded bg-accent/20 px-1.5 font-mono text-xs text-accent">
              {technologyCount}
              <span className="sr-only"> selected</span>
            </span>
          )}
        </button>
      </div>

      <CategoryBar challenges={challenges} query={current} onQueryChange={change} />

      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <DifficultyFilter challenges={challenges} query={current} onQueryChange={change} />
        <p id={RESULTS_ID} aria-live="polite" className="text-sm text-muted">
          {filtered ? (
            <>
              <span className="font-medium text-foreground">{results.length}</span> of {plural(challenges.length, "challenge")}
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{challenges.length}</span> challenges
            </>
          )}
        </p>
      </div>

      {chips.length > 0 && (
        <div className="-mt-1 flex flex-wrap items-center gap-2">
          <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={() => {
                    if (chip.key === "q") setSearch("");
                    change(chip.remove);
                  }}
                  className={`flex h-7 items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised px-2 text-xs text-foreground hover:border-accent/50 ${focusRing}`}
                >
                  <span className="sr-only">Remove filter: </span>
                  {chip.label}
                  <CloseIcon width={10} height={10} className="text-muted" />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={clear} className={`h-7 rounded-md px-2 text-xs font-medium text-accent hover:underline ${focusRing}`}>
            Clear all
          </button>
        </div>
      )}

      {!filtered && starter && (
        <aside
          aria-labelledby="start-here-heading"
          className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-accent/[0.04] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <h2 id="start-here-heading" className="text-xs font-semibold uppercase tracking-wider text-accent">
              New to BugLab? Start here
            </h2>
            <p className="mt-1 text-sm text-foreground">
              Challenge {starter.number} · {starter.title}
              <span className="text-muted">
                {" "}
                · {difficultyDisplay[starter.difficulty].label} · ~{starter.estimatedMinutes} min
              </span>
            </p>
          </div>
          <Link
            href={challengePath(starter.id)}
            className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-background transition-colors hover:bg-accent/85 ${focusRing}`}
          >
            Open Challenge {starter.number}
            <ArrowRightIcon />
          </Link>
        </aside>
      )}

      {results.length > 0 ? (
        <section aria-labelledby="all-heading" className="flex flex-col gap-3">
          <h2 id="all-heading" className="sr-only">
            {filtered ? "Matching investigations" : "All investigations"}
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((challenge) => (
              <li key={challenge.id}>
                <DiscoveryCard challenge={challenge} idPrefix="all" />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-foreground">No challenges match these filters</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Try a broader search, another category, or remove a filter. Every challenge is listed when no filters are set.
          </p>
          <button
            type="button"
            onClick={clear}
            className={`mt-4 h-9 rounded-lg border border-border-strong px-3.5 text-sm text-foreground hover:bg-surface-raised ${focusRing}`}
          >
            Clear all filters
          </button>
        </div>
      )}

      <dialog
        ref={drawer}
        aria-labelledby="filters-drawer-heading"
        className="m-0 ml-auto h-dvh max-h-none w-[min(22rem,100vw)] max-w-none border-l border-border bg-background p-0 text-foreground backdrop:bg-black/60"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id="filters-drawer-heading" className="text-sm font-semibold">
              Filter by technology
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => drawer.current?.close()}
              className={`flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-foreground ${focusRing}`}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <TechnologyFilter challenges={challenges} query={current} onQueryChange={change} idPrefix="drawer" />
          </div>
          <div className="flex gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => change({ ...current, technologies: [] })}
              disabled={technologyCount === 0}
              className={`h-10 flex-1 rounded-lg border border-border px-3 text-sm text-foreground hover:bg-surface-raised disabled:opacity-50 ${focusRing}`}
            >
              Clear technologies
            </button>
            <button
              type="button"
              onClick={() => drawer.current?.close()}
              className={`h-10 flex-1 rounded-lg bg-accent px-3 text-sm font-medium text-background hover:bg-accent/85 ${focusRing}`}
            >
              Show {plural(results.length, "result")}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
