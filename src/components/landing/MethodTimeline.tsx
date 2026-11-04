import type { CSSProperties } from "react";
import { SECTION_IDS, methodSteps } from "@/data/landing";
import { EditorialHeading } from "./EditorialHeading";
import { styles } from "./styles";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

// Columns each explanation spans on the 100-column grid, from its step's start.
const SPAN = 22;
// Stem heights (px) from axis to explanation: staggered, not a row of cards.
const stems = [56, 36, 112, 92, 44];
// The cursor crosses the axis between these points of the timeline's "cover"
// scroll range (landing.css uses the same numbers): roughly from its middle
// passing three quarters down the screen to it passing a third down.
const SWEEP_FROM = 25;
const SWEEP_LENGTH = 27;
const litAt = (percent: number) => `${SWEEP_FROM + (percent * SWEEP_LENGTH) / 100}%`;

/*
 * The method as one horizontal trace (lg): five spans on a shared time axis,
 * explanations hanging above and below it. As the page scrolls down, a cursor
 * moves along the axis and each step lights up when the cursor reaches it.
 * Below lg the same list reads as a vertical path.
 *
 * Scroll-linked motion is CSS only (animation-timeline) and needs no
 * JavaScript. Without support, or with reduced motion, every step is lit.
 */
export function MethodTimeline() {
  return (
    <section id={SECTION_IDS.method} aria-labelledby="method-title" className="scroll-mt-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <EditorialHeading
          id="method-title"
          index="02"
          eyebrow="The method"
          title="Work it like on-call does."
          description="No step-by-step tutorial. You get what an engineer gets during an incident, and you decide where to look."
          align="start"
        />

        <ol
          className={`${styles.method} relative mt-14 lg:mt-20 lg:grid lg:grid-cols-[repeat(100,minmax(0,1fr))] lg:grid-rows-[auto_2rem_auto]`}
        >
          {/* Vertical path (below lg): the line, and its scroll-linked fill. */}
          <li aria-hidden="true" className="absolute inset-y-2 left-[3px] w-px bg-border-strong lg:hidden">
            <span className={`absolute inset-0 ${styles.methodPathFill}`} />
          </li>

          {/* The axis (lg): track, spans and nodes. */}
          <li
            aria-hidden="true"
            className="relative col-span-full row-start-2 hidden lg:block"
          >
            <span className="absolute inset-x-0 top-1/2 h-px bg-border-strong" />
            {methodSteps.map((step) => (
              <span key={step.title}>
                <span
                  className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-accent/90 to-accent/35 shadow-[0_0_14px_-3px_var(--accent)] ${styles.methodSpan}`}
                  style={
                    {
                      left: `${step.start}%`,
                      width: `${step.width}%`,
                      "--lit-from": litAt(step.start),
                      "--lit-to": litAt(step.start + step.width),
                    } as Vars
                  }
                />
                <span
                  className={`absolute top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ${styles.traceNode} ${styles.methodNode}`}
                  style={{ left: `${step.start}%`, "--lit-from": litAt(step.start) } as Vars}
                />
              </span>
            ))}
            {/* Where the axis hands over to the workspace below. */}
            <span className="absolute right-0 top-1/2 size-[7px] translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong" />
          </li>

          {/* The axis turns down at its end, towards the workspace (lg). */}
          <li aria-hidden="true" className="relative col-span-full row-span-2 row-start-2 hidden lg:block">
            <span className="absolute -bottom-px right-0 top-4 w-px translate-x-1/2 bg-gradient-to-b from-border-strong to-accent/50" />
          </li>

          {/* The cursor (lg), on the axis and clipped to its length. */}
          <li
            aria-hidden="true"
            className="pointer-events-none relative col-span-full row-start-2 hidden overflow-x-clip lg:block"
          >
            <span className={`absolute inset-0 ${styles.methodCursor}`}>
              <span className="absolute -inset-y-20 left-0 w-px bg-gradient-to-b from-transparent via-accent to-transparent" />
              <span className="absolute left-0 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-background shadow-[0_0_16px_var(--accent)]" />
            </span>
          </li>

          {methodSteps.map((step, index) => {
            const above = index % 2 === 0;
            return (
              <li
                key={step.title}
                className={`relative pb-10 pl-10 last:pb-0 lg:flex lg:pb-0 lg:pl-0 ${
                  above ? "lg:row-start-1 lg:flex-col lg:self-end" : "lg:row-start-3 lg:flex-col-reverse lg:self-start"
                }`}
                style={{ gridColumn: `${step.start + 1} / span ${SPAN}` }}
              >
                {/* Node on the vertical path. */}
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-3 size-[7px] rounded-full bg-accent lg:hidden ${styles.traceNode}`}
                />
                <div
                  className={`${styles.methodStep} lg:pl-4`}
                  style={{ "--lit-from": litAt(step.start) } as Vars}
                >
                  <p className="font-mono text-3xl font-light tracking-[-0.04em] text-accent tabular-nums lg:text-4xl xl:text-5xl">
                    {step.offset}
                  </p>
                  <h3 className="mt-2 font-medium text-foreground lg:mt-3">{step.title}</h3>
                  <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{step.description}</p>
                  {/* The step's span on a small time track (below lg). */}
                  <span aria-hidden="true" className="relative mt-4 block h-1 max-w-xs rounded-full bg-surface-sunken lg:hidden">
                    <span
                      className="absolute inset-y-0 rounded-full bg-gradient-to-r from-accent/90 to-accent/35"
                      style={{ left: `${step.start}%`, width: `${step.width}%` }}
                    />
                  </span>
                </div>
                {/* Stem down (or up) to the axis. */}
                <span
                  aria-hidden="true"
                  className={`hidden w-px shrink-0 bg-gradient-to-b lg:block ${
                    above ? "-mb-4 from-border-strong to-accent/60" : "-mt-4 from-accent/60 to-border-strong"
                  }`}
                  style={{ height: stems[index] }}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
