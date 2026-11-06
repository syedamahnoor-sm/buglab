"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { accountName } from "@/lib/account/model";
import type { AccountSessionSummary } from "@/lib/account/contract";
import { LINK_MESSAGES } from "@/lib/account/link";
import { validatePasswordChange, checkDisplayName } from "@/lib/account/validation";
import { accountApi, useAccount } from "./AccountProvider";
import { AccountFrame, AccountNotice, accountErrorMessage, buttonClass, fieldClass, linkClass } from "./ui";

export function AccountDashboard({ section = "overview" }: { section?: "overview" | "profile" | "security" | "link" }) {
  const { state, refresh } = useAccount();
  // Unmount account-scoped forms and caches as soon as identity is uncertain.
  // A new account always receives a new component instance, including across tabs.
  if (state.status !== "authenticated") return <AccountFrame title="Your account" description="Your identity, preferences and security in one place.">{state.status === "loading" ? <p role="status" className="text-sm text-muted">Restoring your session…</p> : <AccountNotice>Your session could not be restored. <Link className={linkClass} href="/login?next=%2Faccount">Sign in again</Link> or <button className={linkClass} onClick={() => void refresh()}>retry</button>.</AccountNotice>}</AccountFrame>;
  return <AuthenticatedDashboard key={state.session.user.id} section={section} />;
}

function AuthenticatedDashboard({ section }: { section: "overview" | "profile" | "security" | "link" }) {
  const { state, changed, refresh, updatedUser } = useAccount();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AccountSessionSummary[] | null>(null);
  const [consent, setConsent] = useState(false);
  const [linking, setLinking] = useState<"loading" | "unavailable" | "offer" | "none" | "linked">("loading");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const accountId = state.status === "authenticated" ? state.session.user.id : null;
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    if (section === "security") accountApi.listSessions(controller.signal).then((result) => {
      if (!controller.signal.aborted) { if (result.ok) setSessions(result.data); else setError(accountErrorMessage(result.error.kind)); }
    }).catch(() => { /* caller aborted on identity change */ });
    if (section === "link") accountApi.getLinkStatus(controller.signal).then((result) => {
      if (!controller.signal.aborted) setLinking(result.ok ? result.data.account === "linked" ? "linked" : result.data.browserLearner === "present" ? "offer" : "none" : "unavailable");
    }).catch(() => { /* caller aborted on identity change */ });
    return () => controller.abort();
  }, [accountId, section]);

  async function run(action: () => Promise<{ ok: boolean; error?: { kind: string } }>, success: string) {
    setBusy(true); setMessage(""); setError("");
    try { const result = await action(); if (!result.ok) { setError(accountErrorMessage(result.error?.kind ?? "server")); return false; } setMessage(success); return true; } catch { setError(accountErrorMessage("network")); return false; } finally { setBusy(false); }
  }
  async function signOut() {
    if (await run(() => accountApi.signOut(), "Signed out.")) { await changed(); router.replace("/login"); router.refresh(); }
  }
  async function profile(event: FormEvent) {
    event.preventDefault();
    const value = name ?? (state.status === "authenticated" ? state.session.user.displayName ?? "" : "");
    if (checkDisplayName(value)) { setError("Use at most 80 characters for your name."); return; }
    if (await run(async () => { const result = await accountApi.updateProfile({ displayName: value.trim() || null }); if (result.ok) updatedUser(result.data); return result; }, "Your profile is saved.")) router.refresh();
  }
  async function password(event: FormEvent) {
    event.preventDefault();
    const errors = validatePasswordChange({ currentPassword, newPassword, confirmation });
    if (Object.keys(errors).length) { setError(Object.values(errors)[0]!); return; }
    if (await run(() => accountApi.changePassword({ currentPassword, newPassword }), "Your password is updated. Other sessions have been signed out.")) { setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setSessions((items) => items?.filter((item) => item.current) ?? null); }
  }
  async function link() {
    if (!consent) return;
    setBusy(true); setError("");
    try { const result = await accountApi.linkBrowserHistory(true); if (result.ok) { setMessage(`${LINK_MESSAGES[result.data].title}. ${LINK_MESSAGES[result.data].body}`); if (result.data === "linked" || result.data === "already-linked") setLinking("linked"); } else setError(accountErrorMessage(result.error.kind)); } catch { setError(accountErrorMessage("network")); } finally { setBusy(false); }
  }
  const titles = { overview: "Your account", profile: "Make it yours", security: "Keep your account secure", link: "Your learning history" };
  return <AccountFrame title={titles[section]} description="Your identity, preferences and security in one place.">
    {state.status === "loading" ? <p role="status" className="text-sm text-muted">Restoring your session…</p> : state.status !== "authenticated" ? <AccountNotice>Your session could not be restored. <Link className={linkClass} href="/login?next=%2Faccount">Sign in again</Link> or <button className={linkClass} onClick={() => void refresh()}>retry</button>.</AccountNotice> : <div key={state.session.user.id} className="space-y-6">
      <nav aria-label="Account" className="flex flex-wrap gap-x-4 gap-y-3 border-b border-border pb-4">{([["overview", "/account", "Overview"], ["profile", "/account/profile", "Profile"], ["security", "/account/security", "Security"], ["link", "/account/link", "History"]] as const).map(([key, href, label]) => <Link key={key} href={href} aria-current={section === key ? "page" : undefined} className={`${linkClass} ${section === key ? "font-semibold underline" : ""}`}>{label}</Link>)}</nav>
      {error && <AccountNotice danger>{error}</AccountNotice>}{message && <AccountNotice>{message}</AccountNotice>}
      {section === "overview" && <><div><h2 className="text-lg font-semibold">Good to see you, {accountName(state.session.user)}</h2><p className="mt-2 break-all text-sm text-muted">{state.session.user.email}</p><p className="mt-2 text-xs text-success">Verified email · {state.session.user.role === "admin" ? "Administrator" : "Learner"}</p></div><AccountNotice>Your account is ready. Journal entries, recall reviews and browser-recorded solves stay in this browser. Server-recorded history can be attached only through an explicit history link when the shared learning service is connected.</AccountNotice><div className="flex flex-wrap gap-3"><Link href="/challenges" className={buttonClass}>Continue investigating</Link><Link href="/progress" className={linkClass}>Learning Progress →</Link></div></>}
      {section === "profile" && <form onSubmit={profile} className="space-y-5"><div><label htmlFor="profile-email" className="text-sm font-medium">Email address</label><input id="profile-email" className={fieldClass} value={state.session.user.email} readOnly /><p className="mt-2 text-xs text-subtle">Email changes are not available here.</p></div><div><label htmlFor="profile-name" className="text-sm font-medium">Display name</label><input id="profile-name" autoComplete="nickname" value={name ?? state.session.user.displayName ?? ""} onChange={(e) => setName(e.target.value)} maxLength={80} className={fieldClass} /></div><button disabled={busy} className={buttonClass}>{busy ? "Saving…" : "Save profile"}</button></form>}
      {section === "security" && <><section aria-labelledby="password-heading"><h2 id="password-heading" className="font-semibold">Password</h2>{state.session.user.signInMethods.includes("password") ? <form onSubmit={password} className="mt-4 space-y-4"><div><label htmlFor="current-password" className="text-sm">Current password</label><input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={fieldClass} /></div><div><label htmlFor="new-password" className="text-sm">New password</label><input id="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={fieldClass} /></div><div><label htmlFor="confirm-password" className="text-sm">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={fieldClass} /></div><p className="text-xs text-muted">12–128 characters. Updating your password signs out other sessions.</p><button disabled={busy} className={buttonClass}>Update password</button></form> : <p className="mt-3 text-sm text-muted">You sign in with Google. Manage your password through Google.</p>}</section><section className="border-t border-border pt-5" aria-labelledby="sessions-heading"><h2 id="sessions-heading" className="font-semibold">Signed-in sessions</h2><p className="mt-2 text-xs text-muted">Sign out any session you don’t recognize. Session credentials are never shown.</p>{sessions ? <ul className="mt-4 space-y-3">{sessions.map((session) => <li key={session.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"><div className="text-sm"><p>{session.current ? "This session" : "Another session"}</p><p className="mt-1 text-xs text-muted">Started {new Date(session.createdAt).toLocaleDateString()}</p></div>{!session.current && <button disabled={busy} className={linkClass} onClick={async () => { if (await run(() => accountApi.revokeSession(session.id), "Session signed out.")) setSessions((items) => items?.filter((item) => item.id !== session.id) ?? null); }}>Sign out</button>}</li>)}</ul> : <p role="status" className="mt-3 text-sm text-muted">Reload this page to refresh your sessions.</p>}<button disabled={busy} className={`${buttonClass} mt-4`} onClick={() => void run(() => accountApi.revokeOtherSessions(), "Other sessions have been signed out.").then((ok) => { if (ok) setSessions((items) => items?.filter((item) => item.current) ?? null); })}>Sign out other sessions</button></section></>}
      {section === "link" && <><AccountNotice>Only history recorded by BugLab’s server can be linked. Browser-local solves, Journal entries and recall reviews are never imported as verified completions. Two histories are never merged.</AccountNotice>{linking === "loading" ? <p role="status" className="text-sm text-muted">Checking your history…</p> : linking === "unavailable" ? <AccountNotice>The shared learning service is not connected yet. Linking is unavailable; your existing history is unchanged.</AccountNotice> : linking === "linked" ? <AccountNotice>Your account already has its own learning history. Other anonymous histories stay separate.</AccountNotice> : linking === "none" ? <AccountNotice>There is no live server-recorded anonymous history in this browser to attach.</AccountNotice> : <div className="space-y-4"><label className="flex gap-3 text-sm leading-6"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 shrink-0 accent-accent" />I want to attach this browser’s server-recorded learning history to my account. This history cannot be transferred to another account.</label><button disabled={!consent || busy} className={buttonClass} onClick={link}>{busy ? "Linking…" : "Link server-recorded history"}</button></div>}</>}
      <div className="border-t border-border pt-5"><button type="button" onClick={signOut} disabled={busy} className="rounded text-sm font-medium text-danger underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-danger">Sign out of BugLab</button></div>
    </div>}
  </AccountFrame>;
}
