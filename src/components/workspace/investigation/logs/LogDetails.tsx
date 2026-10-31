import type { LogEntry } from "@/types/workspace";
import { DetailHeader } from "../DetailHeader";
import { EvidenceToggle } from "../EvidenceToggle";
import { levelTextClasses } from "./LogRow";

interface LogDetailsProps {
  entry: LogEntry;
  incidentDate: string;
  relatedRequestId?: string;
  collected: boolean;
  onAddEvidence: () => void;
  onRemoveEvidence: () => void;
  onShowRequest: (requestId: string) => void;
  onClose: () => void;
}

function parseFields(message: string) {
  return [...message.matchAll(/(\w[\w.]*)=(\S+)/g)].map(([, key, value]) => ({ key, value }));
}

export function LogDetails({
  entry,
  incidentDate,
  relatedRequestId,
  collected,
  onAddEvidence,
  onRemoveEvidence,
  onShowRequest,
  onClose,
}: LogDetailsProps) {
  const fields = parseFields(entry.message);

  return (
    <section aria-label={`Log entry ${entry.id}`} className="flex min-h-0 flex-col">
      <DetailHeader
        title={`Log entry · ${entry.id}`}
        closeLabel="Close log details"
        onClose={onClose}
        actions={
          <EvidenceToggle
            collected={collected}
            onAdd={onAddEvidence}
            onRemove={onRemoveEvidence}
          />
        }
      />
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 overflow-auto px-3 py-2.5 font-mono text-xs">
        <dt className="text-subtle">Time</dt>
        <dd className="text-foreground/90">
          {incidentDate}T{entry.timestamp}Z
        </dd>
        <dt className="text-subtle">Level</dt>
        <dd className={`font-semibold ${levelTextClasses[entry.level]}`}>{entry.level}</dd>
        <dt className="text-subtle">Source</dt>
        <dd className="text-foreground/90">{entry.source}</dd>
        <dt className="text-subtle">Message</dt>
        <dd className="break-words text-foreground/90">{entry.message}</dd>
        {fields.map((field) => (
          <div key={field.key} className="contents">
            <dt className="text-subtle">{field.key}</dt>
            <dd className="break-all text-accent">{field.value}</dd>
          </div>
        ))}
        {relatedRequestId && (
          <>
            <dt className="text-subtle">Request</dt>
            <dd>
              <button
                type="button"
                onClick={() => onShowRequest(relatedRequestId)}
                className="text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              >
                View in Network ({relatedRequestId})
              </button>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
