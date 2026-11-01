"use client";

import { useState } from "react";
import { replayChapters, replayCta } from "@/data/landing";
import { CtaLink } from "../CtaLink";
import { PauseIcon, PlayIcon, ReplayIcon } from "../icons";
import { styles } from "../styles";
import { ChapterRail, chapterTabId } from "./ChapterRail";
import { ReplayWindow } from "./ReplayWindow";
import { useReplay } from "./useReplay";

const PANEL_ID = "replay-panel";
const durations = replayChapters.map((chapter) => chapter.durationMs);

const toggleLabels = {
  playing: { label: "Pause", Icon: PauseIcon },
  paused: { label: "Play", Icon: PlayIcon },
  idle: { label: "Play", Icon: PlayIcon },
  done: { label: "Replay", Icon: ReplayIcon },
};

/*
 * The landing page's centrepiece. Server-rendered as chapter 1 in its final
 * frame, so it reads correctly without JavaScript. The stage is decorative
 * (aria-hidden); each chapter's caption carries the meaning. Screen readers
 * hear only changes the visitor asked for, never the automatic steps.
 */
export function IncidentReplay() {
  const { state, mode, dispatch, ref } = useReplay(durations);
  const [announcement, setAnnouncement] = useState("");
  const chapter = replayChapters[state.chapter];
  const toggle = toggleLabels[state.status];

  function select(index: number) {
    dispatch({ type: "SELECT", chapter: index });
    const next = replayChapters[index];
    setAnnouncement(`${next.title}. ${next.caption}`);
  }

  function toggleReplay() {
    dispatch({ type: "TOGGLE" });
    setAnnouncement(state.status === "playing" ? "Replay paused." : "Replay playing.");
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-end gap-3 sm:gap-6">
        <ChapterRail
          chapters={replayChapters}
          active={state.chapter}
          mode={mode}
          run={state.run}
          panelId={PANEL_ID}
          onSelect={select}
        />
        <button
          type="button"
          onClick={toggleReplay}
          className="mb-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-xs text-muted transition-colors hover:border-muted/50 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <toggle.Icon width={12} height={12} />
          {toggle.label}
          <span className="sr-only"> the investigation replay</span>
        </button>
      </div>

      <div
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={chapterTabId(chapter.id)}
        className="mt-5"
      >
        <div ref={ref} className={styles.tilt}>
          <ReplayWindow chapter={chapter.id} mode={mode} run={state.run} />
        </div>

        <div className="mt-6 flex min-h-24 flex-col items-center gap-4 text-center sm:min-h-20">
          <div>
            <h3 className="text-base font-medium text-foreground sm:text-lg">{chapter.title}</h3>
            <p className="mx-auto mt-1 max-w-xl text-pretty text-sm leading-relaxed text-muted">
              {chapter.caption}
            </p>
          </div>
          {chapter.id === "diagnose" && (
            <CtaLink href={replayCta.href} arrow>
              {replayCta.label}
            </CtaLink>
          )}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
