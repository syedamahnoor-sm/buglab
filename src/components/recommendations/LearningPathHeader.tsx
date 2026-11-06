import Link from "next/link";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { BugIcon } from "@/components/ui/icons";
import { ROUTES } from "@/lib/challenge-routes";

/** Feature-local header: shared navigation remains owned by the authentication/UI workstream. */
export function LearningPathHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-nav/95 shadow-nav backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href={ROUTES.home} className="flex items-center gap-2 rounded-md text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
          <span className="grid size-8 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent"><BugIcon /></span>BugLab
        </Link>
        <nav aria-label="Learning path navigation" className="order-3 flex w-full items-center gap-5 border-t border-border pt-2 text-xs sm:order-none sm:w-auto sm:border-0 sm:pt-0 sm:text-sm">
          <span aria-current="page" className="font-medium text-foreground">Learning Path</span>
          <Link href={ROUTES.library} className="rounded text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent">Challenges</Link>
          <Link href={ROUTES.journal} className="rounded text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent">Journal</Link>
          <Link href={ROUTES.progress} className="rounded text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent">Progress</Link>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}