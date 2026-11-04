import { useEffect, useState } from "react";

/**
 * A key that changes each time this component's effects are torn down. Give it
 * to a child as `key` and the child is created fresh the next time this
 * component is shown.
 *
 * Next.js (cacheComponents) keeps visited pages alive in a hidden <Activity>.
 * Hiding a page runs its effect cleanups but keeps its component state, and
 * showing it again re-runs the effects. A child that disposes a resource in a
 * cleanup but creates it only once, as @monaco-editor/react does with its
 * editor, is then left holding the disposed resource. The update made here
 * renders while the page is still hidden, so the stale child is replaced before
 * its effects can run again. After a real unmount React ignores the update.
 */
export function useRemountKey(): number {
  const [key, setKey] = useState(0);
  useEffect(() => () => setKey((current) => current + 1), []);
  return key;
}
