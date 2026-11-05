import { AppHeader } from "@/components/layout/AppHeader";
import { SkipLinks, SkipTarget } from "@/components/layout/SkipLinks";
import type { PublicChallenge } from "@/types/catalog";
import { JournalScreen } from "./JournalView";

const HEADING_ID = "journal-heading";
const CONTENT_TARGET_ID = "journal";

/** The Learning Journal page: header, introduction and the browser-local journal. */
export function JournalPage({ challenges }: { challenges: PublicChallenge[] }) {
  return (
    <>
      <SkipLinks links={[{ target: CONTENT_TARGET_ID, label: "Skip to journal" }]} />
      <AppHeader current="journal" />
      <main aria-labelledby={HEADING_ID} className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="border-b border-border pb-6">
          <p className="font-mono text-xs uppercase tracking-wider text-accent">Learning Journal</p>
          <h1 id={HEADING_ID} className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Learning that sticks.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
            Solve a challenge, reflect on what gave the bug away, recall it a few days later, then apply it to a related investigation.
          </p>
          <p className="mt-4 max-w-2xl rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">
            <span className="font-medium text-foreground">Saved in this browser only.</span> Your journal is not linked to an account, does not
            follow you to another device, and is removed if you clear this site&apos;s data.
          </p>
        </header>
        <SkipTarget id={CONTENT_TARGET_ID} label="Journal" />
        <JournalScreen published={challenges} />
      </main>
    </>
  );
}
