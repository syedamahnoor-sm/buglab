import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabDefinition<Id extends string> {
  id: Id;
  label: string;
  badge?: ReactNode;
}

interface TabListProps<Id extends string> {
  tabs: TabDefinition<Id>[];
  activeId: Id;
  onChange: (id: Id) => void;
  idPrefix: string;
  label: string;
  className?: string;
}

export function getTabIds(idPrefix: string, id: string) {
  return { tab: `${idPrefix}-tab-${id}`, panel: `${idPrefix}-panel-${id}` };
}

/** ARIA tabs with automatic activation (←/→, Home, End). */
export function TabList<Id extends string>({
  tabs,
  activeId,
  onChange,
  idPrefix,
  label,
  className = "",
}: TabListProps<Id>) {
  const listRef = useRef<HTMLDivElement>(null);

  function select(index: number) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    onChange(tab.id);
    listRef.current
      ?.querySelector<HTMLElement>(`#${getTabIds(idPrefix, tab.id).tab}`)
      ?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    select(keys[event.key]);
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={`flex shrink-0 items-stretch gap-1 overflow-x-auto px-2 text-xs ${className}`}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeId;
        const ids = getTabIds(idPrefix, tab.id);
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={ids.tab}
            aria-selected={isActive}
            aria-controls={ids.panel}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/70 ${
              isActive
                ? "border-accent font-medium text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}
