import type { CSSProperties, ReactNode } from "react";
import { SECTION_IDS, replay } from "@/data/landing";
import { EditorialHeading } from "../EditorialHeading";
import { Reveal } from "../Reveal";
import { Spotlight } from "../Spotlight";
import { styles } from "../styles";
import { LogSearchTile } from "./LogSearchTile";
import { NetworkTile } from "./NetworkTile";
import { KeyboardTile, NotesTile, ServerCheckTile } from "./StaticTiles";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

interface UnfoldProps {
  children: ReactNode;
  className?: string;
  /** Where the piece starts on lg, as a CSS transform: folded into the workspace. */
  from: string;
  delay: number;
  /** Callouts start hidden behind their instrument and hang from it on a stem. */
  callout?: boolean;
}

/*
 * One piece of the bench. While the bench is still below the fold it waits
 * folded together (lg) or lowered (below lg); when it scrolls into view the
 * pieces move to their places and stay there, flat, with no transform left.
 * Without JavaScript, or with reduced motion, they never leave their places.
 */
function Unfold({ children, className = "", from, delay, callout = false }: UnfoldProps) {
  return (
    <div
      className={`${styles.unfold} relative min-w-0 ${className}`}
      style={{ "--unfold-from": from, "--unfold-delay": `${delay}ms`, "--unfold-opacity": callout ? 0 : 1 } as Vars}
    >
      {callout && (
        <span aria-hidden="true" className="absolute -top-10 left-8 hidden h-10 w-px bg-gradient-to-b from-border-strong to-accent/50 lg:block">
          <span className="absolute -top-[3px] left-1/2 size-[7px] -translate-x-1/2 rounded-full border border-border-strong bg-background" />
        </span>
      )}
      {children}
    </div>
  );
}

/*
 * lg: the workspace window sits behind; the network inspector lifts out of it
 * on the left, log search hangs lower on the right and overhangs its edge,
 * and the three smaller callouts hang from them.
 *
 *   ┌ network inspector ─────┐
 *   │                        │  ┌ log search ──────┐
 *   └────────────────────────┘  │                  │
 *     │ notes      │ server     └──────────────────┘
 *                                 │ keyboard
 *
 * Below lg: one column (two on md), with the instruments first. The columns
 * are display: contents there, so `order` sorts the pieces.
 */
export function InstrumentBench() {
  return (
    <section id={SECTION_IDS.workspace} aria-labelledby="workspace-title" className="scroll-mt-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <EditorialHeading
          id="workspace-title"
          index="03"
          eyebrow="The workspace"
          title="Instruments, not hints."
          description="The tools you'd reach for in production, in one workspace. The network inspector and log search below are live: try them."
          align="end"
        />

        <Spotlight className="mt-14 lg:mt-20">
          <Reveal className={`${styles.bench} relative`}>
            {/* The workspace the instruments come out of (lg). */}
            <div
              aria-hidden="true"
              className={`${styles.unfold} absolute -left-4 bottom-10 right-[12%] top-10 hidden overflow-hidden rounded-2xl border border-border bg-surface-sunken/50 lg:block`}
              style={{ "--unfold-from": "scale(0.97)", "--unfold-opacity": 0 } as Vars}
            >
              <div className="flex h-9 items-center gap-1.5 border-b border-border px-3">
                <span className="size-2.5 rounded-full bg-border-strong" />
                <span className="size-2.5 rounded-full bg-border-strong" />
                <span className="size-2.5 rounded-full bg-border-strong" />
                <span className="ml-3 font-mono text-[11px] text-subtle">{replay.windowTitle}</span>
              </div>
              <div className="absolute inset-0 top-9 bg-[linear-gradient(90deg,var(--border)_1px,transparent_1px),linear-gradient(var(--border)_1px,transparent_1px)] bg-size-[48px_48px] opacity-30 [mask-image:radial-gradient(ellipse_at_40%_40%,black,transparent_75%)]" />
            </div>

            <div className="relative grid gap-4 md:grid-cols-2 lg:flex lg:items-start lg:gap-6">
              <div className="contents lg:flex lg:w-[62%] lg:shrink-0 xl:w-[58%] lg:flex-col lg:gap-10">
                <Unfold className="order-1 md:col-span-2 lg:order-none" from="translate3d(8%, 2rem, 0) scale(0.96)" delay={60}>
                  <NetworkTile />
                </Unfold>
                <div className="contents lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:pl-6">
                  <Unfold className="order-3 lg:order-none" from="translate3d(0, -2.5rem, 0) scale(0.94)" delay={420} callout>
                    <NotesTile />
                  </Unfold>
                  <Unfold className="order-4 lg:order-none" from="translate3d(0, -2.5rem, 0) scale(0.94)" delay={500} callout>
                    <ServerCheckTile />
                  </Unfold>
                </div>
              </div>
              <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-10 lg:pt-20">
                <Unfold className="order-2 md:col-span-2 lg:order-none" from="translate3d(-24%, -1.5rem, 0) scale(0.96)" delay={160}>
                  <LogSearchTile />
                </Unfold>
                <Unfold className="order-5 md:col-span-2 lg:order-none lg:mr-8 lg:pl-6" from="translate3d(0, -2.5rem, 0) scale(0.94)" delay={580} callout>
                  <KeyboardTile />
                </Unfold>
              </div>
            </div>
          </Reveal>
        </Spotlight>
      </div>
    </section>
  );
}
