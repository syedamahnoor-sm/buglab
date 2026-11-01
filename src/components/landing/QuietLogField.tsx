import type { CSSProperties } from "react";
import { heroLogLines } from "@/data/landing-hero";
import { styles } from "./styles";

const columns = [
  { offset: 4, drift: "220s", className: "" },
  { offset: 15, drift: "260s", className: "hidden md:block" },
];

/*
 * The hero's drifting logs, calmed down for the close: fewer columns, much
 * slower, fainter, and no flares. The noise is still there; nothing in it is
 * shouting any more.
 */
export function QuietLogField() {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${styles.quietField}`}>
      <div className="grid h-full grid-cols-1 gap-16 px-6 md:grid-cols-2">
        {columns.map((column) => {
          const lines = [...heroLogLines.slice(column.offset), ...heroLogLines.slice(0, column.offset)];
          return (
            <div key={column.offset} className={`overflow-hidden ${column.className}`}>
              <div
                className={`font-mono text-[11px] leading-7 whitespace-nowrap text-subtle/10 md:text-subtle/15 ${styles.logTrack}`}
                style={{ "--drift": column.drift } as CSSProperties}
              >
                {[0, 1, 2, 3].flatMap((copy) =>
                  lines.map((line, index) => <p key={`${copy}-${index}`}>{line}</p>),
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
