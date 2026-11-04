import Link from "next/link";
import { BugIcon } from "@/components/ui/icons";
import { APP_STAGE_LABEL } from "@/config/app";

/** The app section a page belongs to. */
export type AppSection = "challenges" | "workspace";

interface AppHeaderProps {
  /** The section the current page belongs to; it is marked as the current page. */
  current: AppSection;
}

type NavItem =
  | { label: string; kind: "link"; section: AppSection; href: string }
  // A section with no page of its own: current on its own pages, otherwise
  // shown as unavailable with the reason in `hint`.
  | { label: string; kind: "section"; section: AppSection; hint: string }
  // Not built yet. Plain text, not a link or button, so it doesn't pretend to
  // be a working control.
  | { label: string; kind: "soon" };

const navItems: NavItem[] = [
  { label: "Challenges", kind: "link", section: "challenges", href: "/challenges" },
  { label: "Workspace", kind: "section", section: "workspace", hint: "Open a challenge to use the workspace" },
  { label: "Learn", kind: "soon" },
];

// Below sm, items and gaps tighten so all three items fit at 320px without the
// nav scrolling; from sm up the header is unchanged.
const itemClass = "block rounded-md px-2 py-1.5 sm:px-3";
const currentClass = "block rounded-md bg-surface-raised px-2 py-1.5 font-medium text-foreground sm:px-3";
const unavailableClass = "flex cursor-default select-none items-center gap-1.5 px-2 py-1.5 text-subtle sm:px-3";

export function AppHeader({ current }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:gap-8 sm:px-6">
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent">
            <BugIcon width={18} height={18} />
          </span>
          {/* On the narrowest phones the logo stands alone; the name stays for screen readers. */}
          <span className="flex flex-col leading-none max-[399px]:sr-only">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              BugLab
            </span>
            <span className="mt-1 hidden text-[11px] text-subtle sm:block">
              Debugging investigations
            </span>
          </span>
        </div>

        <nav aria-label="Primary" className="min-w-0 flex-1">
          <ul className="flex items-center gap-0.5 overflow-x-auto text-sm sm:gap-1">
            {navItems.map((item) => (
              <li key={item.label}>
                <NavEntry item={item} current={current} />
              </li>
            ))}
          </ul>
        </nav>

        <span className="hidden shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-subtle md:inline">
          {APP_STAGE_LABEL}
        </span>
      </div>
    </header>
  );
}

function NavEntry({ item, current }: { item: NavItem; current: AppSection }) {
  if (item.kind === "soon") {
    return (
      <span aria-disabled="true" title="Not available yet" className={unavailableClass}>
        {item.label}
        <span className="hidden rounded border border-border px-1 text-[10px] uppercase tracking-wide min-[360px]:inline">
          Soon
        </span>
      </span>
    );
  }

  const isCurrent = item.section === current;

  if (item.kind === "link") {
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

  return isCurrent ? (
    <span aria-current="page" className={currentClass}>
      {item.label}
    </span>
  ) : (
    <span aria-disabled="true" title={item.hint} className={unavailableClass}>
      {item.label}
    </span>
  );
}
