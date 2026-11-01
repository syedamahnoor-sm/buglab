import { styles } from "./styles";

/*
 * One segment of the trace that runs down the page, between two sections.
 * It draws itself as it scrolls into view (where supported) and ends in a
 * node just above the next section's heading.
 */
export function TraceConnector({ height = "h-20 sm:h-28" }: { height?: string }) {
  return (
    <div aria-hidden="true" className={`relative mx-auto mb-7 w-px ${height}`}>
      <div className="absolute inset-0 overflow-hidden">
        <div className={`absolute inset-0 opacity-70 ${styles.trace}`} />
        <div className={`absolute inset-x-0 top-0 h-10 ${styles.tracePulse}`} />
      </div>
      <span
        className={`absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-accent ${styles.traceNode}`}
      />
    </div>
  );
}
