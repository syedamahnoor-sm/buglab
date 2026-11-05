import { SessionChallengeOverview } from "@/components/challenge/SessionChallengeOverview";
import { AppHeader } from "@/components/layout/AppHeader";
import { SkipLinks } from "@/components/layout/SkipLinks";
import { WorkspaceClient } from "@/components/workspace/WorkspaceClient";
import { challengePath, ROUTES } from "@/lib/challenge-routes";
import type { WorkspaceScenario } from "@/types/workspace";
import { ChallengeJourney, type ChallengeLink } from "./ChallengeJourney";

interface ChallengeWorkspacePageProps {
  /** Learner-visible scenario data only. Answer keys never pass through here. */
  scenario: WorkspaceScenario;
  /** The next published challenge, offered once this one is solved; null for the last. */
  next?: { id: string; number: string; title: string } | null;
  /** Every published challenge ID, for the learner's journal. Without it the journal is not offered. */
  publishedIds?: readonly string[] | null;
}

/** The full workspace page for one challenge: header, overview and workspace. */
export function ChallengeWorkspacePage({ scenario, next = null, publishedIds = null }: ChallengeWorkspacePageProps) {
  const nextLink: ChallengeLink | null = next ? { href: challengePath(next.id), number: next.number, title: next.title } : null;
  return (
    <>
      <SkipLinks />
      <AppHeader current="workspace" />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-4 py-4 sm:px-6">
        <ChallengeJourney challenge={scenario.challenge} libraryHref={ROUTES.library} next={nextLink} publishedIds={publishedIds}>
          <SessionChallengeOverview challenge={scenario.challenge} />
          <WorkspaceClient
            challengeId={scenario.challenge.id}
            rootCauseOptions={scenario.rootCauseOptions}
            files={scenario.files}
            entryFilePath={scenario.entryFilePath}
            incidentDate={scenario.incidentDate}
            logs={scenario.logs}
            network={scenario.network}
          />
        </ChallengeJourney>
      </main>
    </>
  );
}
