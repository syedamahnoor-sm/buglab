import { Panel } from "@/components/ui/Panel";
import { TerminalIcon } from "@/components/ui/icons";
import type { LogEntry } from "@/types/workspace";
import { LogLine } from "./LogLine";

interface InvestigationConsoleProps {
  logs: LogEntry[];
  className?: string;
}

// Only the Logs view exists in Stage 1. The other views are labels, not
// buttons, so they can't be mistaken for working tabs.
const upcomingViews = ["Network", "Notes"];

export function InvestigationConsole({ logs, className }: InvestigationConsoleProps) {
  return (
    <Panel
      title="Investigation Console"
      icon={<TerminalIcon />}
      className={className}
      bodyClassName="flex flex-col bg-surface-sunken"
      footer={`${logs.length} entries · static sample, live log streaming not yet available`}
    >
      <div className="flex h-8 shrink-0 items-stretch gap-1 border-b border-border bg-surface px-2 text-xs">
        <span className="flex items-center border-b-2 border-accent px-2 font-medium text-foreground">
          Logs
        </span>
        {upcomingViews.map((view) => (
          <span
            key={view}
            aria-disabled="true"
            title="Not available yet"
            className="flex cursor-default select-none items-center gap-1 px-2 text-subtle"
          >
            {view}
            <span className="text-[10px] uppercase tracking-wide opacity-70">
              (soon)
            </span>
          </span>
        ))}
      </div>

      <ol
        aria-label="Server logs"
        className="flex-1 overflow-auto py-2 font-mono text-[12px] leading-5"
      >
        {logs.map((entry) => (
          <LogLine key={entry.id} entry={entry} />
        ))}
      </ol>
    </Panel>
  );
}
