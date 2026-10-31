import type { ReactNode } from "react";
import { CloseIcon } from "@/components/ui/icons";

interface DetailHeaderProps {
  title: ReactNode;
  closeLabel: string;
  onClose: () => void;
  actions?: ReactNode;
}

export function DetailHeader({ title, closeLabel, onClose, actions }: DetailHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-1.5">
      <h3 className="min-w-0 truncate font-mono text-xs text-foreground">{title}</h3>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded text-subtle hover:bg-surface-raised hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          <CloseIcon width={12} height={12} />
        </button>
      </div>
    </div>
  );
}
