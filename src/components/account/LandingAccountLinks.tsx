"use client";
import Link from "next/link";
import { useOptionalAccount } from "./AccountProvider";

/** Optional account discovery; the landing page's anonymous investigation CTAs stay primary. */
export function LandingAccountLinks() {
  const context = useOptionalAccount();
  if (!context) return null;
  const link = "rounded font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  if (context.state.status === "authenticated") return <p className="mt-5 text-sm leading-6 text-muted">You’re signed in. <Link href="/account/profile" className={link}>Manage your profile</Link>.</p>;
  const unavailable = context.state.status === "unavailable" || context.state.status === "error";
  return <div className="mt-5 max-w-lg text-sm leading-6 text-muted">
    <p><Link href="/login" className={link}>Sign in</Link><span aria-hidden="true"> · </span><Link href="/signup" className={link}>Sign up</Link><span className="ml-2">An account is optional.</span></p>
    {unavailable && <p className="mt-1 text-xs leading-5">Accounts are unavailable in this preview. The account pages explain what is available; you can keep investigating without signing in.</p>}
  </div>;
}
