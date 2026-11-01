import Link from "next/link";
import { BugIcon } from "@/components/ui/icons";
import { ROUTES, footer, navLinks, openWorkspaceCta } from "@/data/landing";
import { ArrowRightIcon } from "./icons";
import { styles } from "./styles";

const focusRing = `rounded-sm transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${styles.link}`;
const linkClass = `text-muted ${focusRing}`;

/*
 * Three rows: brand, then the mission beside the links, then the fine print.
 * Static apart from the shared link underline. Every link is a plain anchor
 * or route, so it all works without JavaScript.
 */
export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-surface-sunken/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Brand */}
        <div className="flex flex-col gap-3 py-10 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={ROUTES.welcome}
            className="flex items-center gap-2.5 self-start rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="flex size-8 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent shadow-[0_0_20px_-6px_var(--accent)]">
              <BugIcon width={18} height={18} />
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">BugLab</span>
          </Link>
          <p className="font-mono text-xs text-subtle">{footer.tagline}</p>
        </div>

        {/* Mission and links */}
        <div className="grid gap-10 border-t border-border py-12 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-16">
          <p className="max-w-md text-balance text-2xl font-medium tracking-[-0.02em] text-foreground sm:text-3xl">
            {footer.mission}
          </p>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 text-sm">
            <div>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-subtle">On this page</h2>
              <ul className="mt-4 space-y-3">
                {navLinks.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className={linkClass}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-subtle">Get started</h2>
              <ul className="mt-4 space-y-3">
                <li>
                  <Link href={openWorkspaceCta.href} className={`inline-flex items-center gap-1.5 text-accent ${focusRing}`}>
                    {openWorkspaceCta.label}
                    <ArrowRightIcon width={14} height={14} aria-hidden="true" />
                  </Link>
                </li>
                <li>
                  <a href={footer.backToTop.href} className={linkClass}>
                    <span aria-hidden="true">↑ </span>
                    {footer.backToTop.label}
                  </a>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        {/* Fine print */}
        <div className="flex flex-col gap-2 border-t border-border py-6 font-mono text-[11px] text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>{footer.copyright}</p>
          <p className="tracking-wide">{footer.motto}</p>
        </div>
      </div>
    </footer>
  );
}
