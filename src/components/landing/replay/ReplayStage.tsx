import type { CSSProperties, ReactNode } from "react";
import { replay, type ReplayChapter } from "@/data/landing";
import { styles } from "../styles";
import type { StageMode } from "./replay-reducer";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const MS_PER_CHAR = 22;

function Typed({ text, delay }: { text: string; delay: number }) {
  if (!text) return <span>&nbsp;</span>;
  const style: Vars = {
    "--chars": text.length,
    "--type-duration": `${text.length * MS_PER_CHAR}ms`,
    "--type-delay": `${delay}ms`,
  };
  return (
    <span className={styles.typed} style={style}>
      {text}
    </span>
  );
}

/** Wraps children in an animation class only while its chapter is the one playing. */
function Animated({
  when,
  className,
  delay,
  children,
  base = "",
}: {
  when: boolean;
  className: string;
  delay?: number;
  children?: ReactNode;
  base?: string;
}) {
  const style: Vars | undefined = when && delay !== undefined ? { "--appear-delay": `${delay}ms` } : undefined;
  return (
    <div className={`${base} ${when ? className : ""}`} style={style}>
      {children}
    </div>
  );
}

// Per-line typing delays for the incident report, one line after another.
const incidentDelays = replay.incident.reduce<number[]>((delays, line, index) => {
  const previous = index === 0 ? 250 : delays[index - 1] + replay.incident[index - 1].length * MS_PER_CHAR + 90;
  return [...delays, previous];
}, []);

const levelClasses: Record<string, string> = {
  INFO: "text-info",
  WARN: "text-warning",
  ERROR: "text-danger",
};

interface ReplayStageProps {
  chapter: ReplayChapter["id"];
  mode: StageMode;
  /**
   * "responsive" follows the viewport (the tabbed replay); "panel" is the
   * pinned desktop replay's editor and console, with no explorer.
   */
  layout?: "responsive" | "panel";
}

const layouts = {
  responsive: {
    root: "h-[25rem] sm:h-[27rem] sm:text-xs md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.15fr)]",
    explorer: "hidden lg:block",
    editor: (reading: boolean) => `${reading ? "block" : "hidden"} md:block`,
    console: (reading: boolean) => `${reading ? "hidden" : "block"} md:block`,
  },
  // Below md it is only ever seen without JavaScript: one column, as above.
  panel: {
    root: "h-[25rem] sm:h-[27rem] md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:text-xs",
    explorer: "hidden",
    editor: (reading: boolean) => `${reading ? "block" : "hidden"} md:block`,
    console: (reading: boolean) => `${reading ? "hidden" : "block"} md:block`,
  },
};

/*
 * The replay's picture: a miniature workspace in plain HTML and CSS. Each
 * chapter animates only its own step; earlier steps are shown finished, so
 * every chapter also reads correctly as a still frame (before the replay
 * starts, when a chapter is picked, and for reduced motion).
 */
const ORDER: ReplayChapter["id"][] = ["read", "search", "inspect", "collect", "diagnose"];

export function ReplayStage({ chapter, mode, layout = "responsive" }: ReplayStageProps) {
  const classes = layouts[layout];
  const is = (id: ReplayChapter["id"]) => chapter === id;
  // True once the replay has reached a chapter: its result stays on screen.
  const after = (id: ReplayChapter["id"]) => ORDER.indexOf(chapter) >= ORDER.indexOf(id);

  const filtered = after("search");
  const inspecting = after("inspect");
  const collected = after("collect");

  return (
    <div
      aria-hidden="true"
      data-static={mode === "static" ? "" : undefined}
      data-paused={mode === "frozen" ? "" : undefined}
      className={`${styles.stage} relative grid overflow-hidden font-mono text-[11px] leading-5 ${classes.root}`}
    >
      {/* Explorer */}
      <div className={`${classes.explorer} border-r border-border bg-surface`}>
        <p className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">
          Explorer
        </p>
        <ul className="space-y-px px-1.5 py-2 text-muted">
          {replay.files.map((file) => (
            <li
              key={file.name}
              style={{ paddingLeft: `${0.5 + file.depth * 0.75}rem` }}
              className={`truncate rounded py-px ${
                file.name === "INCIDENT.md" ? "bg-accent/10 text-foreground" : ""
              } ${"folder" in file ? "text-subtle" : ""}`}
            >
              {"folder" in file ? `▾ ${file.name}` : file.name}
            </li>
          ))}
        </ul>
      </div>

      {/* Editor */}
      <div className={`${classes.editor(is("read"))} min-w-0 border-r border-border bg-surface-sunken`}>
        <div className="flex border-b border-border bg-surface">
          <span className="border-r border-t-2 border-r-border border-t-accent bg-surface-sunken px-3 py-1.5 text-foreground">
            INCIDENT.md
          </span>
        </div>
        <ol className="overflow-hidden px-3 py-2">
          {replay.incident.map((line, index) => (
            <li key={index} className="flex gap-3 whitespace-pre">
              <span className="w-4 shrink-0 text-right text-subtle">{index + 1}</span>
              <span className={line.startsWith("#") ? "text-accent" : "text-foreground/85"}>
                {is("read") ? <Typed text={line} delay={incidentDelays[index]} /> : line || " "}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Investigation console */}
      <div className={`${classes.console(is("read"))} relative min-w-0 bg-surface`}>
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground">Logs</span>
          <span className="flex items-center gap-1.5 text-subtle">
            Evidence
            <span className="relative inline-grid min-w-4 place-items-center rounded bg-surface-raised px-1 text-foreground">
              {is("collect") ? (
                <>
                  <span className={`col-start-1 row-start-1 ${styles.vanish}`} style={{ "--appear-delay": "950ms" } as Vars}>
                    0
                  </span>
                  <span className={`col-start-1 row-start-1 text-success ${styles.appear}`} style={{ "--appear-delay": "1000ms" } as Vars}>
                    {replay.evidence.length}
                  </span>
                </>
              ) : collected ? (
                <span className="text-success">{replay.evidence.length}</span>
              ) : (
                "0"
              )}
            </span>
          </span>
        </div>

        {/* Search box */}
        <div className="border-b border-border px-3 py-1.5">
          <div className="flex h-6 items-center gap-2 rounded border border-border bg-surface-sunken px-2">
            <span className="text-subtle">⌕</span>
            {is("search") ? (
              <span className="text-foreground">
                <Typed text={replay.search} delay={450} />
                <span className={`ml-px inline-block h-3 w-px translate-y-0.5 bg-accent ${styles.caret}`} />
              </span>
            ) : filtered ? (
              <span className="text-foreground">{replay.search}</span>
            ) : (
              <span className="text-subtle">Search logs</span>
            )}
          </div>
        </div>

        {/* Log rows */}
        <ul className="py-1">
          {replay.logs.map((log) => {
            const matches = log.message.includes(replay.search);
            const selected = "selected" in log && inspecting;
            const dimmed = filtered && !matches;
            return (
              <li key={log.time} className="relative">
                {/* Match highlight */}
                {filtered && matches && (
                  <Animated
                    when={is("search")}
                    className={styles.appear}
                    delay={1250}
                    base={`absolute inset-y-0 left-0 right-0 border-l-2 ${
                      selected ? "border-accent bg-accent/15" : "border-danger/70 bg-danger/[0.07]"
                    }`}
                  />
                )}
                <Animated
                  when={is("search") && dimmed}
                  className={styles.dim}
                  base={`relative grid grid-cols-[auto_2.75rem_minmax(0,1fr)] gap-x-2.5 px-3 py-px ${
                    dimmed && !is("search") ? "opacity-[0.22]" : ""
                  }`}
                >
                  <span className="text-subtle">{log.time}</span>
                  <span className={`font-semibold ${levelClasses[log.level]}`}>{log.level}</span>
                  <span className="truncate text-foreground/85">{log.message}</span>
                </Animated>
              </li>
            );
          })}
        </ul>

        {/* Request details drawer */}
        {inspecting && (
          <Animated
            when={is("inspect")}
            className={styles.slideIn}
            delay={450}
            base="absolute inset-x-0 bottom-0 h-[52%] border-t border-border-strong bg-surface-raised shadow-[0_-12px_30px_-12px_rgb(0_0_0/0.6)]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
              <span className="truncate text-foreground">
                <span className="text-danger">401</span> {replay.request.title}
              </span>
              <span
                className={`relative inline-grid shrink-0 rounded border px-2 py-px ${
                  collected && !is("collect")
                    ? "border-success/45 bg-success/[0.14] text-success"
                    : "border-accent/40 text-accent"
                } ${is("collect") ? styles.press : ""}`}
                style={is("collect") ? ({ "--appear-delay": "600ms" } as Vars) : undefined}
              >
                {is("collect") ? (
                  <>
                    <span className={`col-start-1 row-start-1 ${styles.vanish}`} style={{ "--appear-delay": "800ms" } as Vars}>
                      + Add to evidence
                    </span>
                    <span className={`col-start-1 row-start-1 ${styles.appear}`} style={{ "--appear-delay": "850ms" } as Vars}>
                      ✓ In evidence
                    </span>
                  </>
                ) : collected ? (
                  "✓ In evidence"
                ) : (
                  "+ Add to evidence"
                )}
              </span>
            </div>
            <dl className="px-3 py-2">
              {[["Status", replay.request.status], ...replay.request.rows].map(([label, value], index) => (
                <Animated
                  key={label}
                  when={is("inspect")}
                  className={styles.appear}
                  delay={900 + index * 110}
                  base="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3"
                >
                  <dt className="text-subtle">{label}</dt>
                  <dd className={`truncate ${label === "Status" ? "text-danger" : "text-foreground/85"}`}>
                    {value}
                  </dd>
                </Animated>
              ))}
            </dl>
          </Animated>
        )}

        {/* Observation note */}
        {collected && (
          <Animated
            when={is("collect")}
            className={styles.rise}
            delay={1300}
            base="absolute right-3 top-[4.25rem] w-[15.5rem] rounded-md border border-warning/30 bg-surface-raised p-2.5 shadow-xl shadow-black/40"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-warning">Observation</p>
            <p className="mt-1 text-foreground/90">
              {replay.note.map((line, index) => (
                <span key={line} className="block whitespace-pre">
                  {is("collect") ? <Typed text={line} delay={1750 + index * (replay.note[0].length * MS_PER_CHAR + 80)} /> : line}
                </span>
              ))}
            </p>
          </Animated>
        )}
      </div>

      {/* Diagnosis: shown as an outline only. No option text exists on the page. */}
      {is("diagnose") && (
        <div className="absolute inset-0 grid place-items-center bg-background/75 p-4 backdrop-blur-[2px]">
          <Animated
            when
            className={styles.rise}
            delay={150}
            base="w-full max-w-sm rounded-lg border border-border-strong bg-surface p-4 font-sans shadow-2xl shadow-black/50"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Diagnosis</span>
              <span className="rounded border border-success/30 bg-success/10 px-1.5 font-mono text-[11px] text-success">
                {replay.evidence.length} evidence
              </span>
            </div>
            <p className="mt-3 text-[11px] text-subtle">Root cause</p>
            <ul className="mt-1.5 space-y-1.5">
              {[78, 64, 86, 58].map((width, index) => (
                <Animated
                  key={width}
                  when
                  className={styles.appear}
                  delay={450 + index * 90}
                  base="flex items-center gap-2 rounded border border-border px-2 py-1.5"
                >
                  <span className="size-3 shrink-0 rounded-full border border-border-strong" />
                  <span className="h-2 rounded-full bg-border-strong blur-[1px]" style={{ width: `${width}%` }} />
                </Animated>
              ))}
            </ul>
            <Animated when className={styles.appear} delay={1050}>
              <p className="mt-4 text-center text-sm font-medium text-accent">
                You have the evidence. What broke?
              </p>
            </Animated>
          </Animated>
        </div>
      )}
    </div>
  );
}
