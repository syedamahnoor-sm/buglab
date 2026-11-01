import { styles } from "./styles";

/*
 * Where the method's axis ends (its right edge, from lg) the trace turns
 * down into the workspace, whose heading sits on the right to meet it. Below
 * lg it continues the vertical path on the left. Draws itself as it scrolls
 * into view, where supported.
 */
export function MethodBridge() {
  return (
    <div aria-hidden="true" className="mx-auto mb-7 max-w-7xl px-4 sm:px-6">
      <div className="relative h-28 lg:h-36">
        <div className="absolute inset-y-0 left-[3px] w-px overflow-hidden lg:left-auto lg:right-0 lg:translate-x-1/2">
          <div className={`absolute inset-0 opacity-70 ${styles.trace}`} />
          <div className={`absolute inset-x-0 top-0 h-10 ${styles.tracePulse}`} />
        </div>
        <span
          className={`absolute -bottom-1 left-0 size-[7px] rounded-full bg-accent lg:left-auto lg:right-0 lg:translate-x-1/2 ${styles.traceNode}`}
        />
        <p className="absolute left-6 top-1/2 -translate-y-1/2 font-mono text-[11px] text-subtle lg:left-auto lg:right-6 lg:text-right">
          <span className="text-accent">→</span> into the workspace
        </p>
      </div>
    </div>
  );
}
