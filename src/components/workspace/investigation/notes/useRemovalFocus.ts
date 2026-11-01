import { useRef, type MouseEvent } from "react";
import { neighborAfterRemoval, triggerHadFocus } from "@/lib/focus";

/*
 * Keeps keyboard focus in place when an item's Remove button removes its own
 * row: focus moves to the next item's Remove button (or the previous one),
 * or to `fallbackId` when the list becomes empty. Remove buttons must carry
 * data-remove-id. Focus only moves if the pressed button had focus.
 */
export function useRemovalFocus(ids: readonly string[], fallbackId: string) {
  const listRef = useRef<HTMLUListElement>(null);

  function removeWithFocus(
    event: MouseEvent<HTMLButtonElement>,
    id: string,
    onRemove: (id: string) => void,
  ) {
    const restore = triggerHadFocus(event);
    const nextId = neighborAfterRemoval(ids, id);
    // Resolve the target before removing: it is still in the DOM either way.
    const target = nextId
      ? listRef.current?.querySelector<HTMLElement>(`[data-remove-id="${nextId}"]`)
      : document.getElementById(fallbackId);
    onRemove(id);
    if (restore) target?.focus();
  }

  return { listRef, removeWithFocus };
}
