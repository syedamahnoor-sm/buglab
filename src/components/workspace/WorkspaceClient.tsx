"use client";

import { useMemo } from "react";
import { describeEvidence } from "@/lib/evidence";
import { buildFileTree, collectFolderPaths } from "@/lib/file-tree";
import type { NetworkRequest } from "@/types/investigation";
import type { LogEntry, ScenarioFile } from "@/types/workspace";
import { DiagnosisPanel } from "./DiagnosisPanel";
import { EditorPanel } from "./EditorPanel";
import { FileExplorer } from "./FileExplorer";
import { InvestigationConsole } from "./investigation/InvestigationConsole";
import { useInvestigationController } from "./investigation/useInvestigationController";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { useWorkspaceController } from "./useWorkspaceController";

interface WorkspaceClientProps {
  files: ScenarioFile[];
  entryFilePath: string;
  incidentDate: string;
  logs: LogEntry[];
  network: NetworkRequest[];
}

/** Client boundary for the interactive explorer, editor, console, and diagnosis. */
export function WorkspaceClient({
  files,
  entryFilePath,
  incidentDate,
  logs,
  network,
}: WorkspaceClientProps) {
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
          className="flex-1"
        />
      }
      diagnosis={
        <DiagnosisPanel
          evidence={evidenceItems.map(({ summary }) => summary)}
          className="flex-1"
        />
      }
    />
  );
}
