import Link from "next/link";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

export const fieldClass = "mt-2 block w-full rounded-lg border border-border-strong bg-field px-3 py-3 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50";
export const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-lg border border-accent/40 bg-accent/15 px-5 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-50";
export const linkClass = "rounded text-sm text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent";

export function AccountFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <><AppHeader current="account" /><main id="main-content" className="flex-1 bg-[image:var(--canvas-image)] px-4 py-12 sm:py-20"><div className="mx-auto max-w-md"><Link href="/challenges" className={linkClass}>← Back to investigations</Link><div className="mt-6 rounded-2xl border border-card-border bg-card p-6 shadow-[var(--card-shadow)] sm:p-8"><p className="font-mono text-xs uppercase tracking-widest text-accent">Your BugLab</p><h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{title}</h1><p className="mt-3 text-sm leading-6 text-muted">{description}</p><div className="mt-7">{children}</div></div><p className="mt-6 text-center text-xs leading-5 text-subtle">Keep investigating. An account is optional for exploring BugLab.</p></div></main><SiteFooter /></>;
}

export function AccountNotice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <p role={danger ? "alert" : "status"} className={`rounded-lg border p-3 text-sm leading-6 ${danger ? "border-danger/30 bg-danger/5 text-danger" : "border-accent/25 bg-accent/5 text-muted"}`}>{children}</p>;
}

export const accountErrorMessage = (kind: string): string => ({
  "invalid-credentials": "That email and password did not match. Please try again.",
  "email-unverified": "Verify your email before signing in. You can request another verification email below.",
  "token-invalid": "This link is invalid or has already been used. Request a new email.",
  "token-expired": "This link has expired. Request a new email.",
  "rate-limited": "Too many attempts. Please wait a minute before trying again.",
  "unauthenticated": "Your session has ended. Sign in again to continue.",
  "reauthentication-required": "For your security, sign out and sign in again before making this change.",
  "unavailable": "Accounts are not available right now. Your browser learning history is unchanged.",
  "timeout": "The request took too long. Check your connection and try again.",
  "network": "Could not reach BugLab. Check your connection and try again.",
  "invalid": "Check the details in the form and try again.",
}[kind] ?? "We could not complete that request. Please try again.");
