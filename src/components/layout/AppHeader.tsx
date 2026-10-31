import { BugIcon } from "@/components/ui/icons";
import { APP_STAGE_LABEL } from "@/config/app";

interface NavItem {
  label: string;
  current?: boolean;
}

// Only the current page is "live" for now. The rest are rendered as plain
// text (not links or buttons) so they don't pretend to be working controls.
const navItems: NavItem[] = [
  { label: "Challenges" },
  { label: "Workspace", current: true },
  { label: "Learn" },
];

export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 sm:gap-8 sm:px-6">
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent">
            <BugIcon width={18} height={18} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              BugLab
            </span>
            <span className="mt-1 hidden text-[11px] text-subtle sm:block">
              Debugging investigations
            </span>
          </span>
        </div>

        <nav aria-label="Primary" className="min-w-0 flex-1">
          <ul className="flex items-center gap-1 overflow-x-auto text-sm">
            {navItems.map((item) =>
              item.current ? (
                <li key={item.label}>
                  <span
                    aria-current="page"
                    className="block rounded-md bg-surface-raised px-3 py-1.5 font-medium text-foreground"
                  >
                    {item.label}
                  </span>
                </li>
              ) : (
                <li key={item.label}>
                  <span
                    aria-disabled="true"
                    title="Not available yet"
                    className="flex cursor-default select-none items-center gap-1.5 px-3 py-1.5 text-subtle"
                  >
                    {item.label}
                    <span className="hidden rounded border border-border px-1 text-[10px] uppercase tracking-wide sm:inline">
                      Soon
                    </span>
                  </span>
                </li>
              ),
            )}
          </ul>
        </nav>

        <span className="hidden shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-subtle md:inline">
          {APP_STAGE_LABEL}
        </span>
      </div>
    </header>
  );
}
