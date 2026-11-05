import { useMemo, useState } from "react";
import { triggerHadFocus } from "@/lib/focus";
import { linkedLogId } from "@/lib/log-links";
import type { EvidenceRef, NetworkRequest, NetworkRequestType } from "@/types/investigation";
import { useListboxNavigation } from "../useListboxNavigation";
import { RequestDetails } from "./RequestDetails";
import { RequestRow } from "./RequestRow";

const SEARCH_INPUT_ID = "network-search";

type TypeFilter = "all" | NetworkRequestType;

const typeFilters: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "fetch", label: "Fetch" },
  { id: "document", label: "Doc" },
  { id: "script", label: "JS" },
  { id: "ping", label: "Ping" },
];

interface NetworkViewProps {
  requests: NetworkRequest[];
  /** IDs of the log lines that exist, so a request's link is shown only when it resolves. */
  logIds: ReadonlySet<string>;
  incidentDate: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canOpenFile: (path: string) => boolean;
  isCollected: (ref: EvidenceRef) => boolean;
  onAddEvidence: (ref: EvidenceRef) => void;
  onRemoveEvidence: (ref: EvidenceRef) => void;
  onOpenFile: (path: string) => void;
  onShowLog: (logId: string) => void;
}

export function NetworkView({
  requests,
  logIds,
  incidentDate,
  selectedId,
  onSelect,
  canOpenFile,
  isCollected,
  onAddEvidence,
  onRemoveEvidence,
  onOpenFile,
  onShowLog,
}: NetworkViewProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");

  const visibleRequests = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return requests.filter(
      (request) =>
        (typeFilter === "all" || request.type === typeFilter) &&
        (!needle || request.path.toLowerCase().includes(needle)),
    );
  }, [requests, typeFilter, query]);

  const visibleIds = visibleRequests.map((request) => request.id);
  const { listRef, tabStopId, handleKeyDown, focusOptionOrFallback } = useListboxNavigation(
    visibleIds,
    selectedId,
    onSelect,
  );

  const selected = selectedId ? requests.find((request) => request.id === selectedId) : undefined;
  const selectedIsHidden = selected !== undefined && !visibleIds.includes(selected.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <label className="min-w-32 flex-1">
          <span className="sr-only">Filter requests by path</span>
          <input
            id={SEARCH_INPUT_ID}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by path…"
            className="h-7 w-full rounded-md border border-border bg-surface-sunken px-2 font-mono text-xs text-foreground placeholder:text-subtle focus:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>
        <div role="group" aria-label="Request type" className="flex flex-wrap gap-1">
          {typeFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={typeFilter === filter.id}
              onClick={() => setTypeFilter(filter.id)}
              className={`h-6 rounded border px-1.5 text-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${
                typeFilter === filter.id
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border text-subtle hover:text-foreground"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <p aria-live="polite" className="text-xs text-subtle">
          {visibleRequests.length} of {requests.length}
        </p>
      </div>

      <div
        aria-hidden="true"
        className="grid shrink-0 grid-cols-[2.25rem_2.75rem_1fr_auto] gap-x-2 border-b border-border py-1 pl-[calc(0.75rem+2px)] pr-3 text-xs uppercase tracking-wider text-subtle sm:grid-cols-[2.25rem_2.75rem_1fr_4rem_3.5rem]"
      >
        <span>Status</span>
        <span>Method</span>
        <span>Path</span>
        <span className="hidden sm:inline">Type</span>
        <span className="text-right">Time</span>
      </div>

      <ul
        ref={listRef}
        role="listbox"
        aria-label="Network requests"
        className="min-h-28 flex-1 overflow-auto py-1 font-mono text-[12px] leading-5"
      >
        {visibleRequests.map((request) => (
          <RequestRow
            key={request.id}
            request={request}
            query={query}
            isSelected={request.id === selectedId}
            isTabStop={request.id === tabStopId}
            isCollected={isCollected({ kind: "network", requestId: request.id })}
            onSelect={onSelect}
            onKeyDown={handleKeyDown}
          />
        ))}
        {visibleRequests.length === 0 && (
          <li className="px-3 py-4 text-center font-sans text-xs text-subtle">
            No requests match the current filters.
          </li>
        )}
      </ul>

      {selected && (
        <div className="flex max-h-[50%] shrink-0 flex-col overflow-hidden border-t border-border-strong bg-surface-sunken">
          {selectedIsHidden && (
            <p className="border-b border-border px-3 py-1.5 text-xs text-warning">
              This request is hidden by the current filters.
            </p>
          )}
          <RequestDetails
            request={selected}
            logId={linkedLogId(selected, logIds)}
            incidentDate={incidentDate}
            canOpenFile={canOpenFile}
            collected={isCollected({ kind: "network", requestId: selected.id })}
            onAddEvidence={() => onAddEvidence({ kind: "network", requestId: selected.id })}
            onRemoveEvidence={() => onRemoveEvidence({ kind: "network", requestId: selected.id })}
            onOpenFile={onOpenFile}
            onShowLog={onShowLog}
            onClose={(event) => {
              // Return focus to the entry so keyboard users keep their place.
              const restore = triggerHadFocus(event);
              onSelect(null);
              if (restore) focusOptionOrFallback(selected.id, SEARCH_INPUT_ID);
            }}
          />
        </div>
      )}
    </div>
  );
}
