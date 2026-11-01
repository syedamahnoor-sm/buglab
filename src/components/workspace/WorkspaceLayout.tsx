import type { ReactNode } from "react";
import { SKIP_TARGETS, SkipTarget } from "@/components/layout/SkipLinks";

/** Which right-column panel fills the column in the three-column layout. */
export type RightColumnFocus = "split" | "investigation" | "diagnosis";

interface WorkspaceLayoutProps {
  explorer: ReactNode;
  editor: ReactNode;
  investigation: ReactNode;
  diagnosis: ReactNode;
  rightColumnFocus?: RightColumnFocus;
}

const TOP_ROW_HEIGHT = "lg:h-[clamp(420px,calc(100dvh-15rem),640px)] xl:h-auto";

function rightPanelFlex(panel: Exclude<RightColumnFocus, "split">, focus: RightColumnFocus) {
  return focus === "split" || focus === panel ? "xl:flex-1" : "xl:flex-none";
}

/*
 * Responsive panel grid:
 * - mobile (<md):  single column, panels stacked
 * - md (tablet):   explorer and editor full width; console | diagnosis below
 * - lg (laptop):   explorer | editor on top; console | diagnosis below
 * - xl (desktop):  explorer | editor | (console over diagnosis), viewport height
 *
 * From md to lg the console is absolutely positioned inside its cell, so the
 * bottom row takes the diagnosis form's natural height: the form never
 * scrolls inside its panel, and the console's lists scroll within that height.
 */
export function WorkspaceLayout({
  explorer,
  editor,
  investigation,
  diagnosis,
  rightColumnFocus = "split",
}: WorkspaceLayoutProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[13rem_minmax(0,1fr)] xl:h-[calc(100dvh-3.5rem-2rem)] xl:min-h-[640px] xl:grid-cols-[15rem_minmax(0,1fr)_minmax(22rem,28rem)]">
      {/* Absolutely positioned (sr-only), so it takes no grid cell. */}
      <SkipTarget id={SKIP_TARGETS.workspace} label="Debugging workspace" />
      <div
        className={`flex max-h-72 min-w-0 flex-col md:col-span-2 lg:col-span-1 lg:max-h-none ${TOP_ROW_HEIGHT} xl:min-h-0`}
      >
        {explorer}
      </div>
      <div
        className={`flex min-h-[420px] min-w-0 flex-col md:col-span-2 lg:col-span-1 ${TOP_ROW_HEIGHT} xl:min-h-0`}
      >
        {editor}
      </div>
      <div className="flex min-w-0 flex-col gap-3 md:col-span-2 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:col-span-1 xl:flex xl:min-h-0 xl:flex-col">
        <div
          className={`relative flex min-h-[480px] min-w-0 flex-col md:min-h-[520px] xl:min-h-0 ${rightPanelFlex("investigation", rightColumnFocus)}`}
        >
          <div className="flex min-h-0 flex-1 flex-col md:absolute md:inset-0 xl:static">
            {investigation}
          </div>
        </div>
        <div
          className={`flex min-w-0 flex-col xl:min-h-0 ${rightPanelFlex("diagnosis", rightColumnFocus)}`}
        >
          <SkipTarget id={SKIP_TARGETS.diagnosis} label="Diagnosis" />
          {diagnosis}
        </div>
      </div>
    </div>
  );
}
