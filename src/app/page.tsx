import { ChallengeOverview } from "@/components/challenge/ChallengeOverview";
import { AppHeader } from "@/components/layout/AppHeader";
import { CodeEditorPlaceholder } from "@/components/workspace/CodeEditorPlaceholder";
import { DiagnosisPanel } from "@/components/workspace/DiagnosisPanel";
import { FileExplorer } from "@/components/workspace/FileExplorer";
import { InvestigationConsole } from "@/components/workspace/InvestigationConsole";
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout";
import {
  challenge,
  fileTree,
  incidentLogs,
  openFile,
} from "@/data/workspace-placeholder";

export default function Home() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <ChallengeOverview challenge={challenge} />
        <WorkspaceLayout
          explorer={
            <FileExplorer files={fileTree} activePath={openFile.path} className="flex-1" />
          }
          editor={<CodeEditorPlaceholder file={openFile} className="flex-1" />}
          investigation={<InvestigationConsole logs={incidentLogs} className="flex-1" />}
          diagnosis={<DiagnosisPanel className="flex-1" />}
        />
      </main>
    </>
  );
}
