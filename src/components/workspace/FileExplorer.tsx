import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Panel } from "@/components/ui/Panel";
import { FolderIcon } from "@/components/ui/icons";
import type { FileNode } from "@/types/workspace";
import { FileTreeItem, type VisibleTreeItem } from "./FileTreeItem";

interface FileExplorerProps {
  tree: FileNode[];
  fileCount: number;
  activePath: string | null;
  expandedFolders: ReadonlySet<string>;
  onOpenFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
  className?: string;
}

function flattenVisible(
  nodes: FileNode[],
  expanded: ReadonlySet<string>,
  level = 1,
  parentPath: string | null = null,
): VisibleTreeItem[] {
  return nodes.flatMap((node, index) => {
    const item: VisibleTreeItem = {
      node,
      level,
      parentPath,
      setSize: nodes.length,
      posInSet: index + 1,
    };
    return node.kind === "folder" && expanded.has(node.path)
      ? [item, ...flattenVisible(node.children, expanded, level + 1, node.path)]
      : [item];
  });
}

export function FileExplorer({
  tree,
  fileCount,
  activePath,
  expandedFolders,
  onOpenFile,
  onToggleFolder,
  onSetFolderExpanded,
  className,
}: FileExplorerProps) {
  const treeRef = useRef<HTMLUListElement>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  const visibleItems = useMemo(
    () => flattenVisible(tree, expandedFolders),
    [tree, expandedFolders],
  );

  // Roving tabindex: exactly one item is reachable with Tab.
  const isVisible = (path: string | null) =>
    path !== null && visibleItems.some((item) => item.node.path === path);
  const tabStopPath = isVisible(focusedPath)
    ? focusedPath
    : isVisible(activePath)
      ? activePath
      : (visibleItems[0]?.node.path ?? null);

  function focusPath(path: string | undefined) {
    if (!path) return;
    treeRef.current
      ?.querySelector<HTMLElement>(`[data-path="${path}"]`)
      ?.focus();
  }

  function activate(item: VisibleTreeItem) {
    if (item.node.kind === "folder") onToggleFolder(item.node.path);
    else onOpenFile(item.node.path);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>, item: VisibleTreeItem) {
    const index = visibleItems.indexOf(item);
    const { node } = item;
    const isOpenFolder = node.kind === "folder" && expandedFolders.has(node.path);

    switch (event.key) {
      case "ArrowDown":
        focusPath(visibleItems[index + 1]?.node.path);
        break;
      case "ArrowUp":
        focusPath(visibleItems[index - 1]?.node.path);
        break;
      case "Home":
        focusPath(visibleItems[0]?.node.path);
        break;
      case "End":
        focusPath(visibleItems[visibleItems.length - 1]?.node.path);
        break;
      case "ArrowRight":
        if (node.kind !== "folder") return;
        if (isOpenFolder) focusPath(visibleItems[index + 1]?.node.path);
        else onSetFolderExpanded(node.path, true);
        break;
      case "ArrowLeft":
        if (isOpenFolder) onSetFolderExpanded(node.path, false);
        else focusPath(item.parentPath ?? undefined);
        break;
      case "Enter":
      case " ":
        activate(item);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <Panel
      title="Explorer"
      icon={<FolderIcon />}
      className={className}
      bodyClassName="py-1.5"
      footer={`${fileCount} files · read-only`}
    >
      <ul ref={treeRef} role="tree" aria-label="Project files">
        {visibleItems.map((item) => (
          <FileTreeItem
            key={item.node.path}
            item={item}
            isActive={item.node.path === activePath}
            isExpanded={expandedFolders.has(item.node.path)}
            isTabStop={item.node.path === tabStopPath}
            onActivate={activate}
            onKeyDown={handleKeyDown}
            onFocus={(focused) => setFocusedPath(focused.node.path)}
          />
        ))}
      </ul>
    </Panel>
  );
}
