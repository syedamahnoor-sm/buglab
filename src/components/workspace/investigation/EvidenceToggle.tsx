interface EvidenceToggleProps {
  collected: boolean;
  onAdd: () => void;
  onRemove: () => void;
}

// Two distinct buttons rather than one relabelled toggle, so the accessible
// name always matches the visible text.
export function EvidenceToggle({ collected, onAdd, onRemove }: EvidenceToggleProps) {
  if (collected) {
    return (
      <div className="flex items-center gap-2">
        <span role="status" className="text-xs font-medium text-success">
          ✓ Collected
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="h-7 rounded-md border border-border px-2 text-xs text-muted hover:border-border-strong hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Remove from evidence
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onAdd}
      className="h-7 rounded-md border border-accent/40 bg-accent/10 px-2.5 text-xs font-medium text-accent hover:bg-accent/20 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
    >
      + Add to evidence
    </button>
  );
}
