"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, CloseIcon, SearchIcon, SlidersIcon } from "@/components/ui/icons";
import { categoryLabel } from "@/data/catalog/categories";
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
import { FeaturedChallenge } from "./FeaturedChallenge";
import { CHALLENGE_GRID } from "./layout";
import { CategoryBar, DifficultyFilter, TechnologyFilter } from "./LibraryFilters";
import { nextLimit, PAGE_SIZE, progress } from "./progressive";

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
/** Newly shown cards rise in one after another, briefly; the stagger stops growing after a few. */
const STAGGER_MS = 30;
const STAGGER_MAX = 8;

/**
 * A grid item that rises in when it first appears after the learner changed
 * the filters. Whether it animates is fixed when it mounts, so cards already
 * on screen never replay the animation, and the first render (which replaces
 * the static list) does not animate at all.
 */
function ResultItem({ animate, index, children }: { animate: boolean; index: number; children: React.ReactNode }) {
  const [rise] = useState(animate);
  if (!rise) return <li>{children}</li>;
  return (
    <li className="animate-rise" style={{ animationDelay: `${Math.min(index, STAGGER_MAX) * STAGGER_MS}ms` }}>
      {children}
    </li>
  );
}
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
 * The Challenge Library's discovery experience: one panel of controls (search,
 * difficulty, sort, technologies, then the category row and the result count),
 * the recommended first case, and a grid of the matching challenges shown a
 * page at a time with Load more. Counts come from the whole published catalog.
 */
export function ExplorerView({ challenges, query, onQueryChange }: ExplorerViewProps) {
  const [search, setSearch] = useState(query.q);
  const [syncedQ, setSyncedQ] = useState(query.q);
  /** How many times the learner has changed the query here; new results animate only after the first. */
  const [changes, setChanges] = useState(0);
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  /** After Load more, the index of the first newly shown card, to move focus to it. */
  const focusFrom = useRef<number | null>(null);

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

  // How many results are on screen. Any change to the query (search, category,
  // difficulty, technology, sort, or back/forward) starts again from one page.
  const querySignature = JSON.stringify(current);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [limitFor, setLimitFor] = useState(querySignature);
  if (querySignature !== limitFor) {
    setLimitFor(querySignature);
    setLimit(PAGE_SIZE);
  }

  // Load more keeps the cards already shown and moves focus to the first new
  // one, without scrolling, so keyboard users continue where the new cards begin.
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null) return;
    focusFrom.current = null;
    grid.current?.children[from]?.querySelector("a")?.focus({ preventScroll: true });
  }, [limit]);

  function change(next: DiscoveryQuery) {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    setChanges((count) => count + 1);
    onQueryChange(next);
  }

  function changeSearch(value: string) {
    setSearch(value);
    setChanges((count) => count + 1);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => onQueryChange({ ...query, q: value }, { replace: true }), URL_DEBOUNCE_MS);
  }

  if (challenges.length === 0) {
    return (
      <div className="rounded-2xl border border-card-border bg-card px-6 py-12 text-center shadow-card">
        <h2 className="text-base font-semibold text-foreground">No challenges are published yet</h2>
        <p className="mt-1 text-sm text-muted">New investigations appear here as soon as they are published.</p>
      </div>
    );
  }

  const filtered = isFiltered(current);
  // Search, filters and sorting run on the whole catalog; only then is the result cut to the limit.
  const results = discover(challenges, current);
  const shown = progress(limit, results.length);
  const visible = results.slice(0, shown.shown);
  const loadMore = () => {
    focusFrom.current = shown.shown;
    setChanges((count) => count + 1);
    setLimit((value) => nextLimit(value, results.length));
  };
  const chips = activeFilters(current);
  const technologyCount = current.technologies.length;
  // The first beginner challenge in catalog order: the place to start is one that is labelled for beginners.
  const starter = beginnerChallenges(challenges)[0];
  const clear = () => {
    setSearch("");
    change({ ...EMPTY_QUERY, sort: query.sort });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-panel-border bg-panel p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="challenge-search" className="relative min-w-0 flex-1 basis-full sm:basis-64">
            <span className="sr-only">Search challenges</span>
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="challenge-search"
              type="search"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") change({ ...query, q: search });
              }}
              placeholder="Search title, tech or topic"
              maxLength={100}
              className="h-11 w-full rounded-xl border border-card-border bg-background pl-10 pr-3 text-sm text-foreground transition-[border-color,box-shadow] duration-150 placeholder:text-subtle hover:border-card-border-hover focus:border-accent/60 focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_14%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent motion-reduce:transition-none"
            />
          </label>
          <div className="order-last basis-full pt-1 xl:order-none xl:basis-auto xl:pt-0">
            <DifficultyFilter challenges={challenges} query={current} onQueryChange={change} />
          </div>
          <label className="flex h-11 items-center gap-2 rounded-xl border border-card-border bg-background px-3.5 text-sm text-muted transition-colors duration-150 hover:border-card-border-hover focus-within:outline focus-within:outline-2 focus-within:outline-accent max-sm:flex-1">
            <span>Sort</span>
            <select
              value={query.sort}
              onChange={(event) => change({ ...current, sort: event.target.value as SortKey })}
              className="h-full min-w-0 bg-transparent text-foreground focus:outline-none"
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
            className={`flex h-11 items-center justify-center gap-2 rounded-xl border px-3.5 text-sm transition-colors duration-150 max-sm:flex-1 ${focusRing} ${
              technologyCount > 0
                ? "border-accent/60 bg-accent/15 text-foreground"
                : "border-card-border bg-background text-foreground hover:border-card-border-hover hover:bg-card"
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

        <div className="flex flex-col gap-2 border-t border-panel-border pt-3 lg:flex-row lg:items-center lg:gap-6">
          <div className="min-w-0 flex-1">
            <CategoryBar challenges={challenges} query={current} onQueryChange={change} />
          </div>
          <p id={RESULTS_ID} aria-live="polite" className="shrink-0 text-sm text-muted">
            {filtered ? (
              <>
                <span key={results.length} className="inline-block animate-rise font-semibold tabular-nums text-foreground">
                  {results.length}
                </span>{" "}
                of {plural(challenges.length, "challenge")}
              </>
            ) : (
              <>
                <span className="font-semibold tabular-nums text-foreground">{challenges.length}</span> challenges
              </>
            )}
          </p>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={() => {
                    if (chip.key === "q") setSearch("");
                    change(chip.remove);
                  }}
                  className={`flex h-8 animate-rise items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 text-xs text-foreground transition-colors duration-150 hover:border-accent/60 hover:bg-accent/15 ${focusRing}`}
                >
                  <span className="sr-only">Remove filter: </span>
                  {chip.label}
                  <CloseIcon width={10} height={10} className="text-muted" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={clear}
            className={`h-8 rounded-lg px-2.5 text-xs font-medium text-accent underline-offset-4 transition-colors duration-150 hover:bg-accent/10 hover:underline ${focusRing}`}
          >
            Clear all
          </button>
        </div>
      )}

      {!filtered && starter && <FeaturedChallenge challenge={starter} />}

      {results.length > 0 ? (
        <section aria-labelledby="all-heading" className="flex flex-col gap-3">
          <h2 id="all-heading" className="sr-only">
            {filtered ? "Matching investigations" : "All investigations"}
          </h2>
          <ul ref={grid} className={CHALLENGE_GRID}>
            {visible.map((challenge, index) => (
              <ResultItem key={challenge.id} index={index % PAGE_SIZE} animate={changes > 0}>
                <DiscoveryCard challenge={challenge} idPrefix="all" />
              </ResultItem>
            ))}
          </ul>
          {shown.total > PAGE_SIZE && (
            <div className="mt-6 flex flex-col items-center gap-3 text-center">
              <p aria-live="polite" className="text-sm text-muted">
                {shown.next > 0 ? (
                  <>
                    Showing <span className="font-semibold tabular-nums text-foreground">{shown.shown}</span> of{" "}
                    {plural(shown.total, filtered ? "matching challenge" : "challenge")}
                  </>
                ) : (
                  <>Showing all {plural(shown.total, filtered ? "matching challenge" : "challenge")}</>
                )}
              </p>
              <div aria-hidden="true" className="h-1 w-44 overflow-hidden rounded-full bg-card-border">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out motion-reduce:transition-none"
                  style={{ width: `${(shown.shown / shown.total) * 100}%` }}
                />
              </div>
              {shown.next > 0 && (
                <button
                  type="button"
                  onClick={loadMore}
                  className={`group mt-1 inline-flex h-11 items-center gap-2 rounded-xl border border-card-border-hover bg-card px-5 text-sm font-medium text-foreground shadow-card transition-[background-color,border-color,box-shadow] duration-200 hover:border-accent/50 hover:bg-card-hover hover:shadow-card-hover ${focusRing}`}
                >
                  Load {shown.next} more
                  <ChevronDownIcon className="text-accent transition-transform duration-200 group-hover:translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0" />
                </button>
              )}
            </div>
          )}
        </section>
      ) : (
        <div className="animate-rise rounded-2xl border border-dashed border-card-border-hover bg-panel px-6 py-14 text-center">
          <span
            aria-hidden="true"
            className="mx-auto grid size-11 place-items-center rounded-xl border border-card-border bg-card text-muted shadow-card"
          >
            <SearchIcon />
          </span>
          <h2 className="mt-4 text-base font-semibold text-foreground">No challenges match these filters</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">
            {search.trim() ? (
              <>
                Nothing matches <span className="text-foreground">“{search.trim()}”</span> with the current filters. Try a
                broader word, such as a technology or a symptom.
              </>
            ) : (
              <>Try another category or difficulty, or remove a filter.</>
            )}{" "}
            Every challenge is listed when no filters are set.
          </p>
          <button
            type="button"
            onClick={clear}
            className={`mt-5 h-10 rounded-xl border border-card-border-hover bg-card px-4 text-sm font-medium text-foreground shadow-card transition-colors duration-150 hover:border-accent/50 hover:bg-card-hover ${focusRing}`}
          >
            Clear all filters
          </button>
        </div>
      )}

      <dialog
        ref={drawer}
        aria-labelledby="filters-drawer-heading"
        className="m-0 ml-auto h-dvh max-h-none w-[min(22rem,100vw)] max-w-none border-l border-card-border bg-panel p-0 text-foreground backdrop:bg-black/60 backdrop:backdrop-blur-[2px]"
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
