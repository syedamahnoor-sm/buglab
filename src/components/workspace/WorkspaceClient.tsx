"use client";

import { useMemo, type ReactNode } from "react";
import { buildFileTree, collectFolderPaths } from "@/lib/file-tree";
import type { ScenarioFile } from "@/types/workspace";
import { EditorPanel } from "./EditorPanel";
import { FileExplorer } from "./FileExplorer";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { useWorkspaceController } from "./useWorkspaceController";

interface WorkspaceClientProps {
  files: ScenarioFile[];
  entryFilePath: string;
  /** Server-rendered panels passed through as slots. */
  investigation: ReactNode;
  diagnosis: ReactNode;
}

/** Client boundary for the interactive explorer and editor. */
export function WorkspaceClient({
  files,
  entryFilePath,
  investigation,
  diagnosis,
}: WorkspaceClientProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const filesByPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );

  const workspace = useWorkspaceController({
    entryFilePath,
    initiallyExpanded: collectFolderPaths(tree),
  });

  const activeFile = workspace.activePath
    ? (filesByPath.get(workspace.activePath) ?? null)
    : null;

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
      investigation={investigation}
      diagnosis={diagnosis}
    />
  );
}
