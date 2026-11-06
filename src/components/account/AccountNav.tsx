"use client";
import Link from "next/link";
import { accountInitials } from "@/lib/account/model";
import { useOptionalAccount } from "./AccountProvider";

export function AccountNav() {
  const context = useOptionalAccount();
  if (!context) return null;
  const { state } = context;
  if (state.status === "loading" || state.status === "unavailable" || state.status === "error") return null;
  return state.status === "authenticated" ? <Link href="/account" aria-label="Your account" className="grid size-8 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent/10 text-xs font-semibold text-accent focus-visible:outline-2 focus-visible:outline-accent">{accountInitials(state.session.user)}</Link> : <Link href="/login" className="shrink-0 rounded-md px-2 py-1.5 text-sm font-medium text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent">Sign in</Link>;
}
