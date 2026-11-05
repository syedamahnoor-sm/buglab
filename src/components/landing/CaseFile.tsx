import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { StatusDot } from "@/components/ui/StatusDot";
import {
  SECTION_IDS,
  caseCta,
  caseFile,
  difficultyLabels,
  featuredChallenge as challenge,
} from "@/data/landing";
import type { Difficulty } from "@/types/workspace";
import { CtaLink } from "./CtaLink";
import { Reveal } from "./Reveal";
import { styles } from "./styles";

// Mirrors the workspace's ChallengeOverview colours without importing it.
const difficultyTones: Record<Difficulty, BadgeTone> = {
  beginner: "success",
  intermediate: "warning",
  advanced: "danger",
};

/*
 * Challenge 001 as an incident dossier: public details, symptoms and
 * timeline only.
 *
 * lg: the heading on the left with the case number set large; the dossier on
 * the right, on two sheets of paper inside a case folder that reaches up
 * behind the end of the workspace section, with a log line clipped to its top
 * and the timeline taped over its edge. The dossier slides in and settles as
 * it scrolls into view (CSS scroll timeline; flat and still without support or with
 * reduced motion). Below lg everything stacks flat.
 *
 * Its columns (5 / 7 of 12) match ClosingCta and CaseBridge, so the trace
 * runs straight down from the dossier into the handoff panel.
 */
export function CaseFile() {
  const last = caseFile.timeline.length - 1;

  return (
    <section
      id={SECTION_IDS.caseFile}
      aria-labelledby="case-file-title"
      className="relative scroll-mt-20 overflow-x-clip pt-24 sm:pt-32 lg:pt-20"
    >
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:gap-x-12">
        {/* Heading */}
        <Reveal className={`${styles.fromLeft} lg:col-span-5 lg:pt-28`}>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
            <span className="text-subtle">04</span>
            <span aria-hidden="true" className="mx-2 text-border-strong">
              /
            </span>
            Case file
          </p>
          <p
            aria-hidden="true"
            className={`mt-6 font-mono text-6xl font-light tracking-[-0.06em] sm:text-7xl xl:text-8xl ${styles.caseId}`}
          >
            {caseFile.caseId}
          </p>
          <h2
            id="case-file-title"
            className="mt-5 text-balance text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl"
          >
            Your first incident is open.
          </h2>
          <p className="mt-4 max-w-md text-pretty leading-relaxed text-muted">
            Everything on file is public: the report, the symptoms and the timeline. The cause is
            yours to find.
          </p>
        </Reveal>

        {/* The dossier */}
        <div className="relative lg:col-span-7">
          {/* The case folder, rising up behind the end of the workspace
              section (lg). It sits under everything (-z-10), so it shows only
              in the gaps between the instruments and never covers them. */}
          <div
            aria-hidden="true"
            className="absolute -top-40 bottom-24 -left-6 right-10 -z-10 hidden -rotate-[3deg] rounded-3xl border border-border bg-[linear-gradient(160deg,var(--surface-raised),var(--surface-sunken)_60%)] lg:block"
          >
            <span className="absolute left-8 top-5 font-mono text-[11px] uppercase tracking-[0.3em] text-subtle/70">
              {caseFile.caseId} · {caseFile.severity}
            </span>
          </div>
          {/* Sheets underneath, for depth (lg). */}
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden translate-x-5 translate-y-6 rotate-[2.4deg] rounded-2xl border border-border bg-surface-sunken lg:block"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden -translate-x-2 translate-y-3 -rotate-[1.4deg] rounded-2xl border border-border bg-surface/80 lg:block"
          />

          <div className={`relative ${styles.dossier}`}>
            {/* The clipped log line. */}
            <p className="relative z-10 mb-3 inline-flex max-w-full items-center gap-2.5 rounded-md border border-danger/30 bg-surface-raised px-3 py-1.5 font-mono text-[11px] text-muted shadow-lg shadow-ink/40 lg:absolute lg:-top-4 lg:left-10 lg:mb-0 lg:-rotate-[1.5deg]">
              <span aria-hidden="true" className="h-3.5 w-1.5 shrink-0 rounded-sm border border-border-strong bg-surface" />
              <span className="sr-only">Clipped log line: </span>
              <span className="text-subtle">{caseFile.clipping.time}</span>
              <span className="truncate text-danger/90">{caseFile.clipping.line}</span>
            </p>

            <article
              data-spot
              aria-labelledby="case-title"
              className={`${styles.spot} rounded-2xl border border-border-strong bg-surface shadow-[0_40px_90px_-40px_color-mix(in_oklab,var(--color-ink)_90%,transparent)]`}
            >
              {/* Header strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border-b border-border bg-[repeating-linear-gradient(135deg,transparent_0_10px,rgb(255_255_255/0.015)_10px_20px)] px-6 py-3 sm:px-8 lg:pt-5">
                <p className="font-mono text-xs uppercase tracking-[0.25em] text-subtle">
                  Case file · <span className="text-foreground">{caseFile.caseId}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-md border border-warning/35 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                    <StatusDot tone="warning" pulse />
                    Open
                  </span>
                  <Badge tone="danger">{caseFile.severity}</Badge>
                  <span className="font-mono text-[11px] text-subtle">{caseFile.service}</span>
                </div>
              </div>

              <div className="grid gap-10 p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] md:gap-8">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-subtle">Challenge {challenge.number}</p>
                  <h3
                    id="case-title"
                    className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
                  >
                    {challenge.title}
                  </h3>
                  <blockquote className="mt-5 border-l-2 border-danger/60 pl-4 text-base leading-relaxed text-foreground/90">
                    {challenge.incident}
                  </blockquote>

                  <h4 className="mt-7 font-mono text-[11px] uppercase tracking-wider text-subtle">
                    Evidence on file
                  </h4>
                  <dl className="mt-3 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
                    {caseFile.evidence.map((item) => (
                      <div key={item.label} className="bg-surface-sunken px-3.5 py-2.5">
                        <dt className="text-[11px] uppercase tracking-wider text-subtle">{item.label}</dt>
                        <dd className="mt-1 font-mono text-xs text-foreground/90 wrap-break-word">{item.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <dl className="mt-7 flex flex-wrap gap-x-10 gap-y-4 text-sm">
                    <div>
                      <dt className="text-[11px] uppercase tracking-wider text-subtle">Difficulty</dt>
                      <dd className="mt-1.5">
                        <Badge tone={difficultyTones[challenge.difficulty]}>
                          {difficultyLabels[challenge.difficulty]}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wider text-subtle">Est. time</dt>
                      <dd className="mt-1.5 font-mono text-muted">~{challenge.estimatedMinutes} min</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wider text-subtle">Topics</dt>
                      <dd className="mt-1.5">
                        <ul aria-label="Topics" className="flex flex-wrap gap-1.5">
                          {challenge.tags.map((tag) => (
                            <li key={tag}>
                              <Badge>{tag}</Badge>
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-9">
                    <CtaLink href={caseCta.href} size="lg" arrow>
                      {caseCta.label}
                    </CtaLink>
                  </div>
                </div>

                {/* The timeline, taped over the dossier's edge (md and up). */}
                <div className="relative rounded-xl border border-border bg-surface-raised p-5 shadow-xl shadow-ink/40 md:-mr-4 md:mt-6 md:self-start md:rotate-[1.2deg] lg:-mr-5">
                  <span
                    aria-hidden="true"
                    className="absolute -top-2 left-1/2 hidden h-4 w-16 -translate-x-1/2 -rotate-2 rounded-sm bg-foreground/10 backdrop-blur md:block"
                  />
                  <h4 className="font-mono text-[11px] uppercase tracking-wider text-subtle">Timeline (UTC)</h4>
                  <ol className="relative mt-4 space-y-5 border-l border-border-strong pl-5">
                    {caseFile.timeline.map((entry, index) => (
                      <li key={entry.time} className="relative">
                        <Reveal delay={200 + index * 140}>
                          <span
                            aria-hidden="true"
                            className={`absolute -left-[24px] top-1.5 size-2 rounded-full ${
                              index === last ? `bg-accent ${styles.traceNode}` : "bg-border-strong"
                            }`}
                          />
                          <p className="font-mono text-xs text-accent">{entry.time}</p>
                          <p className="mt-0.5 text-sm text-foreground/90">{entry.text}</p>
                        </Reveal>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
