"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { accountInitials, type AccountState } from "@/lib/account/model";
import { accountApi, useOptionalAccount } from "./AccountProvider";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const item = `block rounded-lg px-3 py-2.5 text-sm hover:bg-surface-raised ${focus}`;

export function AccountNav() {
  const context = useOptionalAccount();
  if (!context) return null;
  const key = context.state.status === "authenticated" ? context.state.session.user.id : context.state.status;
  return <AccountControls key={key} state={context.state} changed={context.changed} />;
}

function AccountControls({ state, changed }: { state: AccountState; changed: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const signedIn = state.status === "authenticated";
  const unavailable = state.status === "unavailable" || state.status === "error";
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  async function signOut() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await accountApi.signOut();
      if (!result.ok) { setError("We could not sign you out. Please try again."); return; }
      await changed();
      if (pathname.startsWith("/account")) router.replace("/login");
      router.refresh();
    } catch { setError("We could not reach the account service. Please try again."); }
    finally { setBusy(false); }
  }
  return <div ref={wrapper} className="relative shrink-0" onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    {!signedIn && state.status === "anonymous" && <nav aria-label="Account actions" className="hidden items-center gap-2 xl:flex">
      <Link href="/login" className={`rounded-lg px-3 py-2 text-sm text-accent hover:bg-accent/10 ${focus}`}>Sign in</Link>
      <Link href="/signup" className={`rounded-lg border border-accent/35 bg-accent/10 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/20 ${focus}`}>Sign up</Link>
    </nav>}
    <button ref={trigger} type="button" disabled={state.status === "loading"} aria-label={signedIn ? "Your account menu" : "Account menu"} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen((value) => !value)}
      className={`grid size-9 place-items-center rounded-full border border-accent/35 bg-accent/10 text-xs font-semibold text-accent hover:bg-accent/20 ${!signedIn && state.status === "anonymous" ? "xl:hidden" : ""} ${focus}`}>
      {signedIn ? accountInitials(state.session.user) : <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>}
    </button>
    {open && <nav id={id} aria-label="Account options" className="absolute right-0 top-full z-50 mt-3 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-border-strong bg-surface p-2 text-foreground shadow-card-hover">
      {signedIn ? <>
        <p className="break-all border-b border-border px-3 py-3 text-xs text-muted">Signed in as {state.session.user.email}</p>
        <Link href="/account/profile" className={item} onClick={() => setOpen(false)}>Profile</Link>
        <Link href="/account/security" className={item} onClick={() => setOpen(false)}>Account Security</Link>
        <button type="button" disabled={busy} onClick={signOut} className={`${item} w-full text-left text-danger disabled:opacity-50`}>{busy ? "Signing out…" : "Sign out"}</button>
        {error && <p role="alert" className="px-3 py-2 text-xs leading-5 text-danger">{error}</p>}
      </> : <>
        {unavailable && <p className="border-b border-border px-3 py-3 text-xs leading-5 text-muted"><strong className="block text-foreground">Accounts unavailable</strong>Sign-in and registration are not connected here. These pages explain the current status. You can still explore every challenge.</p>}
        {state.status === "loading" && <p role="status" className="px-3 py-2 text-xs text-muted">Checking account availability…</p>}
        <Link href="/login" className={item} onClick={() => setOpen(false)}>Sign in</Link>
        <Link href="/signup" className={item} onClick={() => setOpen(false)}>Sign up</Link>
      </>}
    </nav>}
  </div>;
}
