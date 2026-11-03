import { SessionChallengeOverview } from "@/components/challenge/SessionChallengeOverview";
import { AppHeader } from "@/components/layout/AppHeader";
import { SkipLinks } from "@/components/layout/SkipLinks";
import { WorkspaceClient } from "@/components/workspace/WorkspaceClient";
import { ChallengeSessionProvider } from "@/engine/client/ChallengeSessionProvider";
import { sessionConfigForChallenge } from "@/engine/session/config";
import type { WorkspaceScenario } from "@/types/workspace";

interface ChallengeWorkspacePageProps {
  /** Learner-visible scenario data only. Answer keys never pass through here. */
  scenario: WorkspaceScenario;
}

/** The full workspace page for one challenge: header, overview and workspace. */
export function ChallengeWorkspacePage({ scenario }: ChallengeWorkspacePageProps) {
  return (
    <>
      <SkipLinks />
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-4 py-4 sm:px-6">
        {/*
          TEMPORARY: investigationStarted is fixed to true, which keeps today's
          "Investigating" display. The real signal (the first evidence, hypothesis
          or observation added) needs Syeda's approval to change the investigation
          controller. Until then "not-started" cannot occur.
        */}
        <ChallengeSessionProvider
          config={sessionConfigForChallenge(scenario.challenge)}
          investigationStarted
        >
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
        </ChallengeSessionProvider>
      </main>
    </>
  );
}
