import { Panel } from "@/components/ui/Panel";
import { FolderIcon } from "@/components/ui/icons";
import type { FileNode } from "@/types/workspace";
import { FileTreeItem } from "./FileTreeItem";

interface FileExplorerProps {
  files: FileNode[];
  activePath?: string;
  className?: string;
}

export function FileExplorer({ files, activePath, className }: FileExplorerProps) {
  return (
    <Panel
      title="Explorer"
      icon={<FolderIcon />}
      className={className}
      bodyClassName="py-1.5"
      footer="File browsing is read-only in this preview"
    >
      <ul aria-label="Project files">
        {files.map((node) => (
          <FileTreeItem key={node.path} node={node} depth={0} activePath={activePath} />
        ))}
      </ul>
    </Panel>
  );
}
