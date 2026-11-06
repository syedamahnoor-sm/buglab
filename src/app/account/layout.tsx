import "server-only";
import { Suspense, type ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccountRuntime } from "@/server/account/engine";
import { readAccountSession } from "@/server/account/session";
import { AccountFrame, AccountNotice } from "@/components/account/ui";

export const metadata = { title: "BugLab · Your account", robots: { index: false, follow: false } };

async function ProtectedAccount({ children }: { children: ReactNode }) {
  // Request-time work sits behind Suspense; never cache authentication.
  const requestHeaders = await headers();
  let session;
  let unavailable = false;
  try {
    const runtime = getAccountRuntime();
    if (runtime) session = await readAccountSession(runtime, new Headers(requestHeaders));
    else unavailable = true;
  } catch { unavailable = true; }
  if (unavailable) return <AccountFrame title="Account temporarily unavailable" description="Accounts are not connected or could not be reached."><AccountNotice>Please try again shortly. Your browser learning history is unchanged.</AccountNotice></AccountFrame>;
  if (!session) redirect("/login?next=%2Faccount");
  return children;
}
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="p-8" role="status">Checking your session…</main>}><ProtectedAccount>{children}</ProtectedAccount></Suspense>;
}
