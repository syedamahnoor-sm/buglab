import { useReducer } from "react";
import { getAncestorPaths } from "@/lib/file-tree";

export interface WorkspaceState {
  openPaths: string[];
  activePath: string | null;
  expandedFolders: ReadonlySet<string>;
}

type WorkspaceAction =
  | { type: "open-file"; path: string }
  | { type: "activate-tab"; path: string }
  | { type: "close-tab"; path: string }
  | { type: "toggle-folder"; path: string }
  | { type: "set-folder-expanded"; path: string; expanded: boolean };

function withFolders(
  folders: ReadonlySet<string>,
  paths: string[],
  expanded: boolean,
): ReadonlySet<string> {
  const next = new Set(folders);
  for (const path of paths) {
    if (expanded) next.add(path);
    else next.delete(path);
  }
  return next;
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "open-file": {
      const openPaths = state.openPaths.includes(action.path)
        ? state.openPaths
        : [...state.openPaths, action.path];
      return {
        openPaths,
        activePath: action.path,
        expandedFolders: withFolders(state.expandedFolders, getAncestorPaths(action.path), true),
      };
    }

    case "activate-tab":
      return state.openPaths.includes(action.path)
        ? { ...state, activePath: action.path }
        : state;

    case "close-tab": {
      const index = state.openPaths.indexOf(action.path);
      if (index === -1) return state;

      const openPaths = state.openPaths.filter((path) => path !== action.path);
      const activePath =
        state.activePath === action.path
          ? (openPaths[index] ?? openPaths[index - 1] ?? null)
          : state.activePath;
      return { ...state, openPaths, activePath };
    }

    case "toggle-folder":
      return {
        ...state,
        expandedFolders: withFolders(
          state.expandedFolders,
          [action.path],
          !state.expandedFolders.has(action.path),
        ),
      };

    case "set-folder-expanded":
      return state.expandedFolders.has(action.path) === action.expanded
        ? state
        : {
            ...state,
            expandedFolders: withFolders(state.expandedFolders, [action.path], action.expanded),
          };
  }
}

interface WorkspaceControllerOptions {
  entryFilePath: string;
  initiallyExpanded: string[];
}

/** Client-side state for the explorer and editor tabs. */
export function useWorkspaceController({
  entryFilePath,
  initiallyExpanded,
}: WorkspaceControllerOptions) {
  const [state, dispatch] = useReducer(workspaceReducer, null, () => ({
    openPaths: [entryFilePath],
    activePath: entryFilePath,
    expandedFolders: new Set([...initiallyExpanded, ...getAncestorPaths(entryFilePath)]),
  }));

  return {
    ...state,
    openFile: (path: string) => dispatch({ type: "open-file", path }),
    activateTab: (path: string) => dispatch({ type: "activate-tab", path }),
    closeTab: (path: string) => dispatch({ type: "close-tab", path }),
    toggleFolder: (path: string) => dispatch({ type: "toggle-folder", path }),
    setFolderExpanded: (path: string, expanded: boolean) =>
      dispatch({ type: "set-folder-expanded", path, expanded }),
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspaceController>;
