import {
  categoryCounts,
  difficultyCounts,
  technologyOptions,
  type DiscoveryQuery,
} from "@/lib/catalog/discovery";
import type { CategoryId, PublicChallenge } from "@/types/catalog";
import type { Difficulty } from "@/types/workspace";
import { difficultyDisplay } from "../difficulty";
import { CategoryIcon } from "./CategoryIcon";

interface FilterPanelProps {
  /** Every published challenge: counts come from the whole catalog. */
  challenges: readonly PublicChallenge[];
  query: DiscoveryQuery;
  onQueryChange: (next: DiscoveryQuery) => void;
  /** Keeps ids unique when the panel is rendered twice (sidebar and drawer). */
  idPrefix: string;
}

const groupHeading = "text-[11px] font-semibold uppercase tracking-wider text-muted";

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/** Category, difficulty and technology filters. Shared by the sidebar and the mobile drawer. */
export function FilterPanel({ challenges, query, onQueryChange, idPrefix }: FilterPanelProps) {
  const categories = categoryCounts(challenges);
  const difficulties = difficultyCounts(challenges);
  const technologies = technologyOptions(challenges);

  const categoryButton = (id: CategoryId | null, label: string, count: number) => {
    const active = query.category === id;
    return (
      <li key={id ?? "all"}>
        <button
          type="button"
          aria-pressed={active}
          onClick={() => onQueryChange({ ...query, category: id })}
          className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
            active ? "bg-surface-raised font-medium text-foreground" : "text-muted hover:bg-surface-raised/60 hover:text-foreground"
          }`}
        >
          <CategoryIcon category={id ?? "all"} className={active ? "text-accent" : "text-subtle"} />
          <span className="flex-1">{label}</span>
          <span className="font-mono text-xs text-subtle">
            <span className="sr-only">(</span>
            {count}
            <span className="sr-only">{count === 1 ? " challenge)" : " challenges)"}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-labelledby={`${idPrefix}-categories`}>
        <h2 id={`${idPrefix}-categories`} className={groupHeading}>
          Categories
        </h2>
        <ul className="mt-2 flex flex-col gap-0.5">
          {categoryButton(null, "All challenges", challenges.length)}
          {categories.map((category) => categoryButton(category.id, category.label, category.count))}
        </ul>
      </nav>

      <fieldset>
        <legend className={groupHeading}>Difficulty</legend>
        <div className="mt-2 flex flex-col gap-1">
          {difficulties.map(({ id, count }) => (
            <CheckboxRow
              key={id}
              id={`${idPrefix}-difficulty-${id}`}
              label={difficultyDisplay[id].label}
              count={count}
              checked={query.difficulties.includes(id)}
              disabled={count === 0 && !query.difficulties.includes(id)}
              onChange={() => onQueryChange({ ...query, difficulties: toggle<Difficulty>(query.difficulties, id) })}
            />
          ))}
        </div>
      </fieldset>

      {technologies.length > 0 && (
        <fieldset>
          <legend className={groupHeading}>Technologies</legend>
          <div className="mt-2 flex flex-col gap-1">
            {technologies.map(({ label, count }) => (
              <CheckboxRow
                key={label}
                id={`${idPrefix}-tech-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                label={label}
                count={count}
                checked={query.technologies.includes(label)}
                onChange={() => onQueryChange({ ...query, technologies: toggle(query.technologies, label).sort() })}
              />
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

function CheckboxRow(props: {
  id: string;
  label: string;
  count: number;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      htmlFor={props.id}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm ${
        props.disabled ? "cursor-not-allowed text-subtle/70" : "cursor-pointer text-muted hover:bg-surface-raised/60 hover:text-foreground"
      }`}
    >
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
        className="size-3.5 accent-[var(--accent)]"
      />
      <span className="flex-1">{props.label}</span>
      <span className="font-mono text-xs text-subtle">{props.count}</span>
    </label>
  );
}
