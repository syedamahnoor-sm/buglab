"use client";
import Link from "next/link";
import { useOptionalAccount } from "./AccountProvider";

/** Identity context only: local learning is never presented as account data. */
export function LearningIdentityNotice() {
  const context = useOptionalAccount();
  if (!context) return null;
  const { state } = context;
  if (state.status !== "authenticated") return null;
  return <aside aria-label="Learning storage" className="border-b border-border bg-surface px-4 py-3 text-center text-xs leading-5 text-muted">Signed in as <span className="text-foreground">{state.session.user.email}</span>. Journal, recall and browser-recorded progress remain local to this browser. <Link href="/account/link" className="text-accent underline underline-offset-2">Manage server history</Link></aside>;
}
