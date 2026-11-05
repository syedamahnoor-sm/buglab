import Link from "next/link";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { BugIcon } from "@/components/ui/icons";
import { ROUTES } from "@/lib/challenge-routes";

/** The app section a page belongs to. */
export type AppSection = "challenges" | "workspace" | "journal";

interface AppHeaderProps {
  /** The section the current page belongs to; it is marked as the current page. */
  current: AppSection;
}

interface NavItem {
  label: string;
  section: AppSection;
  href: string;
  /**
   * When current, show the item as text rather than a link. The workspace
   * does this: inside an open challenge, a link to the workspace page would
   * only take the learner away from their investigation.
   */
  textWhenCurrent?: boolean;
}

const navItems: NavItem[] = [
  { label: "Challenges", section: "challenges", href: ROUTES.library },
  { label: "Workspace", section: "workspace", href: ROUTES.workspace, textWhenCurrent: true },
  { label: "Journal", section: "journal", href: ROUTES.journal },
];

// Below sm, items and gaps tighten so the items fit at 320px without the nav
// scrolling; from sm up the header is unchanged.
const itemClass = "block rounded-md px-2 py-1.5 sm:px-3";
const currentClass = "block rounded-md bg-nav-current px-2 py-1.5 font-medium text-foreground sm:px-3";

export function AppHeader({ current }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-nav/90 shadow-nav backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:gap-8 sm:px-6">
        <Link
          href={ROUTES.home}
          className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-8 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent">
            <BugIcon width={18} height={18} />
          </span>
          {/* On the narrowest phones the logo stands alone; the name stays for screen readers. */}
          <span className="flex flex-col leading-none max-[399px]:sr-only">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              BugLab
            </span>
            <span className="mt-1 hidden text-xs text-subtle sm:block">
              Debugging investigations
            </span>
          </span>
        </Link>

        <nav aria-label="Primary" className="min-w-0 flex-1">
          <ul className="flex items-center gap-0.5 overflow-x-auto text-sm sm:gap-1">
            {navItems.map((item) => (
              <li key={item.label}>
                <NavEntry item={item} current={current} />
              </li>
            ))}
          </ul>
        </nav>

        <ThemeToggle />
      </div>
    </header>
  );
}

function NavEntry({ item, current }: { item: NavItem; current: AppSection }) {
  const isCurrent = item.section === current;

  if (isCurrent && item.textWhenCurrent) {
    return (
      <span aria-current="page" className={currentClass}>
        {item.label}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={isCurrent ? "page" : undefined}
      className={`${isCurrent ? currentClass : `${itemClass} text-muted transition-colors hover:bg-surface-raised hover:text-foreground`} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      {item.label}
    </Link>
  );
}
