import type { KeyboardEvent } from "react";
import { ChevronDownIcon, FileIcon, FolderIcon } from "@/components/ui/icons";
import type { FileNode } from "@/types/workspace";

export interface VisibleTreeItem {
  node: FileNode;
  level: number;
  parentPath: string | null;
  setSize: number;
  posInSet: number;
}

interface FileTreeItemProps {
  item: VisibleTreeItem;
  isActive: boolean;
  isExpanded: boolean;
  isTabStop: boolean;
  onActivate: (item: VisibleTreeItem) => void;
  onKeyDown: (event: KeyboardEvent<HTMLLIElement>, item: VisibleTreeItem) => void;
  onFocus: (item: VisibleTreeItem) => void;
}

// One row of the ARIA tree. The tree is rendered flat, so nesting is
// expressed with aria-level / aria-setsize / aria-posinset.
export function FileTreeItem({
  item,
  isActive,
  isExpanded,
  isTabStop,
  onActivate,
  onKeyDown,
  onFocus,
}: FileTreeItemProps) {
  const { node, level } = item;
  const isFolder = node.kind === "folder";

  return (
    <li
      role="treeitem"
      data-path={node.path}
      aria-level={level}
      aria-setsize={item.setSize}
      aria-posinset={item.posInSet}
      aria-expanded={isFolder ? isExpanded : undefined}
      aria-selected={isFolder ? undefined : isActive}
      tabIndex={isTabStop ? 0 : -1}
      title={node.path}
      onClick={() => onActivate(item)}
      onKeyDown={(event) => onKeyDown(event, item)}
      onFocus={() => onFocus(item)}
      style={{ paddingLeft: `${0.75 + (level - 1) * 0.875}rem` }}
      className={`flex h-7 cursor-pointer select-none items-center gap-1.5 border-l-2 pr-3 font-mono text-[12.5px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/70 ${
        isActive
          ? "border-accent bg-accent/10 text-foreground"
          : "border-transparent text-muted hover:bg-surface-raised hover:text-foreground"
      }`}
    >
      {isFolder ? (
        <>
          <ChevronDownIcon
            width={12}
            height={12}
            className={`shrink-0 text-subtle transition-transform motion-reduce:transition-none ${
              isExpanded ? "" : "-rotate-90"
            }`}
          />
          <FolderIcon className="shrink-0 text-accent/70" />
        </>
      ) : (
        <FileIcon className="ml-[18px] shrink-0 text-subtle" />
      )}
      <span className="truncate">{node.name}</span>
    </li>
  );
}
