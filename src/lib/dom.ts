const DATA_ATTRIBUTE = /^data-[a-z0-9-]+$/;

/**
 * The first element under `root` whose `attribute` is exactly `value`, or null.
 *
 * Values here come from challenge data (file paths, log and request IDs), so
 * they are compared, never written into a selector: a quote in one made
 * querySelector throw, and a backslash or bracket changed what it matched.
 */
export function findByData(
  root: ParentNode | null | undefined,
  attribute: `data-${string}`,
  value: string,
): HTMLElement | null {
  if (!DATA_ATTRIBUTE.test(attribute)) throw new Error(`Not a data attribute name: ${attribute}`);
  if (!root) return null;
  for (const element of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
    if (element.getAttribute(attribute) === value) return element;
  }
  return null;
}
