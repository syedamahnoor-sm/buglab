import type { LogEntry, LogLevel } from "@/types/workspace";

const levelClasses: Record<LogLevel, string> = {
  DEBUG: "text-subtle",
  INFO: "text-info",
  WARN: "text-warning",
  ERROR: "text-danger",
};

interface LogLineProps {
  entry: LogEntry;
}

export function LogLine({ entry }: LogLineProps) {
  return (
    <li
      className={`grid grid-cols-[auto_auto_1fr] gap-x-3 px-3 py-1 sm:grid-cols-[auto_3rem_3.5rem_1fr] ${
        entry.level === "ERROR" ? "bg-danger/5" : ""
      }`}
    >
      <time className="text-subtle">{entry.timestamp}</time>
      <span className={`font-semibold ${levelClasses[entry.level]}`}>
        {entry.level}
      </span>
      <span className="hidden text-muted sm:inline">[{entry.source}]</span>
      <span className="col-span-3 break-words text-foreground/85 sm:col-span-1">
        <span className="text-muted sm:hidden">[{entry.source}] </span>
        {entry.message}
      </span>
    </li>
  );
}
