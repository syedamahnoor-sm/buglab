import { useEffect, useRef, type KeyboardEvent } from "react";
import { CloseIcon, FileIcon } from "@/components/ui/icons";
import { getDisambiguatingFolders, getFileName } from "@/lib/file-tree";
import { revealOffset } from "@/lib/scroll";

/**
 * A tab's DOM id, unique per path. Letters and digits are kept; every other
 * character, "-" included, becomes "-<hex code point>-". Since a bare "-" only
 * ever delimits a code, two different paths can never share an id (a-b.ts,
 * a_b.ts and a.b.ts used to), and the id is safe in a #selector.
 */
export function getTabId(path: string) {
  const encoded = Array.from(path, (char) =>
    /[a-zA-Z0-9]/.test(char) ? char : `-${char.codePointAt(0)!.toString(16)}-`,
  ).join("");
  return `editor-tab-${encoded}`;
}

interface EditorTabsProps {
  openPaths: string[];
  activePath: string | null;
  panelId: string;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

// ARIA tabs with automatic activation: arrow keys move and switch,
// Delete closes the focused tab, middle-click closes too.
export function EditorTabs({
  openPaths,
  activePath,
  panelId,
  onActivate,
  onClose,
}: EditorTabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const folders = getDisambiguatingFolders(openPaths);

  // Keep the active tab visible when it is opened from elsewhere (Explorer,
  // initiator links). Only the tab strip scrolls, never the page.
  useEffect(() => {
    const list = listRef.current;
    const tab = activePath
      ? list?.querySelector<HTMLElement>(`#${getTabId(activePath)}`)?.parentElement
      : null;
    if (!list || !tab) return;
    list.scrollLeft = revealOffset(
      list.scrollLeft,
      list.clientWidth,
      tab.offsetLeft,
      tab.offsetWidth,
    );
  }, [activePath, openPaths]);

  function focusTab(path: string | undefined) {
    if (!path) return;
    listRef.current?.querySelector<HTMLElement>(`#${getTabId(path)}`)?.focus();
  }

  function selectAndFocus(path: string | undefined) {
    if (!path) return;
    onActivate(path);
    focusTab(path);
  }

  function close(path: string) {
    const index = openPaths.indexOf(path);
    if (path === activePath) {
      focusTab(openPaths[index + 1] ?? openPaths[index - 1]);
    }
    onClose(path);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, path: string) {
    const index = openPaths.indexOf(path);

    switch (event.key) {
      case "ArrowRight":
        selectAndFocus(openPaths[(index + 1) % openPaths.length]);
        break;
      case "ArrowLeft":
        selectAndFocus(openPaths[(index - 1 + openPaths.length) % openPaths.length]);
        break;
      case "Home":
        selectAndFocus(openPaths[0]);
        break;
      case "End":
        selectAndFocus(openPaths[openPaths.length - 1]);
        break;
      case "Delete":
        close(path);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Open files"
      className="relative flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-surface [scrollbar-width:thin]"
    >
      {openPaths.map((path) => {
        const isActive = path === activePath;
        const name = getFileName(path);
        const folder = folders.get(path);
        const label = folder ? `${name} (${folder})` : name;

        return (
          <div
            key={path}
            className={`group flex shrink-0 items-center border-r border-border border-t-2 ${
              isActive
                ? "border-t-accent bg-surface-sunken text-foreground"
                : "border-t-transparent text-muted hover:bg-surface-raised hover:text-foreground"
            }`}
          >
            <button
              type="button"
              role="tab"
              id={getTabId(path)}
              aria-selected={isActive}
              aria-controls={panelId}
              aria-keyshortcuts="Delete"
              tabIndex={isActive ? 0 : -1}
              title={path}
              onClick={() => onActivate(path)}
              onAuxClick={(event) => {
                if (event.button === 1) close(path);
              }}
              onKeyDown={(event) => handleKeyDown(event, path)}
              className="flex h-full min-w-0 max-w-48 items-center gap-2 pl-3 pr-1.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/70"
            >
              <FileIcon className="shrink-0 text-subtle" />
              <span className="truncate">
                {name}
                {folder && (
                  <span className="ml-1.5 text-subtle">
                    <span className="sr-only">in </span>
                    {folder}
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Close ${label}`}
              title={`Close ${label}`}
              onClick={() => close(path)}
              className={`mr-1.5 flex size-5 items-center justify-center rounded text-subtle hover:bg-border-strong hover:text-foreground ${
                isActive ? "" : "sm:opacity-0 sm:group-hover:opacity-100"
              }`}
            >
              <CloseIcon width={12} height={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
