import Link from "next/link";
import { LearningIdentityNotice } from "@/components/account/LearningIdentityNotice";
import { focusRing } from "@/components/journal/ui";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SkipLinks, SkipTarget } from "@/components/layout/SkipLinks";
import { ROUTES } from "@/lib/challenge-routes";
import type { PublicChallenge } from "@/types/catalog";
import { ProgressScreen } from "./ProgressView";

const HEADING_ID = "progress-heading";
const CONTENT_TARGET_ID = "progress";

/** The Learning Progress page: what has been solved, reflected on and recalled in this browser, and what to do next. */
export function ProgressPage({ challenges }: { challenges: PublicChallenge[] }) {
  return (
    <>
      <SkipLinks links={[{ target: CONTENT_TARGET_ID, label: "Skip to progress" }]} />
      <AppHeader current="progress" />
      <LearningIdentityNotice />
      <main aria-labelledby={HEADING_ID} className="library-canvas flex w-full flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
          <header className="flex animate-rise flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">Learning Progress</p>
              <h1 id={HEADING_ID} className="mt-3 text-[2rem] font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
                See your learning take shape.
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted sm:text-[1.0625rem]">
                What you have solved, reflected on and recalled, where you have explored, and what to do next.
              </p>
            </div>
            <p className="max-w-sm rounded-2xl border border-panel-border bg-panel p-4 text-sm leading-relaxed text-muted">
              <span className="font-medium text-foreground">Completed in this browser.</span> Read from your{" "}
              <Link href={ROUTES.journal} className={`rounded text-accent underline-offset-4 hover:underline ${focusRing}`}>
                Learning Journal
              </Link>
              . Not linked to an account or shared across devices, and removed if you clear this site&apos;s data.
            </p>
          </header>
          <Link href={ROUTES.learningPath} className={`w-fit rounded text-sm font-medium text-accent underline-offset-4 hover:underline ${focusRing}`}>
            Plan your next investigation with Learning Path &rarr;
          </Link>
          <SkipTarget id={CONTENT_TARGET_ID} label="Progress" />
          <ProgressScreen published={challenges} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
