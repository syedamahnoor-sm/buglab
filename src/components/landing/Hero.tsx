import { StatusDot } from "@/components/ui/StatusDot";
import { hero, primaryCta } from "@/data/landing";
import { CtaLink } from "./CtaLink";
import { HeroScene } from "./HeroScene";
import { LogField } from "./LogField";
import { styles } from "./styles";
import { TraceConnector } from "./TraceConnector";

/*
 * Entrances are pure CSS (@starting-style via Tailwind's `starting:`), so the
 * hero is complete without JavaScript and nothing moves for reduced motion.
 * The copy arrives from the left in a stagger; the scene comes from the right.
 */
const enterLeft =
  "motion-safe:transition-[opacity,translate,filter] motion-safe:duration-1000 motion-safe:ease-[cubic-bezier(.2,.8,.2,1)] motion-safe:starting:-translate-x-6 motion-safe:starting:opacity-0 motion-safe:starting:blur-[2px]";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* Layered lighting: aurora, drifting logs, grain, and the horizon. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className={`absolute inset-x-0 top-0 h-[46rem] ${styles.aurora}`} />
        <LogField />
        <div className={`absolute inset-0 ${styles.grain}`} />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-8 lg:pt-24">
        <div className="max-w-xl">
          <p
            className={`inline-flex items-center gap-2.5 rounded-full border border-border-strong bg-surface/70 px-3.5 py-1.5 font-mono text-[11px] text-muted backdrop-blur sm:text-xs ${enterLeft}`}
          >
            <StatusDot tone="danger" pulse />
            {hero.ticker}
          </p>
          <h1
            id="hero-title"
            className={`mt-6 text-[clamp(2.6rem,10vw,4.5rem)] lg:text-[clamp(3.6rem,5.6vw,5rem)] font-semibold leading-[0.95] tracking-[-0.045em] motion-safe:delay-75 sm:mt-8 ${styles.headline} ${enterLeft}`}
          >
            <span className="block whitespace-nowrap">Every bug</span>{" "}
            <span className="block whitespace-nowrap">leaves a trail.</span>
          </h1>
          <p
            className={`mt-6 max-w-lg text-pretty text-base leading-relaxed text-muted motion-safe:delay-150 sm:mt-7 sm:text-lg ${enterLeft}`}
          >
            {hero.subtitle}
          </p>
          <div
            className={`mt-8 flex flex-col items-stretch gap-3 motion-safe:delay-[225ms] sm:mt-10 sm:flex-row sm:items-center ${enterLeft}`}
          >
            <CtaLink href={primaryCta.href} size="lg" arrow>
              {primaryCta.label}
            </CtaLink>
            <CtaLink href={hero.secondaryCta.href} variant="secondary" size="lg">
              {hero.secondaryCta.label}
            </CtaLink>
          </div>
          <ul
            className={`mt-8 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-wider text-subtle motion-safe:delay-300 ${enterLeft}`}
          >
            {hero.proofPoints.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <span aria-hidden="true" className="size-1 rounded-full bg-accent" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <HeroScene />
      </div>

      {/* The bridge: the trace leaves the hero and leads into the replay. */}
      <div className="mt-12 sm:mt-16">
        <TraceConnector height="h-16 sm:h-24" />
      </div>

      <div
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-0 mx-auto h-px max-w-4xl ${styles.horizon}`}
      />
    </section>
  );
}
