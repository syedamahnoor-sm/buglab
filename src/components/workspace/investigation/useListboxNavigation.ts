import { useRef, type KeyboardEvent } from "react";

/*
 * Keyboard support for a single-select listbox where selection follows
 * focus: ↑/↓ move, Home/End jump, Escape clears. Options must carry
 * data-option-id.
 */
export function useListboxNavigation(
  optionIds: string[],
  selectedId: string | null,
  onSelect: (id: string | null) => void,
) {
  const listRef = useRef<HTMLUListElement>(null);

  // Roving tabindex target: the selection if visible, else the first option.
  const tabStopId =
    selectedId !== null && optionIds.includes(selectedId) ? selectedId : (optionIds[0] ?? null);

  function focusAndSelect(id: string | undefined) {
    if (!id) return;
    onSelect(id);
    listRef.current?.querySelector<HTMLElement>(`[data-option-id="${id}"]`)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>, id: string) {
    const index = optionIds.indexOf(id);
    switch (event.key) {
      case "ArrowDown":
        focusAndSelect(optionIds[index + 1]);
        break;
      case "ArrowUp":
        focusAndSelect(optionIds[index - 1]);
        break;
      case "Home":
        focusAndSelect(optionIds[0]);
        break;
      case "End":
        focusAndSelect(optionIds[optionIds.length - 1]);
        break;
      case "Enter":
      case " ":
        onSelect(id);
        break;
      case "Escape":
        onSelect(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /**
   * Focuses the option `id`, or the first visible option if it's filtered
   * out, or the element `fallbackId` (e.g. the filter box) if none are shown.
   */
  function focusOptionOrFallback(id: string | null, fallbackId: string) {
    const list = listRef.current;
    const target =
      (id ? list?.querySelector<HTMLElement>(`[data-option-id="${id}"]`) : null) ??
      list?.querySelector<HTMLElement>('[role="option"]') ??
      document.getElementById(fallbackId);
    target?.focus();
  }

  return { listRef, tabStopId, handleKeyDown, focusOptionOrFallback };
}
