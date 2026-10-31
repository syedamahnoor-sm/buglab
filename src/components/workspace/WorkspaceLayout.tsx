import type { ReactNode } from "react";

interface WorkspaceLayoutProps {
  explorer: ReactNode;
  editor: ReactNode;
  investigation: ReactNode;
  diagnosis: ReactNode;
}

/*
 * Responsive panel grid:
 * - mobile: single column, panels stacked
 * - md:     explorer and editor full width, console + diagnosis side by side
 * - lg:     explorer | editor | (console over diagnosis)
 */
export function WorkspaceLayout({
  explorer,
  editor,
  investigation,
  diagnosis,
}: WorkspaceLayoutProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:h-[calc(100dvh-3.5rem-2rem)] lg:min-h-[720px] lg:grid-cols-[15rem_minmax(0,1fr)_minmax(20rem,26rem)]">
      <div className="flex max-h-72 min-w-0 flex-col md:col-span-2 lg:col-span-1 lg:max-h-none">
        {explorer}
      </div>
      <div className="flex min-h-[420px] min-w-0 flex-col md:col-span-2 lg:col-span-1 lg:min-h-0">
        {editor}
      </div>
      <div className="contents lg:flex lg:min-h-0 lg:min-w-0 lg:flex-col lg:gap-3">
        <div className="flex min-h-[480px] min-w-0 flex-col lg:min-h-0 lg:flex-1">
          {investigation}
        </div>
        <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">{diagnosis}</div>
      </div>
    </div>
  );
}
