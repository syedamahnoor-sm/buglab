import Link from "next/link";
import { BugIcon } from "@/components/ui/icons";
import { ROUTES, SECTION_IDS, navLinks, openWorkspaceCta } from "@/data/landing";
import { CtaLink } from "./CtaLink";
import { styles } from "./styles";

export function LandingHeader() {
  return (
    <>
      <a
        href={`#${SECTION_IDS.content}`}
        className="sr-only rounded-md bg-accent px-3 py-2 text-sm font-medium text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-foreground"
      >
        Skip to content
      </a>
      <header className={`sticky top-0 z-30 backdrop-blur-md ${styles.header}`}>
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link
            href={ROUTES.welcome}
            className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="flex size-8 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent shadow-[0_0_20px_-6px_var(--accent)]">
              <BugIcon width={18} height={18} />
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">BugLab</span>
          </Link>

          <nav aria-label="Page sections" className="hidden flex-1 md:block">
            <ul className="flex items-center gap-5 text-sm">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className={`rounded-sm pb-0.5 text-muted transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${styles.link}`}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto">
            <CtaLink href={openWorkspaceCta.href} size="sm" arrow>
              {openWorkspaceCta.label}
            </CtaLink>
          </div>
        </div>
      </header>
    </>
  );
}
