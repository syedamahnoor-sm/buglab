import { StatusDot } from "@/components/ui/StatusDot";
import { caseFile, closing, featuredChallenge as challenge, openWorkspaceCta } from "@/data/landing";
import { CtaLink } from "./CtaLink";
import { QuietLogField } from "./QuietLogField";
import { Reveal } from "./Reveal";
import { styles } from "./styles";

/*
 * The handoff. lg: the closing line and the CTA on the left; on the right
 * the incident handed over to the visitor, still open, public details only.
 * The trace from the dossier (CaseBridge) lands on the panel's top edge.
 * The copy comes in from the left, the panel from the right; the CTA glows
 * once when it arrives. Below lg everything stacks.
 */
export function ClosingCta() {
  const { handoff } = closing;
  const opened = caseFile.timeline.find((entry) => entry.text.startsWith("Incident opened"));
  const rows: [string, string][] = [
    ["Service", caseFile.service],
    ["Severity", caseFile.severity],
    ["Opened", `${opened?.time} UTC`],
  ];
  const log = caseFile.timeline.slice(-2);

  return (
    <section aria-labelledby="closing-title" className="relative isolate overflow-hidden">
      {/* Calmer than the hero: low light, slow faint logs. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className={`absolute inset-x-0 bottom-0 h-[34rem] rotate-180 opacity-70 ${styles.aurora}`} />
        <QuietLogField />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-background to-transparent" />
      </div>

      <div className="mx-auto grid max-w-7xl gap-14 px-4 pb-28 pt-6 sm:px-6 lg:grid-cols-12 lg:items-start lg:gap-x-12 lg:pb-36 lg:pt-0">
        <Reveal className={`${styles.fromLeft} lg:col-span-5 lg:pt-10`}>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
            <span className="text-subtle">05</span>
            <span aria-hidden="true" className="mx-2 text-border-strong">
              /
            </span>
            Handoff
          </p>
          <h2
            id="closing-title"
            className={`mt-5 text-balance text-[clamp(2.6rem,9vw,4.25rem)] font-semibold lg:text-[clamp(2.75rem,4.6vw,4.25rem)] leading-[0.98] tracking-[-0.045em] ${styles.headline}`}
          >
            {closing.title}
          </h2>
          <p className="mt-6 max-w-md text-pretty leading-relaxed text-muted sm:text-lg">{closing.subtitle}</p>
          <div className={`mt-9 inline-flex ${styles.halo}`}>
            <CtaLink href={openWorkspaceCta.href} size="lg" arrow>
              {openWorkspaceCta.label}
            </CtaLink>
          </div>
        </Reveal>

        <Reveal delay={150} className={`${styles.fromRight} relative lg:col-span-7 lg:col-start-6`}>
          {/* A sheet underneath, for depth. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden translate-x-4 translate-y-4 rotate-[1.6deg] rounded-2xl border border-border bg-surface-sunken/80 sm:block"
          />
          <article
            aria-labelledby="handoff-title"
            className="relative rounded-2xl border border-border-strong bg-surface/95 shadow-[0_40px_90px_-40px_color-mix(in_oklab,var(--color-ink)_90%,transparent)] backdrop-blur"
          >
            {/* Where the trace from the dossier lands. */}
            <span
              aria-hidden="true"
              className={`absolute -top-1 left-10 size-2 -translate-x-1/2 rounded-full bg-accent ${styles.traceNode}`}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3.5 sm:px-8">
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-subtle">
                Incident handoff · <span className="text-foreground">{caseFile.caseId}</span>
              </p>
              <span className="inline-flex items-center gap-2 rounded-md border border-warning/35 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                <StatusDot tone="warning" pulse />
                {handoff.status}
              </span>
            </div>

            <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <h3 id="handoff-title" className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  {challenge.title}
                </h3>
                <dl className="mt-5 space-y-2.5 text-sm">
                  {rows.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
                      <dt className="text-subtle">{label}</dt>
                      <dd className="font-mono text-xs leading-5 text-foreground/90 wrap-break-word">{value}</dd>
                    </div>
                  ))}
                  <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
                    <dt className="text-subtle">Owner</dt>
                    <dd className="flex items-center gap-1 font-mono text-xs leading-5 text-accent">
                      {handoff.owner}
                      <span aria-hidden="true" className={`inline-block h-3.5 w-1.5 bg-accent/70 ${styles.caret}`} />
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="min-w-0 rounded-lg border border-border bg-surface-sunken p-4 font-mono text-[11px] leading-5">
                <p className="uppercase tracking-wider text-subtle">Incident log</p>
                <ol className="mt-3 space-y-2">
                  {log.map((entry, index) => (
                    <li key={entry.time}>
                      <Reveal delay={350 + index * 140} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
                        <span className="text-subtle">{entry.time}</span>
                        <span className="text-foreground/80">{entry.text}</span>
                      </Reveal>
                    </li>
                  ))}
                  <li>
                    <Reveal delay={350 + log.length * 140} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
                      <span className="text-accent">now</span>
                      <span className="text-accent">{handoff.note}</span>
                    </Reveal>
                  </li>
                </ol>
              </div>
            </div>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
