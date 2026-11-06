import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SkipLinks, SkipTarget } from "@/components/layout/SkipLinks";
import { ClipboardIcon, CodeIcon, SearchIcon, TerminalIcon } from "@/components/ui/icons";
import type { PublicChallenge } from "@/types/catalog";
import { JournalScreen } from "./JournalView";

const HEADING_ID = "journal-heading";
const CONTENT_TARGET_ID = "journal";

/** The Learning Loop, in order. Each step describes what BugLab does today. */
const LOOP = [
  { icon: TerminalIcon, title: "Solve", detail: "Diagnose a challenge." },
  { icon: CodeIcon, title: "Reflect", detail: "Note the takeaway." },
  { icon: ClipboardIcon, title: "Recall", detail: "After 1, 3 and 7 days." },
  { icon: SearchIcon, title: "Apply", detail: "On a related case." },
] as const;

/** The Learning Journal page: introduction, the loop, and the browser-local journal. */
export function JournalPage({ challenges }: { challenges: PublicChallenge[] }) {
  return (
    <>
      <SkipLinks links={[{ target: CONTENT_TARGET_ID, label: "Skip to journal" }]} />
      <AppHeader current="journal" />
      <main aria-labelledby={HEADING_ID} className="library-canvas flex w-full flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
          <header className="grid animate-rise items-end gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-12">
            <div className="max-w-xl">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">Learning Journal</p>
              <h1 id={HEADING_ID} className="mt-3 text-[2rem] font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
                Learning that sticks.
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted sm:text-[1.0625rem]">
                Reflect on each investigation you solve, recall it a few days later, and apply it to a related case.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                <span className="font-medium text-foreground">Saved in this browser only.</span> Not linked to an account, not synced to other
                devices, and removed if you clear this site&apos;s data. No reminders are sent.
              </p>
            </div>
            <ol aria-label="The Learning Loop" className="grid grid-cols-2 overflow-hidden rounded-2xl border border-panel-border bg-panel sm:grid-cols-4">
              {LOOP.map(({ icon: Icon, title, detail }, index) => (
                <li
                  key={title}
                  className="flex flex-col gap-2 border-panel-border p-4 [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-t-0 [&:nth-child(even)]:border-l sm:[&:not(:first-child)]:border-l"
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg border border-accent/25 bg-accent/10 text-accent">
                      <Icon />
                    </span>
                    <span className="font-mono text-xs text-subtle">{String(index + 1).padStart(2, "0")}</span>
                  </span>
                  <p className="text-sm leading-snug">
                    <span className="block font-medium text-foreground">{title}</span>
                    <span className="text-muted">{detail}</span>
                  </p>
                </li>
              ))}
            </ol>
          </header>
          <SkipTarget id={CONTENT_TARGET_ID} label="Journal" />
          <JournalScreen published={challenges} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
