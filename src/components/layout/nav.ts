/** The app section a page belongs to. */
export type AppSection = "challenges" | "workspace" | "journal" | "progress" | "learning-path" | "account";

export interface NavItem {
  label: string;
  section: AppSection;
  href: string;
  /** One line shown under the label in the mobile menu. */
  detail: string;
  /**
   * When current, show the item as text rather than a link. The workspace
   * does this: inside an open challenge, a link to the workspace page would
   * only take the learner away from their investigation.
   */
  textWhenCurrent?: boolean;
}

const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The inline (md and up) navigation item. */
export function navItemClass(current: boolean): string {
  return current
    ? `block rounded-md bg-nav-current px-3 py-1.5 font-medium text-foreground ${focus}`
    : `block rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground ${focus}`;
}
