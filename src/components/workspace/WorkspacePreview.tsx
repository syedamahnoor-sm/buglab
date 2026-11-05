import type { ReactNode } from "react";
import { BugIcon, ClipboardIcon, CodeIcon, FileIcon, FolderIcon, LockIcon, TerminalIcon } from "@/components/ui/icons";

/*
 * A static, illustrative preview of the debugging workspace for the workspace
 * overview page. It reuses the real workspace's anatomy (pane headers, explorer,
 * read-only editor, investigation console, diagnosis) with a made-up sample
 * incident that belongs to no challenge, so it reveals nothing about any case.
 *
 * It is a picture, not a tool: one labelled image to assistive technology, no
 * buttons or links inside, and captioned as a preview.
 */

type Token = [kind: "kw" | "str" | "num" | "fn" | "plain", text: string];
const CODE: Token[][] = [
  [["kw", "import"], ["plain", " { limits } "], ["kw", "from"], ["str", ' "./limits"'], ["plain", ";"]],
  [],
  [["kw", "export async function "], ["fn", "upload"], ["plain", "(req) {"]],
  [["kw", "  const"], ["plain", " size = req.file.size;"]],
  [["kw", "  if"], ["plain", " (size > limits.maxBytes) {"]],
  [["kw", "    return "], ["fn", "reply"], ["plain", "("], ["num", "413"], ["plain", ", "], ["str", '"Error"'], ["plain", ");"]],
  [["plain", "  }"]],
  [["kw", "  return"], ["plain", " store."], ["fn", "save"], ["plain", "(req.file);"]],
  [["plain", "}"]],
];
const HIGHLIGHTED_LINE = 6;
const TOKEN_CLASS: Record<Token[0], string> = {
  kw: "text-[var(--syntax-keyword)]",
  str: "text-[var(--syntax-string)]",
  num: "text-[var(--syntax-number)]",
  fn: "text-[var(--syntax-function)]",
  plain: "text-foreground",
};

const LOGS = [
  { time: "10:02:14", level: "INFO", tone: "text-info", message: "POST /upload 200 · 41ms" },
  { time: "10:02:19", level: "INFO", tone: "text-info", message: "POST /upload 200 · 38ms" },
  { time: "10:02:31", level: "WARN", tone: "text-warning", message: "file size=12.4 MB" },
  { time: "10:02:31", level: "ERROR", tone: "text-danger", message: "POST /upload 413", evidence: true },
] as const;

function PaneHeader({ icon, title, aside }: { icon: ReactNode; title: string; aside?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-raised px-3">
      <span className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <span className="text-subtle">{icon}</span>
        <span className="truncate">{title}</span>
      </span>
      {aside}
    </div>
  );
}

export const PREVIEW_CAPTION_ID = "workspace-preview-caption";

export function WorkspacePreview() {
  return (
    <figure aria-labelledby={PREVIEW_CAPTION_ID} className="min-w-0">
      <div
        role="img"
        aria-label="Preview of the BugLab workspace: a file explorer, a read-only code editor, an investigation console with one log entry collected as evidence, and a diagnosis step."
        className="select-none overflow-hidden rounded-2xl border border-card-border bg-card shadow-card"
      >
        {/* Title bar */}
        <div className="flex h-10 items-center justify-between gap-3 border-b border-border bg-surface-raised px-3.5">
          <span className="flex items-center gap-2 text-xs font-medium text-muted">
            <BugIcon className="text-accent" />
            BugLab workspace
          </span>
          <span className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-subtle">
            Preview
          </span>
        </div>

        {/* Incident */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border bg-surface px-4 py-2.5 text-xs">
          <span className="font-semibold uppercase tracking-wider text-danger">Incident</span>
          <span className="text-foreground">Uploads over 10 MB fail with a generic error.</span>
          <span className="font-mono text-subtle">sample</span>
        </div>

        {/* Panes, separated by 1px gaps over the border colour */}
        <div className="grid gap-px bg-border sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <div className="hidden min-w-0 flex-col bg-surface sm:flex">
            <PaneHeader icon={<FolderIcon />} title="Explorer" />
            <ul className="space-y-0.5 py-2 font-mono text-xs text-muted">
              <li className="flex items-center gap-1.5 px-3 py-1">
                <FolderIcon className="shrink-0 text-subtle" />
                src
              </li>
              <li className="flex items-center gap-1.5 border-l-2 border-accent bg-accent/10 py-1 pl-[1.375rem] pr-3 text-foreground">
                <FileIcon className="shrink-0" />
                upload.ts
              </li>
              <li className="flex items-center gap-1.5 py-1 pl-6 pr-3">
                <FileIcon className="shrink-0 text-subtle" />
                limits.ts
              </li>
              <li className="flex items-center gap-1.5 px-3 py-1">
                <FolderIcon className="shrink-0 text-subtle" />
                logs
              </li>
              <li className="flex items-center gap-1.5 py-1 pl-6 pr-3">
                <FileIcon className="shrink-0 text-subtle" />
                app.log
              </li>
            </ul>
          </div>

          <div className="flex min-w-0 flex-col bg-surface">
            <PaneHeader
              icon={<CodeIcon />}
              title="Editor"
              aside={
                <span className="flex items-center gap-1 text-[11px] text-subtle">
                  <LockIcon width={12} height={12} />
                  Read-only
                </span>
              }
            />
            <div className="flex border-b border-border bg-surface-sunken text-xs">
              <span className="flex items-center gap-1.5 border-r border-t-2 border-r-border border-t-accent bg-surface px-3 py-1.5 font-mono text-foreground">
                <FileIcon className="text-subtle" />
                upload.ts
              </span>
            </div>
            <pre className="overflow-hidden bg-surface-sunken py-2.5 font-mono text-xs leading-5">
              {CODE.map((line, index) => {
                const number = index + 1;
                const highlighted = number === HIGHLIGHTED_LINE;
                return (
                  <div
                    key={number}
                    className={`flex whitespace-pre border-l-2 pr-3 ${highlighted ? "border-accent bg-accent/[0.08]" : "border-transparent"}`}
                  >
                    <span className={`w-8 shrink-0 select-none pr-3 text-right ${highlighted ? "text-foreground" : "text-subtle"}`}>
                      {number}
                    </span>
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
                      {line.map(([kind, text], tokenIndex) => (
                        <span key={tokenIndex} className={TOKEN_CLASS[kind]}>
                          {text}
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </pre>
          </div>

          <div className="flex min-w-0 flex-col bg-surface sm:col-span-2">
            <PaneHeader
              icon={<TerminalIcon />}
              title="Investigation console"
              aside={
                <span className="flex items-center gap-3 text-[11px] text-muted">
                  <span className="border-b-2 border-accent pb-0.5 text-foreground">
                    Logs <span className="font-mono text-subtle">4</span>
                  </span>
                  <span className="pb-0.5">
                    Network <span className="font-mono text-subtle">2</span>
                  </span>
                </span>
              }
            />
            <ul className="py-1.5 font-mono text-xs">
              {LOGS.map((entry, index) => (
                <li
                  key={index}
                  className={`grid grid-cols-[4.5rem_3.25rem_minmax(0,1fr)_auto] items-center gap-2 border-l-2 px-3 py-1 ${"evidence" in entry ? "border-success bg-success/[0.07]" : "border-transparent"}`}
                >
                  <span className="text-subtle">{entry.time}</span>
                  <span className={`font-semibold ${entry.tone}`}>{entry.level}</span>
                  <span className="truncate text-foreground">{entry.message}</span>
                  {"evidence" in entry ? (
                    <span className="rounded border border-success/30 bg-success/10 px-1.5 py-px font-sans text-[11px] font-medium text-success">
                      ✓ Evidence
                    </span>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Diagnosis */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border bg-surface-raised px-3.5 py-2.5 text-xs">
          <span className="flex items-center gap-2 font-semibold uppercase tracking-wider text-muted">
            <ClipboardIcon className="text-subtle" />
            Diagnosis
          </span>
          <span className="rounded-md border border-dashed border-border-strong px-2 py-0.5 text-subtle">
            Root cause: decided after you investigate
          </span>
        </div>
      </div>
      <figcaption id={PREVIEW_CAPTION_ID} className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />
        Illustrative preview. Open a challenge to start a real investigation.
      </figcaption>
    </figure>
  );
}
