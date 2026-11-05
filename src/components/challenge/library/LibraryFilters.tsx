"use client";

import { useEffect, useRef, useState } from "react";
import { categoryCounts, difficultyCounts, technologyOptions, type DiscoveryQuery } from "@/lib/catalog/discovery";
import type { CategoryId, PublicChallenge } from "@/types/catalog";
import type { Difficulty } from "@/types/workspace";
import { difficultyDisplay } from "../difficulty";
import { categoryAccent, CATEGORY_SHORT_LABEL } from "./category-style";
import { CategoryIcon } from "./CategoryIcon";

interface FilterProps {
  /** Every published challenge: counts always come from the whole catalog. */
  challenges: readonly PublicChallenge[];
  query: DiscoveryQuery;
  onQueryChange: (next: DiscoveryQuery) => void;
}

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Shared look for the toggle filters: recessed when off, accent-tinted when on. */
const toggleBase =
  "group relative flex items-center gap-1.5 whitespace-nowrap border text-sm transition-[background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:scale-100";
const toggleOn = "border-accent/60 bg-accent/15 font-medium text-foreground";
const toggleOff = "border-card-border bg-field/60 text-muted hover:border-card-border-hover hover:bg-hover-fill hover:text-foreground";

export function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

const countLabel = (count: number) => (
  <span className="font-mono text-xs tabular-nums text-subtle group-aria-pressed:text-accent">
    <span className="sr-only">(</span>
    {count}
    <span className="sr-only">{count === 1 ? " challenge)" : " challenges)"}</span>
  </span>
);

/**
 * Which ends of a sideways-scrolling row have more content past them, so the
 * row can fade only where something is hidden. Measured on scroll and resize.
 */
function useOverflowEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, []);
  return [ref, edges] as const;
}

const FADE = "32px";
const fadeMask = ({ start, end }: { start: boolean; end: boolean }) => {
  if (!start && !end) return undefined;
  const mask = `linear-gradient(to right, ${start ? `transparent, #000 ${FADE}` : "#000"}, ${end ? `#000 calc(100% - ${FADE}), transparent` : "#000"})`;
  return { maskImage: mask, WebkitMaskImage: mask };
};

/**
 * The categories as one row of toggle buttons. Each shows a short label (the
 * full category name is its accessible name and tooltip), so on a laptop the
 * whole row fits. Where it does not, the row scrolls sideways inside itself,
 * never the page, and fades only at an end with more categories past it. The
 * selected category is scrolled into view.
 */
export function CategoryBar({ challenges, query, onQueryChange }: FilterProps) {
  const [row, edges] = useOverflowEdges<HTMLUListElement>();
  useEffect(() => {
    const list = row.current;
    const selected = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!list || !selected) return;
    const left = selected.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + selected.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: Math.max(0, left - 24) });
    }
  }, [row, query.category]);

  const button = (id: CategoryId | null, label: string, short: string, count: number) => {
    const active = query.category === id;
    return (
      <li key={id ?? "all"} className="shrink-0" style={id ? categoryAccent(id) : undefined}>
        <button
          type="button"
          aria-pressed={active}
          title={short === label ? undefined : label}
          onClick={() => onQueryChange({ ...query, category: id })}
          className={`${toggleBase} h-9 rounded-full px-3.5 ${focusRing} ${active ? toggleOn : toggleOff}`}
        >
          <CategoryIcon category={id ?? "all"} className={active ? "text-accent" : id ? "text-[var(--cat)]" : "text-subtle"} />
          {short === label ? (
            label
          ) : (
            <>
              <span aria-hidden="true">{short}</span>
              <span className="sr-only">{label}</span>
            </>
          )}
          {countLabel(count)}
        </button>
      </li>
    );
  };

  return (
    <nav aria-label="Categories" className="-mx-3 min-w-0 sm:-mx-1">
      <ul ref={row} style={fadeMask(edges)} className="-my-1 flex w-full gap-1.5 overflow-x-auto px-3 py-1 [scrollbar-width:none] sm:px-1">
        {button(null, "All", "All", challenges.length)}
        {categoryCounts(challenges).map((category) =>
          button(category.id, category.label, CATEGORY_SHORT_LABEL[category.id], category.count),
        )}
      </ul>
    </nav>
  );
}

/** Difficulty as toggle buttons: any combination, none selected means all. */
export function DifficultyFilter({ challenges, query, onQueryChange }: FilterProps) {
  return (
    <div role="group" aria-labelledby="difficulty-label" className="flex flex-wrap items-center gap-1.5 xl:flex-nowrap">
      <span id="difficulty-label" className="mr-1 text-xs font-medium uppercase tracking-wider text-subtle">
        Difficulty
      </span>
      {difficultyCounts(challenges).map(({ id, count }) => {
        const active = query.difficulties.includes(id);
        const display = difficultyDisplay[id];
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            disabled={count === 0 && !active}
            onClick={() => onQueryChange({ ...query, difficulties: toggle<Difficulty>(query.difficulties, id) })}
            className={`${toggleBase} h-9 rounded-lg px-3 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${active ? toggleOn : toggleOff}`}
          >
            <span aria-hidden="true" className={`size-1.5 rounded-full bg-current ${difficultyDot[display.tone]}`} />
            {display.label}
            {countLabel(count)}
          </button>
        );
      })}
    </div>
  );
}

const difficultyDot: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-subtle",
  accent: "text-accent",
  info: "text-info",
};

/** Every technology as a checkbox, alphabetical, with how many challenges use it. */
export function TechnologyFilter({ challenges, query, onQueryChange, idPrefix }: FilterProps & { idPrefix: string }) {
  const technologies = technologyOptions(challenges);
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wider text-muted">Technologies</legend>
      <div className="mt-2 grid gap-0.5">
        {technologies.map(({ label, count }) => {
          const id = `${idPrefix}-tech-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          return (
            <label
              key={label}
              htmlFor={id}
              className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted transition-colors duration-150 hover:bg-card hover:text-foreground has-[:checked]:text-foreground has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
            >
              <input
                id={id}
                type="checkbox"
                checked={query.technologies.includes(label)}
                onChange={() => onQueryChange({ ...query, technologies: toggle(query.technologies, label).sort() })}
                className="size-4 accent-[var(--accent)]"
              />
              <span className="flex-1">{label}</span>
              <span className="font-mono text-xs tabular-nums text-subtle">{count}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
