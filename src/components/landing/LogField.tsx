import type { CSSProperties } from "react";
import { heroLogLines } from "@/data/landing-hero";
import { styles } from "./styles";

// Behind the split hero: the mask keeps the copy on the left clear, and the
// scene's panels sit over the right-hand columns.
const columns = [
  { offset: 0, drift: "120s", className: "" },
  { offset: 12, drift: "100s", className: "hidden sm:block" },
  { offset: 6, drift: "140s", className: "hidden lg:block" },
];

// Rotates the list so each column starts on a different line.
function rotate<T>(items: readonly T[], by: number) {
  return [...items.slice(by), ...items.slice(0, by)];
}

/*
 * The hero's background texture: the incident's own log lines drifting
 * slowly upward. Each column holds its lines four times and moves by half
 * its height, so the loop is seamless. The 401s flare now and then.
 */
export function LogField() {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${styles.logField}`}>
      <div
        className={`grid h-full grid-cols-1 gap-12 px-6 sm:grid-cols-2 lg:grid-cols-3 ${styles.logFieldInner}`}
      >
        {columns.map((column, columnIndex) => {
          const lines = rotate(heroLogLines, column.offset);
          return (
            <div
              key={columnIndex}
              className={`overflow-hidden ${column.className}`}
            >
              <div
                className={`font-mono text-[11px] leading-6 whitespace-nowrap text-subtle/25 sm:text-subtle/30 ${styles.logTrack}`}
                style={{ "--drift": column.drift } as CSSProperties}
              >
                {[0, 1, 2, 3].flatMap((copy) =>
                  lines.map((line, index) => {
                    const flares = line.includes(" 401 ");
                    return (
                      <p
                        key={`${copy}-${index}`}
                        className={`${styles.logLine} ${flares ? styles.flare : ""}`}
                        style={
                          flares
                            ? ({ "--flare-delay": `${(index * 1.7 + columnIndex * 3.3) % 11}s` } as CSSProperties)
                            : undefined
                        }
                      >
                        {line}
                      </p>
                    );
                  }),
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
