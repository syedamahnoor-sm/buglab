"use client";

import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { CodeIcon, LockIcon } from "@/components/ui/icons";
import { getFileLanguage, getLanguageLabel } from "@/lib/file-language";
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
  openPaths: string[];
  activeFile: ScenarioFile | null;
  onActivateTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  className?: string;
}

export function EditorPanel({
  openPaths,
  activeFile,
  onActivateTab,
  onCloseTab,
  className,
}: EditorPanelProps) {
  const language = activeFile ? getFileLanguage(activeFile.path) : null;

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
          <span className="truncate">{activeFile?.path ?? "No file open"}</span>
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
              path={activeFile.path}
              content={activeFile.content}
              language={language}
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
