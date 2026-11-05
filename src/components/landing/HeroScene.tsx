import type { CSSProperties, ReactNode } from "react";
import { heroScene } from "@/data/landing-hero";
import { styles } from "./styles";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/*
 * Timeline of the scene, in milliseconds after load. Panels slide in from
 * the right, requests and log lines arrive one by one, a scan sweeps the log,
 * the failed request flares, then the inspector opens on it.
 */
const T = {
  tracePanel: 250,
  terminalPanel: 420,
  bars: 700,
  lines: 820,
  scan: 1950,
  signal: 3000,
  inspectorPanel: 3150,
  inspectorRows: 3600,
  pinned: 4300,
};

// Entrance from the right. Pure CSS (@starting-style), skipped for reduced
// motion and on small screens, where the scene is a single quiet panel.
const enterRight =
  "motion-safe:sm:transition-[opacity,translate] motion-safe:sm:duration-1000 motion-safe:sm:ease-[cubic-bezier(.2,.8,.2,1)] motion-safe:sm:starting:translate-x-12 motion-safe:sm:starting:opacity-0";

const delay = (ms: number): Vars => ({ "--appear-delay": `${ms}ms`, transitionDelay: `${ms}ms` });

function Layer({
  depth,
  enterAt,
  className,
  children,
}: {
  depth: number;
  enterAt: number;
  className: string;
  children: ReactNode;
}) {
  // Outer element parts on scroll (depth), inner one handles the entrance.
  return (
    <div className={`${styles.depth} ${className}`} style={{ "--depth": depth } as Vars}>
      <div
        className={`overflow-hidden rounded-xl border border-border-strong bg-surface/95 shadow-[0_24px_60px_-20px_color-mix(in_oklab,var(--color-ink)_85%,transparent)] backdrop-blur ${enterRight}`}
        style={{ transitionDelay: `${enterAt}ms` }}
      >
        {children}
      </div>
    </div>
  );
}

function PanelBar({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border bg-surface-raised px-3 py-2">
      <span className="size-2 rounded-full bg-border-strong" />
      <span className="size-2 rounded-full bg-border-strong" />
      <span className="ml-2 truncate font-mono text-[11px] text-subtle">{title}</span>
      {aside && <span className="ml-auto shrink-0">{aside}</span>}
    </div>
  );
}

const statusClass = (status: number) => (status >= 400 ? "text-danger" : "text-success");

const levelClasses: Record<string, string> = {
  INFO: "text-info",
  WARN: "text-warning",
  ERROR: "text-danger",
};

/*
 * Decorative (aria-hidden): the hero's text carries the message. Shows only
 * the public symptom, as in the Incident Replay.
 */
export function HeroScene() {
  const { trace, terminal, inspector } = heroScene;

  return (
    <div
      aria-hidden="true"
      className={`${styles.scene} font-mono text-[11px] leading-5 sm:h-[31rem] lg:h-[33rem] lg:[transform:perspective(1800px)_rotateY(-9deg)_rotateX(2deg)] xl:-mr-20`}
    >
      {/* Back: request waterfall */}
      <Layer depth={1} enterAt={T.tracePanel} className="absolute right-0 top-0 hidden w-[80%] sm:block">
        <PanelBar title={trace.title} />
        <ul className="space-y-1 px-3 py-2.5">
          {trace.rows.map((row, index) => (
            <li key={row.path} className="relative grid grid-cols-[2.25rem_8.5rem_minmax(0,1fr)] items-center gap-2 py-0.5">
              {"signal" in row && (
                <span className={`absolute -inset-x-2 inset-y-0 rounded ${styles.signal}`} style={delay(T.signal)} />
              )}
              <span className={`relative ${statusClass(row.status)}`}>{row.status}</span>
              <span className="relative truncate text-foreground/80">
                <span className="text-subtle">{row.method}</span> {row.path}
              </span>
              <span className="relative h-2 rounded-sm bg-surface-sunken">
                <span
                  className={`absolute inset-y-0 rounded-sm ${styles.grow} ${
                    row.status >= 400 ? "bg-danger/70" : "bg-accent/60"
                  }`}
                  style={{ left: `${row.start}%`, width: `${row.width}%`, ...delay(T.bars + index * 160) }}
                />
              </span>
            </li>
          ))}
        </ul>
      </Layer>

      {/* Middle: the live log */}
      <Layer
        depth={2}
        enterAt={T.terminalPanel}
        className="relative w-full sm:absolute sm:left-0 sm:top-[39%] sm:w-[86%]"
      >
        <PanelBar
          title={terminal.title}
          aside={
            <span className={`text-[10px] uppercase tracking-wider text-accent ${styles.appear}`} style={delay(T.signal)}>
              ● Signal
            </span>
          }
        />
        <div className="relative overflow-hidden bg-surface-sunken/80 px-3 py-2.5">
          <span className={`pointer-events-none absolute inset-x-0 top-0 h-1/4 ${styles.scan}`} style={delay(T.scan)} />
          <ul>
            {terminal.lines.map((line, index) => (
              <li
                key={line.time}
                className={`relative grid grid-cols-[auto_2.75rem_minmax(0,1fr)] gap-x-2.5 ${styles.appear}`}
                style={delay(T.lines + index * 170)}
              >
                {"signal" in line && (
                  <span className={`absolute -inset-x-3 inset-y-0 ${styles.signal}`} style={delay(T.signal)} />
                )}
                <span className="relative text-subtle">{line.time}</span>
                <span className={`relative font-semibold ${levelClasses[line.level]}`}>{line.level}</span>
                <span className="relative truncate text-foreground/85">{line.text}</span>
              </li>
            ))}
          </ul>
          <span className={`mt-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-accent/70 ${styles.caret}`} />
        </div>
      </Layer>

      {/* Front: the failed request, opened and pinned */}
      <Layer depth={3} enterAt={T.inspectorPanel} className="absolute bottom-0 right-[3%] hidden w-[54%] sm:block">
        <div className="border-b border-border bg-surface-raised px-3 py-2">
          <p className="truncate text-foreground">
            <span className="text-subtle">{inspector.method}</span> {inspector.path}
          </p>
          <p className="text-danger">{inspector.status}</p>
        </div>
        <dl className="px-3 py-2">
          {inspector.rows.map(([label, value], index) => (
            <div
              key={label}
              className={`grid grid-cols-[6rem_minmax(0,1fr)] ${styles.appear}`}
              style={delay(T.inspectorRows + index * 120)}
            >
              <dt className="text-subtle">{label}</dt>
              <dd className="text-foreground/85">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="px-3 pb-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded border border-success/40 bg-success/10 px-2 py-0.5 text-success ${styles.appear}`}
            style={delay(T.pinned)}
          >
            ✓ {inspector.pinned}
          </span>
        </div>
      </Layer>
    </div>
  );
}
