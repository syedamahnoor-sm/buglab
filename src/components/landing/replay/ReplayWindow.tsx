import { replay, type ReplayChapter } from "@/data/landing";
import type { StageMode } from "./replay-reducer";
import { ReplayStage } from "./ReplayStage";

interface ReplayWindowProps {
  chapter: ReplayChapter["id"];
  mode: StageMode;
  /** Restarts the stage's animations whenever it changes. */
  run: number;
  layout?: "responsive" | "panel";
}

// The workspace window both replays play in: title bar plus stage.
export function ReplayWindow({ chapter, mode, run, layout }: ReplayWindowProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[0_30px_80px_-30px_color-mix(in_oklab,var(--color-ink)_80%,transparent),0_0_0_1px_rgb(255_255_255/0.02)_inset]">
      <div className="flex h-9 items-center gap-1.5 border-b border-border bg-surface-raised px-3">
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="ml-3 truncate font-mono text-[11px] text-subtle">{replay.windowTitle}</span>
      </div>
      <ReplayStage key={run} chapter={chapter} mode={mode} layout={layout} />
    </div>
  );
}
