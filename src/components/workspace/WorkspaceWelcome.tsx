import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SkipLinks, SkipTarget } from "@/components/layout/SkipLinks";
import { ArrowRightIcon, ClipboardIcon, SearchIcon, TerminalIcon } from "@/components/ui/icons";
import { challengePath, ROUTES } from "@/lib/challenge-routes";
import { WorkspacePreview } from "./WorkspacePreview";

/** A challenge the learner can pick up where they left off. */
export interface ResumableChallenge {
  id: string;
  number: string;
  title: string;
}

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The investigation, in order. Describes the workspace as it is. */
const WORKFLOW = [
  { icon: SearchIcon, title: "Explore", detail: "Choose a case in the Challenge Library and open its workspace." },
  { icon: TerminalIcon, title: "Investigate", detail: "Read the code, follow the logs and network traffic, and collect evidence." },
  { icon: ClipboardIcon, title: "Diagnose", detail: "Name the root cause and explain the evidence behind it." },
] as const;

export const WORKSPACE_HEADING_ID = "workspace-welcome-heading";

/**
 * The workspace overview, shown when no challenge is open: what the workspace
 * is, a preview of it, and the way in through the library. It never picks a
 * challenge on the learner's behalf.
 *
 * `resume` offers "Continue" for a challenge that is still unfinished. It is
 * optional because BugLab does not yet keep progress beyond the open page
 * (investigation state lives in memory and resets on refresh), so nothing can
 * vouch for an unfinished challenge today. Pass one only from a source that
 * knows the challenge is published and not resolved.
 */
export function WorkspaceWelcome({ resume = null }: { resume?: ResumableChallenge | null }) {
  return (
    <>
      <SkipLinks links={[{ target: "workspace-welcome", label: "Skip to content" }]} />
      <AppHeader current="workspace" />
      <main aria-labelledby={WORKSPACE_HEADING_ID} className="library-canvas flex w-full flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:gap-12">
          <SkipTarget id="workspace-welcome" label="Workspace" />
          <div className="grid animate-rise items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
            <div className="max-w-xl">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">
                Workspace <span className="text-subtle">·</span> Overview
              </p>
              <h1
                id={WORKSPACE_HEADING_ID}
                className="mt-3 text-[2rem] font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl"
              >
                Your investigation starts here.
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted sm:text-[1.0625rem]">
                Explore a debugging challenge, examine the evidence, and uncover what went wrong.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href={ROUTES.library}
                  className={`group inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent cta-gradient px-5 text-sm font-semibold text-background shadow-[0_8px_24px_-10px_var(--accent)] transition-[background-color,box-shadow,scale] duration-200 hover:bg-accent/90 hover:shadow-[0_10px_30px_-8px_var(--accent)] active:scale-[0.98] motion-reduce:transition-colors motion-reduce:active:scale-100 ${focusRing}`}
                >
                  Browse Challenges
                  <ArrowRightIcon className="transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
                </Link>
                {resume && (
                  <Link
                    href={challengePath(resume.id)}
                    className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-card-border-hover bg-card px-5 text-sm font-medium text-foreground transition-colors duration-200 hover:border-accent/50 hover:bg-hover-fill-raised ${focusRing}`}
                  >
                    Continue Last Challenge
                    <span className="font-mono text-xs text-muted">
                      <span className="sr-only">: </span>Challenge {resume.number}
                    </span>
                  </Link>
                )}
              </div>
              <p className="mt-5 text-sm leading-relaxed text-muted">
                Each challenge opens in its own workspace: read-only code, its logs and network traffic, and a diagnosis
                checked on the server.
              </p>
            </div>
            <WorkspacePreview />
          </div>

          <section aria-labelledby="workflow-heading">
            <h2 id="workflow-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              How an investigation works
            </h2>
            <ol className="mt-3 grid overflow-hidden rounded-2xl border border-panel-border bg-panel md:grid-cols-3">
              {WORKFLOW.map(({ icon: Icon, title, detail }, index) => (
                <li
                  key={title}
                  className="relative flex gap-3.5 border-panel-border p-4 sm:p-5 [&:not(:first-child)]:border-t md:[&:not(:first-child)]:border-l md:[&:not(:first-child)]:border-t-0"
                >
                  {index > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -left-3 top-1/2 z-10 hidden size-6 -translate-y-1/2 place-items-center rounded-full border border-panel-border bg-panel text-subtle md:grid"
                    >
                      <ArrowRightIcon width={12} height={12} />
                    </span>
                  )}
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/25 bg-accent/10 text-accent"
                  >
                    <Icon />
                  </span>
                  <p className="text-sm leading-snug">
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-subtle">{String(index + 1).padStart(2, "0")}</span>
                      <span className="font-medium text-foreground">{title}</span>
                    </span>
                    <span className="mt-1 block text-muted">{detail}</span>
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
