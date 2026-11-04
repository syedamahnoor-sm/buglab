import { styles } from "./styles";

/*
 * The trace leaves the bottom of the dossier and drops into the handoff panel
 * below. Same 12-column grid as CaseFile and ClosingCta (lg), so the line
 * sits 2.5rem inside the right-hand column in all three. Draws itself as it
 * scrolls into view, where supported.
 */
export function CaseBridge() {
  return (
    <div aria-hidden="true" className="mx-auto grid max-w-7xl px-4 sm:px-6 lg:grid-cols-12 lg:gap-x-12">
      <div className="relative h-24 sm:h-28 lg:col-span-7 lg:col-start-6 lg:h-32">
        <div className="absolute inset-y-0 left-10 w-px overflow-hidden">
          <div className={`absolute inset-0 opacity-70 ${styles.trace}`} />
          <div className={`absolute inset-x-0 top-0 h-10 ${styles.tracePulse}`} />
        </div>
        <p className="absolute left-14 top-1/2 -translate-y-1/2 font-mono text-[11px] text-subtle">
          <span className="text-accent">→</span> handoff
        </p>
      </div>
    </div>
  );
}
