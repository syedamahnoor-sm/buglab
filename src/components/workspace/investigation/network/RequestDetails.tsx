import { useState, type ReactNode } from "react";
import { TabList, getTabIds, type TabDefinition } from "@/components/ui/TabList";
import type { NetworkRequest } from "@/types/investigation";
import { DetailHeader } from "../DetailHeader";
import { EvidenceToggle } from "../EvidenceToggle";
import { BodyView } from "./BodyView";
import { HeaderTable } from "./HeaderTable";
import { statusTextClass } from "./status";

type DetailTab = "headers" | "payload" | "response";

interface RequestDetailsProps {
  request: NetworkRequest;
  incidentDate: string;
  canOpenFile: (path: string) => boolean;
  collected: boolean;
  onAddEvidence: () => void;
  onRemoveEvidence: () => void;
  onOpenFile: (path: string) => void;
  onShowLog: (logId: string) => void;
  onClose: () => void;
}

const linkClass =
  "text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent";

function GeneralRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-subtle">{label}</dt>
      <dd className="break-all text-foreground/90">{children}</dd>
    </>
  );
}

export function RequestDetails({
  request,
  incidentDate,
  canOpenFile,
  collected,
  onAddEvidence,
  onRemoveEvidence,
  onOpenFile,
  onShowLog,
  onClose,
}: RequestDetailsProps) {
  const [tab, setTab] = useState<DetailTab>("headers");

  const tabs: TabDefinition<DetailTab>[] = [
    { id: "headers", label: "Headers" },
    ...(request.requestBody ? [{ id: "payload" as const, label: "Payload" }] : []),
    { id: "response", label: "Response" },
  ];
  // Keep the chosen tab across requests, falling back when it doesn't apply.
  const activeTab = tabs.some((item) => item.id === tab) ? tab : "headers";

  // Every listed tab has a mounted panel so aria-controls always resolves;
  // inactive panels are hidden. Panels are focusable so keyboard users can
  // Tab from the tab list into content that has no focusable elements.
  function panelProps(id: DetailTab) {
    const ids = getTabIds("request-detail", id);
    const isActive = id === activeTab;
    return {
      role: "tabpanel",
      id: ids.panel,
      "aria-labelledby": ids.tab,
      hidden: !isActive,
      tabIndex: 0,
      className: isActive
        ? "space-y-3 overflow-auto px-3 py-2.5 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/70"
        : "hidden",
    } as const;
  }

  return (
    <section aria-label={`Request ${request.id}`} className="flex min-h-0 flex-col">
      <DetailHeader
        title={
          <>
            <span className={statusTextClass(request.status)}>{request.status}</span>{" "}
            {request.method} {request.path}
          </>
        }
        closeLabel="Close request details"
        onClose={onClose}
        actions={
          <EvidenceToggle collected={collected} onAdd={onAddEvidence} onRemove={onRemoveEvidence} />
        }
      />

      <TabList
        tabs={tabs}
        activeId={activeTab}
        onChange={setTab}
        idPrefix="request-detail"
        label="Request details"
        className="h-8 border-b border-border bg-surface"
      />

      <div {...panelProps("headers")}>
        <section className="space-y-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            General
          </h4>
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 font-mono text-xs">
            <GeneralRow label="Request URL">{request.url}</GeneralRow>
            <GeneralRow label="Method">{request.method}</GeneralRow>
            <GeneralRow label="Status">
              <span className={statusTextClass(request.status)}>
                {request.status} {request.statusText}
              </span>
            </GeneralRow>
            <GeneralRow label="Type">{request.type}</GeneralRow>
            <GeneralRow label="Completed">
              {incidentDate}T{request.timestamp}Z · {request.durationMs} ms
            </GeneralRow>
            <GeneralRow label="Initiator">
              {request.initiator && canOpenFile(request.initiator) ? (
                <button
                  type="button"
                  onClick={() => onOpenFile(request.initiator!)}
                  className={linkClass}
                >
                  {request.initiator}
                </button>
              ) : (
                <span className="text-subtle">{request.initiator ?? "Parser"}</span>
              )}
            </GeneralRow>
            <GeneralRow label="Server log">
              <button type="button" onClick={() => onShowLog(request.serverLogId)} className={linkClass}>
                View in Logs ({request.serverLogId})
              </button>
            </GeneralRow>
          </dl>
        </section>
        <HeaderTable title="Response headers" headers={request.responseHeaders} />
        <HeaderTable title="Request headers" headers={request.requestHeaders} />
      </div>

      {request.requestBody && (
        <div {...panelProps("payload")}>
          <BodyView body={request.requestBody} emptyMessage="This request has no payload." />
        </div>
      )}

      <div {...panelProps("response")}>
        <BodyView
          body={request.responseBody}
          emptyMessage={
            request.status === 204 || request.status === 304
              ? `No response body (${request.status} ${request.statusText}).`
              : "Response body was not captured for this request."
          }
        />
      </div>
    </section>
  );
}
