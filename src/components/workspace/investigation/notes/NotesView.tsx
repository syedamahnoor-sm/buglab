import type { EvidenceSummary } from "@/lib/evidence";
import type { EvidenceItem, EvidenceRef } from "@/types/investigation";
import type { InvestigationController } from "../useInvestigationController";
import { EvidenceList } from "./EvidenceList";
import { HypothesisList } from "./HypothesisList";
import { ObservationList } from "./ObservationList";

interface NotesViewProps {
  investigation: InvestigationController;
  evidenceItems: { item: EvidenceItem; summary: EvidenceSummary }[];
  onShowSource: (ref: EvidenceRef) => void;
}

export function NotesView({ investigation, evidenceItems, onShowSource }: NotesViewProps) {
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3">
      <p className="rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-xs text-warning/90">
        Notes and evidence are temporary. They are kept in this tab only and reset when you
        refresh the page.
      </p>
      <HypothesisList
        hypotheses={investigation.hypotheses}
        onAdd={investigation.addHypothesis}
        onSetStatus={investigation.setHypothesisStatus}
        onRemove={investigation.removeHypothesis}
      />
      <ObservationList
        observations={investigation.observations}
        onAdd={investigation.addObservation}
        onRemove={investigation.removeObservation}
      />
      <EvidenceList
        items={evidenceItems}
        onSetNote={investigation.setEvidenceNote}
        onRemove={investigation.removeEvidence}
        onShowSource={onShowSource}
      />
    </div>
  );
}
