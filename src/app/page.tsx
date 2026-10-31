import { ChallengeOverview } from "@/components/challenge/ChallengeOverview";
import { AppHeader } from "@/components/layout/AppHeader";
import { WorkspaceClient } from "@/components/workspace/WorkspaceClient";
import { challenge001 } from "@/data/challenge-001";

export default function Home() {
  const scenario = challenge001;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-4 py-4 sm:px-6">
        <ChallengeOverview challenge={scenario.challenge} />
        <WorkspaceClient
          challengeId={scenario.challenge.id}
          rootCauseOptions={scenario.rootCauseOptions}
          files={scenario.files}
          entryFilePath={scenario.entryFilePath}
          incidentDate={scenario.incidentDate}
          logs={scenario.logs}
          network={scenario.network}
        />
      </main>
    </>
  );
}
