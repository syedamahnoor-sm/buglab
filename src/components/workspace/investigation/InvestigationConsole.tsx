import { useMemo, useRef, useState, type ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { PanelExpandToggle, type PanelLayoutState } from "@/components/ui/PanelExpandToggle";
import { TabList, getTabIds, type TabDefinition } from "@/components/ui/TabList";
import { TerminalIcon } from "@/components/ui/icons";
import { getEvidenceId, type EvidenceSummary } from "@/lib/evidence";
import type { EvidenceItem, EvidenceRef, NetworkRequest } from "@/types/investigation";
import type { LogEntry } from "@/types/workspace";
import { LogsView } from "./logs/LogsView";
import { NetworkView } from "./network/NetworkView";
import { NotesView } from "./notes/NotesView";
import type { InvestigationController } from "./useInvestigationController";

export type ConsoleTab = "logs" | "network" | "notes";

const ID_PREFIX = "console";

interface InvestigationConsoleProps {
  logs: LogEntry[];
  network: NetworkRequest[];
  incidentDate: string;
  investigation: InvestigationController;
  evidenceItems: { item: EvidenceItem; summary: EvidenceSummary }[];
  canOpenFile: (path: string) => boolean;
  onOpenFile: (path: string) => void;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  layout?: PanelLayoutState;
  className?: string;
}

const BODY_ID = "investigation-console-body";

function CountBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-surface-raised px-1 font-mono text-[10px] text-subtle">
      {children}
    </span>
  );
}

export function InvestigationConsole({
  logs,
  network,
  incidentDate,
  investigation,
  evidenceItems,
  canOpenFile,
  onOpenFile,
  activeTab,
  onTabChange: setActiveTab,
  layout,
  className,
}: InvestigationConsoleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  const requestIdByLogId = useMemo(
    () => new Map(network.map((request) => [request.serverLogId, request.id])),
    [network],
  );

  const tabs: TabDefinition<ConsoleTab>[] = [
    { id: "logs", label: "Logs", badge: <CountBadge>{logs.length}</CountBadge> },
    { id: "network", label: "Network", badge: <CountBadge>{network.length}</CountBadge> },
    {
      id: "notes",
      label: "Notes",
      badge: evidenceItems.length > 0 && (
        <CountBadge>
          {evidenceItems.length}
          <span className="sr-only"> evidence items</span>
        </CountBadge>
      ),
    },
  ];

  // Move keyboard focus to the newly selected row once it has rendered.
  function focusOption(id: string) {
    requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>(`[data-option-id="${id}"]`)?.focus();
    });
  }

  function showLog(logId: string) {
    setActiveTab("logs");
    setSelectedLogId(logId);
    focusOption(logId);
  }

  function showRequest(requestId: string) {
    setActiveTab("network");
    setSelectedRequestId(requestId);
    focusOption(requestId);
  }

  function showSource(ref: EvidenceRef) {
    if (ref.kind === "log") showLog(ref.logId);
    else showRequest(ref.requestId);
  }

  const evidenceHandlers = {
    isCollected: investigation.isCollected,
    onAddEvidence: investigation.addEvidence,
    onRemoveEvidence: (ref: EvidenceRef) => investigation.removeEvidence(getEvidenceId(ref)),
  };

  function panelProps(tab: ConsoleTab) {
    const ids = getTabIds(ID_PREFIX, tab);
    const isActive = tab === activeTab;
    return {
      role: "tabpanel",
      id: ids.panel,
      "aria-labelledby": ids.tab,
      hidden: !isActive,
      className: isActive ? "flex min-h-0 flex-1 flex-col" : "hidden",
    } as const;
  }

  return (
    <Panel
      title="Investigation Console"
      icon={<TerminalIcon />}
      className={className}
      bodyClassName="flex flex-col bg-surface-sunken"
      bodyId={BODY_ID}
      collapsed={layout?.collapsed}
      actions={
        layout && (
          <PanelExpandToggle
            panelLabel="Investigation Console"
            expanded={layout.expanded}
            controls={BODY_ID}
            onToggle={layout.onToggle}
          />
        )
      }
      footer="Session only · notes and evidence reset on refresh"
    >
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
        <TabList
          tabs={tabs}
          activeId={activeTab}
          onChange={setActiveTab}
          idPrefix={ID_PREFIX}
          label="Investigation views"
          className="h-8 border-b border-border bg-surface"
        />

        {/* All views stay mounted so filters and selection survive tab switches. */}
        <div {...panelProps("logs")}>
          <LogsView
            logs={logs}
            incidentDate={incidentDate}
            selectedId={selectedLogId}
            onSelect={setSelectedLogId}
            requestIdByLogId={requestIdByLogId}
            onShowRequest={showRequest}
            {...evidenceHandlers}
          />
        </div>
        <div {...panelProps("network")}>
          <NetworkView
            requests={network}
            incidentDate={incidentDate}
            selectedId={selectedRequestId}
            onSelect={setSelectedRequestId}
            canOpenFile={canOpenFile}
            onOpenFile={onOpenFile}
            onShowLog={showLog}
            {...evidenceHandlers}
          />
        </div>
        <div {...panelProps("notes")}>
          <NotesView
            investigation={investigation}
            evidenceItems={evidenceItems}
            onShowSource={showSource}
          />
        </div>
      </div>
    </Panel>
  );
}
