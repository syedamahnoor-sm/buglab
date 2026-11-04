import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { BugIcon } from "@/components/ui/icons";

export type AdminSection = "overview" | "challenges";

const NAV: { id: AdminSection; label: string; href: string }[] = [
  { id: "overview", label: "Overview", href: "/admin" },
  { id: "challenges", label: "Challenges", href: "/admin/challenges" },
];

/**
 * The admin area's frame. Presentational only: whoever renders it must already
 * have authorised the request on the server (see docs/architecture/accounts-and-rbac.md).
 * No admin route mounts it yet.
 */
export function AdminShell({ current, title, children }: { current: AdminSection; title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border bg-background/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="flex size-7 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent">
              <BugIcon />
            </span>
            BugLab Admin
          </span>
          <nav aria-label="Admin" className="flex-1">
            <ul className="flex gap-1 text-sm">
              {NAV.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={item.id === current ? "page" : undefined}
                    className={`block rounded-md px-3 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                      item.id === current ? "bg-surface-raised font-medium text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Badge tone="warning">Read-only</Badge>
        </div>
      </header>
      <main aria-labelledby="admin-title" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 id="admin-title" className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}
