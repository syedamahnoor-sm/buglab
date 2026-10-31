import type { FileNode, ScenarioFile } from "@/types/workspace";

type MutableFolder = Extract<FileNode, { kind: "folder" }>;

function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes
    .map((node) =>
      node.kind === "folder" ? { ...node, children: sortNodes(node.children) } : node,
    )
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** Builds a folders-first tree from a flat list of file paths. */
export function buildFileTree(files: ScenarioFile[]): FileNode[] {
  const root: FileNode[] = [];

  for (const file of files) {
    const segments = file.path.split("/");
    let siblings = root;

    segments.slice(0, -1).forEach((name, index) => {
      const path = segments.slice(0, index + 1).join("/");
      let folder = siblings.find(
        (node): node is MutableFolder => node.kind === "folder" && node.path === path,
      );
      if (!folder) {
        folder = { kind: "folder", name, path, children: [] };
        siblings.push(folder);
      }
      siblings = folder.children;
    });

    siblings.push({ kind: "file", name: segments[segments.length - 1], path: file.path });
  }

  return sortNodes(root);
}

export function collectFolderPaths(nodes: FileNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "folder" ? [node.path, ...collectFolderPaths(node.children)] : [],
  );
}

/** "src/routes/auth.ts" -> ["src", "src/routes"] */
export function getAncestorPaths(path: string): string[] {
  const segments = path.split("/").slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function getFileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
