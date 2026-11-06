import { Suspense } from "react";
import { AuthForm } from "@/components/account/AuthForm";

export const metadata = { title: "BugLab · login", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function Page() {
  return <Suspense fallback={<main className="p-8" role="status">Loading your account…</main>}><AuthForm mode="login" /></Suspense>;
}
