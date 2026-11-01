/** The item to move focus to after `removedId` is removed: the next one, else the previous. */
export function neighborAfterRemoval(ids: readonly string[], removedId: string): string | null {
  const index = ids.indexOf(removedId);
  if (index === -1) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/**
 * Whether the control that triggered an action currently has focus. Used to
 * restore focus only for keyboard (and focus-on-click) interactions, so mouse
 * users in browsers that don't focus buttons on click see no focus jump.
 */
export function triggerHadFocus(event: { currentTarget: EventTarget }): boolean {
  return typeof document !== "undefined" && document.activeElement === event.currentTarget;
}
