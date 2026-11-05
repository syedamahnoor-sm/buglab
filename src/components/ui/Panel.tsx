import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Id for the body, so an expand/restore toggle can reference it. */
  bodyId?: string;
  /**
   * Collapse to the title bar. Only applies in the three-column (xl) layout,
   * where panels share a column; smaller layouts always show the body.
   */
  collapsed?: boolean;
}

export function Panel({
  title,
  icon,
  actions,
  footer,
  children,
  className = "",
  bodyClassName = "",
  bodyId,
  collapsed = false,
}: PanelProps) {
  const collapsedClass = collapsed ? "xl:hidden" : "";

  return (
    <section
      aria-label={title}
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface ${className}`}
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-raised px-3">
        <h2 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {icon && <span className="text-subtle">{icon}</span>}
          <span className="truncate">{title}</span>
        </h2>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </header>
      <div id={bodyId} className={`min-h-0 flex-1 overflow-auto ${bodyClassName} ${collapsedClass}`}>
        {children}
      </div>
      {footer && (
        <footer
          className={`shrink-0 border-t border-border bg-surface-raised px-3 py-1.5 text-xs text-subtle ${collapsedClass}`}
        >
          {footer}
        </footer>
      )}
    </section>
  );
}
