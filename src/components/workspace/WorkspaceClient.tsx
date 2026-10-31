"use client";

import { useMemo, useState } from "react";
import { getTabIds } from "@/components/ui/TabList";
import { describeEvidence } from "@/lib/evidence";
import { buildFileTree, collectFolderPaths } from "@/lib/file-tree";
import type { RootCauseOption } from "@/types/diagnosis";
import type { NetworkRequest } from "@/types/investigation";
import type { LogEntry, ScenarioFile } from "@/types/workspace";
import { DiagnosisPanel } from "./DiagnosisPanel";
import { EditorPanel } from "./EditorPanel";
import { FileExplorer } from "./FileExplorer";
import { InvestigationConsole, type ConsoleTab } from "./investigation/InvestigationConsole";
import { useInvestigationController } from "./investigation/useInvestigationController";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { useWorkspaceController } from "./useWorkspaceController";

interface WorkspaceClientProps {
  challengeId: string;
  files: ScenarioFile[];
  entryFilePath: string;
  incidentDate: string;
  logs: LogEntry[];
  network: NetworkRequest[];
  rootCauseOptions: RootCauseOption[];
}

/** Client boundary for the interactive explorer, editor, console, and diagnosis. */
export function WorkspaceClient({
  challengeId,
  files,
  entryFilePath,
  incidentDate,
  logs,
  network,
  rootCauseOptions,
}: WorkspaceClientProps) {
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("logs");
  const tree = useMemo(() => buildFileTree(files), [files]);
  const filesByPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );
  const evidenceSources = useMemo(
    () => ({
      logsById: new Map(logs.map((entry) => [entry.id, entry])),
      requestsById: new Map(network.map((request) => [request.id, request])),
    }),
    [logs, network],
  );
  // Public input-validation context for the form. The server re-validates.
  const validationContext = useMemo(
    () => ({
      rootCauseIds: new Set(rootCauseOptions.map((option) => option.id)),
      logIds: new Set(logs.map((entry) => entry.id)),
      requestIds: new Set(network.map((request) => request.id)),
    }),
    [rootCauseOptions, logs, network],
  );

  const workspace = useWorkspaceController({
    entryFilePath,
    initiallyExpanded: collectFolderPaths(tree),
  });
  const investigation = useInvestigationController();

  const activeFile = workspace.activePath
    ? (filesByPath.get(workspace.activePath) ?? null)
    : null;

  const evidenceItems = investigation.evidence.map((item) => ({
    item,
    summary: describeEvidence(item.ref, evidenceSources),
  }));

  function showNotes() {
    setConsoleTab("notes");
    requestAnimationFrame(() => {
      document.getElementById(getTabIds("console", "notes").tab)?.focus();
    });
  }

  return (
    <WorkspaceLayout
      explorer={
        <FileExplorer
          tree={tree}
          fileCount={files.length}
          activePath={workspace.activePath}
          expandedFolders={workspace.expandedFolders}
          onOpenFile={workspace.openFile}
          onToggleFolder={workspace.toggleFolder}
          onSetFolderExpanded={workspace.setFolderExpanded}
          className="flex-1"
        />
      }
      editor={
        <EditorPanel
          openPaths={workspace.openPaths}
          activeFile={activeFile}
          onActivateTab={workspace.activateTab}
          onCloseTab={workspace.closeTab}
          className="flex-1"
        />
      }
      investigation={
        <InvestigationConsole
          logs={logs}
          network={network}
          incidentDate={incidentDate}
          investigation={investigation}
          evidenceItems={evidenceItems}
          canOpenFile={(path) => filesByPath.has(path)}
          onOpenFile={workspace.openFile}
          activeTab={consoleTab}
          onTabChange={setConsoleTab}
          className="flex-1"
        />
      }
      diagnosis={
        <DiagnosisPanel
          challengeId={challengeId}
          options={rootCauseOptions}
          evidenceRefs={investigation.evidence.map((item) => item.ref)}
          evidence={evidenceItems.map(({ summary }) => summary)}
          validationContext={validationContext}
          onManageEvidence={showNotes}
          className="flex-1"
        />
      }
    />
  );
}
