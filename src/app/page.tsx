import { ChallengeOverview } from "@/components/challenge/ChallengeOverview";
import { AppHeader } from "@/components/layout/AppHeader";
import { DiagnosisPanel } from "@/components/workspace/DiagnosisPanel";
import { InvestigationConsole } from "@/components/workspace/InvestigationConsole";
import { WorkspaceClient } from "@/components/workspace/WorkspaceClient";
import { challenge001 } from "@/data/challenge-001";

export default function Home() {
  const scenario = challenge001;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <ChallengeOverview challenge={scenario.challenge} />
        <WorkspaceClient
          files={scenario.files}
          entryFilePath={scenario.entryFilePath}
          investigation={<InvestigationConsole logs={scenario.logs} className="flex-1" />}
          diagnosis={<DiagnosisPanel className="flex-1" />}
        />
      </main>
    </>
  );
}
