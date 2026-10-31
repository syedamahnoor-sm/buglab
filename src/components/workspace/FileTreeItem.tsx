import { ChevronDownIcon, FileIcon, FolderIcon } from "@/components/ui/icons";
import type { FileNode } from "@/types/workspace";

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  activePath?: string;
}

// Static, non-interactive row. Folders are always shown expanded in Stage 1.
export function FileTreeItem({ node, depth, activePath }: FileTreeItemProps) {
  const isActive = node.kind === "file" && node.path === activePath;
  const indent = { paddingLeft: `${0.75 + depth * 0.875}rem` };

  return (
    <li>
      <div
        style={indent}
        aria-current={isActive ? "true" : undefined}
        className={`flex h-7 items-center gap-1.5 pr-3 font-mono text-[12.5px] ${
          isActive
            ? "border-l-2 border-accent bg-accent/10 text-foreground"
            : "border-l-2 border-transparent text-muted"
        }`}
      >
        {node.kind === "folder" ? (
          <>
            <ChevronDownIcon className="shrink-0 text-subtle" width={12} height={12} />
            <FolderIcon className="shrink-0 text-accent/70" />
          </>
        ) : (
          <FileIcon className="ml-[18px] shrink-0 text-subtle" />
        )}
        <span className="truncate">{node.name}</span>
      </div>

      {node.kind === "folder" && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
