import { CollapseIcon, ExpandIcon } from "./icons";

/** Expand/restore state handed to a panel that shares the xl right column. */
export interface PanelLayoutState {
  expanded: boolean;
  collapsed: boolean;
  onToggle: () => void;
}

interface PanelExpandToggleProps {
  /** Panel name used in the accessible label, e.g. "Diagnosis". */
  panelLabel: string;
  /** Whether this panel currently fills the shared column. */
  expanded: boolean;
  /** Id of the panel body this toggle shows or enlarges. */
  controls: string;
  onToggle: () => void;
}

// Toggle button with a fixed accessible name; aria-pressed carries the state.
// Only rendered in the three-column (xl) layout, where panels share a column.
export function PanelExpandToggle({
  panelLabel,
  expanded,
  controls,
  onToggle,
}: PanelExpandToggleProps) {
  return (
    <button
      type="button"
      aria-label={`Expand ${panelLabel}`}
      aria-pressed={expanded}
      aria-controls={controls}
      title={expanded ? "Restore split view" : `Expand ${panelLabel}`}
      onClick={onToggle}
      className="hidden size-6 items-center justify-center rounded text-subtle hover:bg-surface hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent xl:inline-flex"
    >
      {expanded ? <CollapseIcon width={13} height={13} /> : <ExpandIcon width={13} height={13} />}
    </button>
  );
}
