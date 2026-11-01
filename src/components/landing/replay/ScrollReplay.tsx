"use client";

import type { CSSProperties } from "react";
import { replayChapters, replayCta } from "@/data/landing";
import { CtaLink } from "../CtaLink";
import { styles } from "../styles";
import { ReplayWindow } from "./ReplayWindow";
import { useActiveChapter, useReducedMotion } from "./useActiveChapter";

export function chapterBlockId(id: string) {
  return `replay-chapter-${id}`;
}

const count = replayChapters.length;
const pad = (n: number) => String(n).padStart(2, "0");

/*
 * The desktop replay: chapter blocks in normal document flow on the left, the
 * workspace window pinned on the right. The window plays whichever chapter is
 * at the middle of the screen; the index above it jumps to any chapter with
 * plain in-page links.
 *
 * Server-rendered with every chapter in full and the window unpinned, showing
 * the first chapter's final frame. Pinning and dimming switch on only once
 * the scroll tracking is running, and neither moves anything in the layout.
 * The window is decorative (aria-hidden); the blocks carry the meaning.
 */
export function ScrollReplay() {
  const { chapter: active, run, played, live, register, select } = useActiveChapter();
  const reducedMotion = useReducedMotion();
  const chapter = replayChapters[active];

  const mode = played && !reducedMotion ? "running" : "static";

  return (
    <div
      data-live={live ? "" : undefined}
      className={`${styles.replayScroll} mx-auto max-w-6xl gap-10 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-14`}
    >
      {/* Pinned column: index and window. First in the DOM so the index is
          reached before the chapters; drawn on the right. */}
      <div className={`${styles.replayPin} min-w-0 lg:col-start-2 lg:row-start-1 lg:self-start`}>
        <nav aria-label="Investigation chapters">
          <ol className="grid grid-cols-5 gap-2">
            {replayChapters.map((item, index) => {
              const current = live && index === active;
              return (
                <li key={item.id} className="min-w-0">
                  <a
                    href={`#${chapterBlockId(item.id)}`}
                    aria-current={current ? "step" : undefined}
                    // The link scrolls; a click on the chapter already shown replays it.
                    onClick={() => select(index, index === active)}
                    className={`flex flex-col gap-2 rounded-md px-2 pb-1 pt-1.5 text-sm outline-none motion-safe:transition-colors focus-visible:ring-2 focus-visible:ring-accent/70 ${
                      current ? "text-foreground" : "text-subtle hover:text-muted"
                    }`}
                  >
                    <span className="flex items-baseline gap-1.5 truncate">
                      <span className="font-mono text-[11px] text-subtle">{pad(index + 1)}</span>
                      {item.label}
                    </span>
                    <span aria-hidden="true" className="relative h-0.5 overflow-hidden rounded-full bg-border">
                      {live && (index < active || (current && mode === "static")) && (
                        <span className={`absolute inset-0 ${current ? "bg-accent" : "bg-accent/40"}`} />
                      )}
                      {current && mode === "running" && (
                        <span
                          key={run}
                          className={`absolute inset-0 bg-accent ${styles.fill}`}
                          style={{ "--chapter-duration": `${item.durationMs}ms` } as CSSProperties}
                        />
                      )}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="mt-3">
          <ReplayWindow chapter={chapter.id} mode={mode} run={run} layout="panel" />
        </div>
      </div>

      {/* The chapters, with the trace running beside them. */}
      <ol
        className={`${styles.chapters} relative min-w-0 lg:col-start-1 lg:row-start-1`}
        style={{ "--chapter-reached": live ? (active + 1) / count : 0 } as CSSProperties}
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-[3px] w-px bg-border-strong" />
        <span aria-hidden="true" className={`absolute inset-y-0 left-[3px] w-px ${styles.chaptersFill}`} />
        {replayChapters.map((item, index) => {
          const emphasised = !live || index === active;
          return (
            <li
              key={item.id}
              id={chapterBlockId(item.id)}
              ref={register(index)}
              data-chapter={index}
              tabIndex={-1}
              className={`${styles.chapter} relative pl-10 outline-none`}
            >
              <span
                aria-hidden="true"
                className={`absolute left-0 top-1/2 size-[7px] -translate-y-1/2 rounded-full motion-safe:transition-colors ${
                  live && index === active
                    ? `bg-accent ${styles.traceNode}`
                    : live && index < active
                      ? "bg-accent/60"
                      : "bg-border-strong"
                }`}
              />
              <p className="font-mono text-xs uppercase tracking-[0.2em]">
                <span className={emphasised ? "text-accent" : "text-subtle"}>{pad(index + 1)}</span>
                <span className="text-subtle"> / {pad(count)}</span>
                <span className="text-subtle"> · {item.label}</span>
              </p>
              <h3
                className={`mt-3 text-2xl font-semibold tracking-[-0.025em] motion-safe:transition-colors lg:text-3xl ${
                  emphasised ? "text-foreground" : "text-muted"
                }`}
              >
                {item.title}
              </h3>
              <p
                className={`mt-3 max-w-md text-pretty leading-relaxed motion-safe:transition-colors lg:text-lg ${
                  emphasised ? "text-foreground/80" : "text-subtle"
                }`}
              >
                {item.caption}
              </p>
              {item.id === "diagnose" && (
                <div className="mt-6">
                  <CtaLink href={replayCta.href} arrow>
                    {replayCta.label}
                  </CtaLink>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
