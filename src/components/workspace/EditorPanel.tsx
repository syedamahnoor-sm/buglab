"use client";

import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { CodeIcon, LockIcon } from "@/components/ui/icons";
import { getLanguageLabel, resolveFileLanguage } from "@/lib/file-language";
import { getFileName, getFolderPrefix } from "@/lib/file-tree";
import type { ScenarioFile } from "@/types/workspace";
import { EditorLoading } from "./EditorLoading";
import { EditorTabs, getTabId } from "./EditorTabs";

// Monaco touches `window` on import, so it is only ever loaded in the browser.
const MonacoEditor = dynamic(
  () => import("./MonacoEditor").then((module) => module.MonacoEditor),
  { ssr: false, loading: () => <EditorLoading /> },
);

const PANEL_ID = "editor-tabpanel";

interface EditorPanelProps {
  challengeId: string;
  openPaths: string[];
  activeFile: ScenarioFile | null;
  onActivateTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  className?: string;
}

export function EditorPanel({
  challengeId,
  openPaths,
  activeFile,
  onActivateTab,
  onCloseTab,
  className,
}: EditorPanelProps) {
  const language = activeFile ? resolveFileLanguage(activeFile) : null;

  return (
    <Panel
      title="Editor"
      icon={<CodeIcon />}
      className={className}
      bodyClassName="flex flex-col bg-surface-sunken"
      actions={
        <Badge>
          <LockIcon width={12} height={12} />
          Read-only
        </Badge>
      }
      footer={
        <div className="flex items-center justify-between gap-3 font-mono">
          {activeFile ? (
            // The folder part gives way first, so the file name stays readable.
            <span className="flex min-w-0" title={activeFile.path}>
              <span className="min-w-0 shrink-[100] truncate">
                {getFolderPrefix(activeFile.path)}
              </span>
              <span className="min-w-0 truncate text-foreground/80">
                {getFileName(activeFile.path)}
              </span>
            </span>
          ) : (
            <span className="truncate">No file open</span>
          )}
          {language && (
            <span className="shrink-0">{getLanguageLabel(language)} · UTF-8</span>
          )}
        </div>
      }
    >
      {openPaths.length > 0 && (
        <EditorTabs
          openPaths={openPaths}
          activePath={activeFile?.path ?? null}
          panelId={PANEL_ID}
          onActivate={onActivateTab}
          onClose={onCloseTab}
        />
      )}

      <div
        id={PANEL_ID}
        role={activeFile ? "tabpanel" : undefined}
        aria-labelledby={activeFile ? getTabId(activeFile.path) : undefined}
        className="relative min-h-0 flex-1"
      >
        {activeFile && language ? (
          <div className="absolute inset-0">
            <MonacoEditor
              challengeId={challengeId}
              path={activeFile.path}
              content={activeFile.content}
              language={language}
              openPaths={openPaths}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="text-sm text-subtle">
              No file open. Select a file in the Explorer to view it.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
