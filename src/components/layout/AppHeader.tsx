import Link from "next/link";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { BugIcon } from "@/components/ui/icons";
import { ROUTES } from "@/lib/challenge-routes";
import { MobileMenu } from "./MobileMenu";
import { AccountNav } from "@/components/account/AccountNav";
import { navItemClass, type AppSection, type NavItem } from "./nav";

export type { AppSection } from "./nav";

interface AppHeaderProps {
  /** The section the current page belongs to; it is marked as the current page. */
  current: AppSection;
}

const navItems: NavItem[] = [
  { label: "Challenges", section: "challenges", href: ROUTES.library, detail: "Browse the investigations" },
  { label: "Workspace", section: "workspace", href: ROUTES.workspace, textWhenCurrent: true, detail: "Investigate a challenge" },
  { label: "Journal", section: "journal", href: ROUTES.journal, detail: "Reflect and recall" },
  { label: "Progress", section: "progress", href: ROUTES.progress, detail: "What you've solved and what's next" },
  { label: "Learning Path", section: "learning-path", href: ROUTES.learningPath, detail: "Choose your next investigation" },
];

/**
 * The app header. From md up the sections are listed inline; below that they
 * sit in a menu button, so five sections never squeeze at phone widths.
 * Both live in the one Primary navigation landmark.
 */
export function AppHeader({ current }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-nav/90 shadow-nav backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-6 md:gap-8">
        <Link
          href={ROUTES.home}
          className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-8 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent">
            <BugIcon width={18} height={18} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight text-foreground">BugLab</span>
            <span className="mt-1 hidden text-xs text-subtle lg:block">Debugging investigations</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="flex min-w-0 flex-1 justify-end md:justify-start">
          <ul className="hidden items-center gap-1 text-sm md:flex">
            {navItems.map((item) => (
              <li key={item.label}>
                <NavEntry item={item} current={current} />
              </li>
            ))}
          </ul>
          <MobileMenu items={navItems} current={current} />
        </nav>

        <AccountNav />
        <ThemeToggle />
      </div>
    </header>
  );
}

function NavEntry({ item, current }: { item: NavItem; current: AppSection }) {
  const isCurrent = item.section === current;

  if (isCurrent && item.textWhenCurrent) {
    return (
      <span aria-current="page" className={navItemClass(true)}>
        {item.label}
      </span>
    );
  }

  return (
    <Link href={item.href} aria-current={isCurrent ? "page" : undefined} className={navItemClass(isCurrent)}>
      {item.label}
    </Link>
  );
}
