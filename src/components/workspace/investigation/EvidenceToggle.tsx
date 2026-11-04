import { useEffect, useRef, type MouseEvent } from "react";
import { triggerHadFocus } from "@/lib/focus";

interface EvidenceToggleProps {
  collected: boolean;
  onAdd: () => void;
  onRemove: () => void;
}

// Two distinct buttons rather than one relabelled toggle, so the accessible
// name always matches the visible text. Because pressing one replaces it with
// the other, focus is handed to the replacement when the pressed one had it.
export function EvidenceToggle({ collected, onAdd, onRemove }: EvidenceToggleProps) {
  const addRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const moveFocusRef = useRef(false);

  useEffect(() => {
    if (!moveFocusRef.current) return;
    moveFocusRef.current = false;
    (collected ? removeRef : addRef).current?.focus();
  }, [collected]);

  function handle(event: MouseEvent<HTMLButtonElement>, action: () => void) {
    moveFocusRef.current = triggerHadFocus(event);
    action();
  }

  if (collected) {
    return (
      <div className="flex items-center gap-2">
        <span role="status" className="text-xs font-medium text-success">
          ✓ Collected
        </span>
        <button
          ref={removeRef}
          type="button"
          onClick={(event) => handle(event, onRemove)}
          className="h-7 rounded-md border border-border px-2 text-xs text-muted hover:border-border-strong hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Remove from evidence
        </button>
      </div>
    );
  }

  return (
    <button
      ref={addRef}
      type="button"
      onClick={(event) => handle(event, onAdd)}
      className="h-7 rounded-md border border-accent/40 bg-accent/10 px-2.5 text-xs font-medium text-accent hover:bg-accent/20 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
    >
      + Add to evidence
    </button>
  );
}
