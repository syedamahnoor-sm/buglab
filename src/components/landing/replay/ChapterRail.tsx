import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { ReplayChapter } from "@/data/landing";
import { styles } from "../styles";
import type { StageMode } from "./replay-reducer";

export function chapterTabId(id: string) {
  return `replay-tab-${id}`;
}

interface ChapterRailProps {
  chapters: ReplayChapter[];
  active: number;
  mode: StageMode;
  run: number;
  panelId: string;
  onSelect: (index: number) => void;
}

// ARIA tabs with automatic activation. Each tab's bar fills as it plays: done
// chapters are full, the playing one fills over its duration.
export function ChapterRail({ chapters, active, mode, run, panelId, onSelect }: ChapterRailProps) {
  const listRef = useRef<HTMLDivElement>(null);

  function move(index: number) {
    const next = (index + chapters.length) % chapters.length;
    onSelect(next);
    listRef.current?.querySelector<HTMLElement>(`#${chapterTabId(chapters[next].id)}`)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: chapters.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    move(keys[event.key]);
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Investigation chapters"
      className="grid flex-1 grid-cols-5 gap-1.5 sm:gap-2"
    >
      {chapters.map((chapter, index) => {
        const selected = index === active;
        return (
          <button
            key={chapter.id}
            type="button"
            role="tab"
            id={chapterTabId(chapter.id)}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`group flex min-w-0 flex-col gap-2 rounded-md px-1 pb-1 pt-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/70 sm:px-2 ${
              selected ? "text-foreground" : "text-subtle hover:text-muted"
            }`}
          >
            <span className="flex items-baseline gap-1.5 truncate text-xs sm:text-sm">
              <span className="hidden font-mono text-[11px] text-subtle sm:inline">0{index + 1}</span>
              {chapter.label}
            </span>
            <span className="relative h-0.5 overflow-hidden rounded-full bg-border">
              {(index < active || (selected && mode === "static")) && (
                <span className={`absolute inset-0 ${selected ? "bg-accent" : "bg-accent/40"}`} />
              )}
              {selected && mode !== "static" && (
                <span
                  key={run}
                  className={`absolute inset-0 bg-accent ${styles.fill}`}
                  style={
                    {
                      "--chapter-duration": `${chapter.durationMs}ms`,
                      animationPlayState: mode === "frozen" ? "paused" : "running",
                    } as CSSProperties
                  }
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
