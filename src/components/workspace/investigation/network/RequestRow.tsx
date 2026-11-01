import type { KeyboardEvent } from "react";
import { highlightMatches } from "@/lib/text-highlight";
import type { NetworkRequest } from "@/types/investigation";
import { statusTextClass } from "./status";

interface RequestRowProps {
  request: NetworkRequest;
  query: string;
  isSelected: boolean;
  isTabStop: boolean;
  isCollected: boolean;
  onSelect: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

export function RequestRow({
  request,
  query,
  isSelected,
  isTabStop,
  isCollected,
  onSelect,
  onKeyDown,
}: RequestRowProps) {
  return (
    <li
      role="option"
      data-option-id={request.id}
      aria-selected={isSelected}
      tabIndex={isTabStop ? 0 : -1}
      onClick={() => onSelect(request.id)}
      onKeyDown={(event) => onKeyDown(event, request.id)}
      className={`grid cursor-pointer grid-cols-[2.25rem_2.75rem_1fr_auto] items-center gap-x-2 border-l-2 px-3 py-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/70 sm:grid-cols-[2.25rem_2.75rem_1fr_4rem_3.5rem] ${
        isSelected ? "border-accent bg-accent/10" : "border-transparent hover:bg-surface-raised"
      }`}
    >
      <span className={`font-semibold ${statusTextClass(request.status)}`}>{request.status}</span>
      <span className="text-muted">{request.method}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        {/* Visual truncation only: the full path stays in the option's accessible
            name, and the details header shows it wrapped. */}
        <span className="truncate text-foreground/90" title={request.path}>
          {highlightMatches(request.path, query)}
        </span>
        {isCollected && (
          <span title="Collected as evidence" className="size-1.5 shrink-0 rounded-full bg-success">
            <span className="sr-only">Collected as evidence</span>
          </span>
        )}
      </span>
      <span className="hidden text-subtle sm:inline">{request.type}</span>
      <span className="text-right text-subtle">{request.durationMs} ms</span>
    </li>
  );
}
