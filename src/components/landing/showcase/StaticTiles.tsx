import type { CSSProperties } from "react";
import { LockIcon } from "@/components/ui/icons";
import { sampleNotes, showcase } from "@/data/landing";
import { styles } from "../styles";
import { Reveal } from "../Reveal";
import { ShowcaseTile } from "./ShowcaseTile";

// Server-rendered callouts: their motion is CSS only.

const noteTones: Record<string, string> = {
  Observation: "border-warning/30 text-warning",
  Hypothesis: "border-info/30 text-info",
  Evidence: "border-success/30 text-success",
};

export function NotesTile() {
  return (
    <ShowcaseTile content={showcase.notes} variant="callout">
      <ul className="space-y-2">
        {sampleNotes.map((note, index) => (
          <li key={note.text}>
            <Reveal delay={150 + index * 110}>
              <div className="flex items-start gap-2 rounded-md border border-border bg-surface-sunken px-2.5 py-2 text-xs">
                <span
                  className={`shrink-0 rounded border px-1.5 text-[10px] font-medium uppercase tracking-wide ${noteTones[note.kind]}`}
                >
                  {note.kind}
                </span>
                <span className="min-w-0 text-foreground/85 wrap-anywhere">{note.text}</span>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </ShowcaseTile>
  );
}

// Browser → server → browser. The packets travel along the wire; the answer
// key stays behind the lock.
export function ServerCheckTile() {
  return (
    <ShowcaseTile content={showcase.server} variant="callout">
      <div
        role="img"
        aria-label="Your browser sends a diagnosis with evidence to the server; the server, which holds the answer, sends back feedback."
        className="mt-auto grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 font-mono text-[11px]"
      >
        <span className="rounded-md border border-border-strong bg-surface-sunken px-2.5 py-2 text-muted">Browser</span>
        <div aria-hidden="true" className="relative space-y-3">
          {[
            { label: "diagnosis →", className: "" },
            { label: "← feedback", className: styles.packetBack },
          ].map((wire) => (
            <div key={wire.label}>
              <p className="text-center text-[10px] text-subtle">{wire.label}</p>
              <div className="relative mt-1 h-px bg-border-strong">
                <div
                  className={`absolute inset-0 ${styles.packet} ${wire.className}`}
                  style={{ "--travel": "100%" } as CSSProperties}
                >
                  <span className="absolute -top-[3px] left-0 size-[7px] -translate-x-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <span className="flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-2 text-accent">
          <LockIcon width={12} height={12} />
          Server
        </span>
      </div>
    </ShowcaseTile>
  );
}

const keys = ["↑", "↓", "Tab", "Enter"];

// The keycaps light up in sequence when the tile is hovered.
export function KeyboardTile() {
  return (
    <ShowcaseTile content={showcase.keyboard} variant="callout">
      <div aria-hidden="true" className="mt-auto flex flex-wrap gap-2 font-mono text-xs">
        {keys.map((key, index) => (
          <kbd
            key={key}
            className={`min-w-9 rounded-md border border-border-strong bg-surface-sunken px-2.5 py-1.5 text-center text-muted shadow-[0_2px_0_var(--border)] ${styles.key}`}
            style={{ "--key-delay": `${index * 120}ms` } as CSSProperties}
          >
            {key}
          </kbd>
        ))}
      </div>
    </ShowcaseTile>
  );
}
