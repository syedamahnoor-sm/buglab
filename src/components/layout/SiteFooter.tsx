import { BugIcon } from "@/components/ui/icons";

/**
 * BugLab's minimal site footer: near-black, a step below the page, with the
 * brand, its line and the Learning Loop's theme. No links or marketing.
 *
 * For browsing pages only. The debugging workspace keeps the full viewport for
 * the investigation and does not use it. It sits at the bottom of short pages
 * because the body is a full-height column and the page's main grows.
 * Colours are `--footer*` tokens, so a light theme can restyle it.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-footer-border bg-footer text-footer-muted">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="grid size-8 place-items-center rounded-lg border border-accent/25 bg-accent/10 text-accent"
              >
                <BugIcon />
              </span>
              <span className="text-base font-semibold tracking-tight text-footer-text">BugLab</span>
            </p>
            <p className="mt-4 text-sm font-medium text-footer-text">Investigate. Understand. Remember.</p>
            <p className="mt-1 text-sm">Built for curious developers.</p>
          </div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">Learning That Sticks.</p>
        </div>
        <p className="border-t border-footer-border pt-6 text-xs">© 2026 BugLab</p>
      </div>
    </footer>
  );
}
