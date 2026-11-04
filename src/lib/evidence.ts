import type { EvidenceRef, NetworkRequest } from "@/types/investigation";
import type { LogEntry } from "@/types/workspace";

/** Stable, unique ID per source, e.g. "log:log-06" or "network:req-04". */
export function getEvidenceId(ref: EvidenceRef): string {
  return ref.kind === "log" ? `log:${ref.logId}` : `network:${ref.requestId}`;
}

export interface EvidenceSummary {
  id: string;
  ref: EvidenceRef;
  kindLabel: "Log" | "Network";
  title: string;
  detail: string;
}

export interface EvidenceSources {
  logsById: ReadonlyMap<string, LogEntry>;
  requestsById: ReadonlyMap<string, NetworkRequest>;
}

export function describeEvidence(ref: EvidenceRef, sources: EvidenceSources): EvidenceSummary {
  const id = getEvidenceId(ref);

  if (ref.kind === "log") {
    const entry = sources.logsById.get(ref.logId);
    return {
      id,
      ref,
      kindLabel: "Log",
      title: entry ? `${entry.level} [${entry.source}] ${entry.message}` : ref.logId,
      detail: entry ? `${entry.timestamp} · ${ref.logId}` : "Unknown log entry",
    };
  }

  const request = sources.requestsById.get(ref.requestId);
  return {
    id,
    ref,
    kindLabel: "Network",
    title: request ? `${request.method} ${request.path} → ${request.status}` : ref.requestId,
    detail: request ? `${request.timestamp} · ${ref.requestId}` : "Unknown request",
  };
}
