import { categoryCounts, difficultyCounts, technologyOptions, type DiscoveryQuery } from "@/lib/catalog/discovery";
import type { CategoryId, PublicChallenge } from "@/types/catalog";
import type { Difficulty } from "@/types/workspace";
import { difficultyDisplay } from "../difficulty";
import { CategoryIcon } from "./CategoryIcon";

interface FilterProps {
  /** Every published challenge: counts always come from the whole catalog. */
  challenges: readonly PublicChallenge[];
  query: DiscoveryQuery;
  onQueryChange: (next: DiscoveryQuery) => void;
}

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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
 * The six categories as one row of toggle buttons, always visible. On narrow
 * screens the row scrolls sideways inside itself, never the page.
 */
export function CategoryBar({ challenges, query, onQueryChange }: FilterProps) {
  const button = (id: CategoryId | null, label: string, count: number) => {
    const active = query.category === id;
    return (
      <li key={id ?? "all"} className="shrink-0">
        <button
          type="button"
          aria-pressed={active}
          onClick={() => onQueryChange({ ...query, category: id })}
          className={`group relative flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none ${focusRing} ${
            active
              ? "border-accent/50 bg-accent/10 font-medium text-foreground"
              : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground"
          }`}
        >
          <CategoryIcon category={id ?? "all"} className={active ? "text-accent" : "text-subtle"} />
          {label}
          {countLabel(count)}
        </button>
      </li>
    );
  };

  return (
    <nav aria-label="Categories" className="-mx-4 min-w-0 sm:mx-0">
      <ul className="flex w-full max-w-[100vw] gap-1.5 overflow-x-auto px-4 pb-1 sm:max-w-none sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {button(null, "All", challenges.length)}
        {categoryCounts(challenges).map((category) => button(category.id, category.label, category.count))}
      </ul>
    </nav>
  );
}

/** Difficulty as toggle buttons: any combination, none selected means all. */
export function DifficultyFilter({ challenges, query, onQueryChange }: FilterProps) {
  return (
    <div role="group" aria-labelledby="difficulty-label" className="flex flex-wrap items-center gap-1.5">
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
            className={`group relative flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${
              active ? "border-accent/50 bg-accent/10 text-foreground" : "border-border bg-surface text-muted hover:text-foreground"
            }`}
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
              className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-muted hover:bg-surface-raised hover:text-foreground has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
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
