import { useMemo, useState } from "react";
import { triggerHadFocus } from "@/lib/focus";
import type { EvidenceRef } from "@/types/investigation";
import type { LogEntry, LogLevel } from "@/types/workspace";
import { useListboxNavigation } from "../useListboxNavigation";
import { LOG_LEVELS, LOG_SEARCH_INPUT_ID, LogFilterBar } from "./LogFilterBar";
import { LogDetails } from "./LogDetails";
import { LogRow } from "./LogRow";

interface LogsViewProps {
  logs: LogEntry[];
  incidentDate: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  requestIdByLogId: ReadonlyMap<string, string>;
  isCollected: (ref: EvidenceRef) => boolean;
  onAddEvidence: (ref: EvidenceRef) => void;
  onRemoveEvidence: (ref: EvidenceRef) => void;
  onShowRequest: (requestId: string) => void;
}

export function LogsView({
  logs,
  incidentDate,
  selectedId,
  onSelect,
  requestIdByLogId,
  isCollected,
  onAddEvidence,
  onRemoveEvidence,
  onShowRequest,
}: LogsViewProps) {
  const [enabledLevels, setEnabledLevels] = useState<ReadonlySet<LogLevel>>(
    () => new Set(LOG_LEVELS),
  );
  const [query, setQuery] = useState("");

  const levelCounts = useMemo(() => {
    const counts = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 } satisfies Record<LogLevel, number>;
    for (const entry of logs) counts[entry.level] += 1;
    return counts;
  }, [logs]);

  const visibleLogs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs.filter(
      (entry) =>
        enabledLevels.has(entry.level) &&
        (!needle ||
          entry.message.toLowerCase().includes(needle) ||
          entry.source.toLowerCase().includes(needle)),
    );
  }, [logs, enabledLevels, query]);

  const visibleIds = visibleLogs.map((entry) => entry.id);
  const { listRef, tabStopId, handleKeyDown, focusOptionOrFallback } = useListboxNavigation(
    visibleIds,
    selectedId,
    onSelect,
  );

  const selected = selectedId ? logs.find((entry) => entry.id === selectedId) : undefined;
  const selectedIsHidden = selected !== undefined && !visibleIds.includes(selected.id);

  function toggleLevel(level: LogLevel) {
    setEnabledLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function resetFilters() {
    setEnabledLevels(new Set(LOG_LEVELS));
    setQuery("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LogFilterBar
        enabledLevels={enabledLevels}
        levelCounts={levelCounts}
        onToggleLevel={toggleLevel}
        query={query}
        onQueryChange={setQuery}
        shownCount={visibleLogs.length}
        totalCount={logs.length}
        onReset={resetFilters}
      />

      <ul
        ref={listRef}
        role="listbox"
        aria-label="Server logs"
        className="min-h-28 flex-1 overflow-auto py-1.5 font-mono text-[12px] leading-5"
      >
        {visibleLogs.map((entry) => (
          <LogRow
            key={entry.id}
            entry={entry}
            query={query}
            isSelected={entry.id === selectedId}
            isTabStop={entry.id === tabStopId}
            isCollected={isCollected({ kind: "log", logId: entry.id })}
            onSelect={onSelect}
            onKeyDown={handleKeyDown}
          />
        ))}
        {visibleLogs.length === 0 && (
          <li className="px-3 py-4 text-center font-sans text-xs text-subtle">
            No log entries match the current filters.
          </li>
        )}
      </ul>

      {selected && (
        <div className="max-h-[50%] shrink-0 overflow-auto border-t border-border-strong bg-surface-sunken">
          {selectedIsHidden && (
            <p className="border-b border-border px-3 py-1.5 text-[11px] text-warning">
              This entry is hidden by the current filters.
            </p>
          )}
          <LogDetails
            entry={selected}
            incidentDate={incidentDate}
            relatedRequestId={requestIdByLogId.get(selected.id)}
            collected={isCollected({ kind: "log", logId: selected.id })}
            onAddEvidence={() => onAddEvidence({ kind: "log", logId: selected.id })}
            onRemoveEvidence={() => onRemoveEvidence({ kind: "log", logId: selected.id })}
            onShowRequest={onShowRequest}
            onClose={(event) => {
              // Return focus to the entry so keyboard users keep their place.
              const restore = triggerHadFocus(event);
              onSelect(null);
              if (restore) focusOptionOrFallback(selected.id, LOG_SEARCH_INPUT_ID);
            }}
          />
        </div>
      )}
    </div>
  );
}
