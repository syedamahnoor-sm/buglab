import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { CodeIcon, FileIcon, LockIcon } from "@/components/ui/icons";
import type { OpenFile } from "@/types/workspace";

interface CodeEditorPlaceholderProps {
  file: OpenFile;
  className?: string;
}

export function CodeEditorPlaceholder({ file, className }: CodeEditorPlaceholderProps) {
  return (
    <Panel
      title="Editor"
      icon={<CodeIcon />}
      className={className}
      bodyClassName="flex flex-col bg-surface-sunken"
      actions={
        <Badge>
          <LockIcon width={12} height={12} />
          Read-only
        </Badge>
      }
      footer={
        <div className="flex items-center justify-between gap-3 font-mono">
          <span className="truncate">{file.path}</span>
          <span className="shrink-0">{file.language} · UTF-8</span>
        </div>
      }
    >
      <div className="flex h-9 shrink-0 items-end border-b border-border bg-surface">
        <span className="flex h-full items-center gap-2 border-r border-border border-t-2 border-t-accent bg-surface-sunken px-3 font-mono text-xs text-foreground">
          <FileIcon className="text-subtle" />
          {file.name}
        </span>
      </div>

      <pre className="flex-1 overflow-auto py-3 font-mono text-[13px] leading-6">
        <code className="grid min-w-max grid-cols-[auto_1fr]">
          {file.lines.map((line, index) => (
            <span key={index} className="contents">
              <span className="select-none pl-4 pr-4 text-right text-subtle/70">
                {index + 1}
              </span>
              <span
                className={`pr-6 ${
                  line.startsWith("#") ? "font-semibold text-accent" : "text-foreground/85"
                }`}
              >
                {line || " "}
              </span>
            </span>
          ))}
        </code>
      </pre>

      <p className="shrink-0 border-t border-border px-4 py-2 text-xs text-subtle">
        Editor placeholder. Opening files, editing, and running code arrive in a
        later stage.
      </p>
    </Panel>
  );
}
