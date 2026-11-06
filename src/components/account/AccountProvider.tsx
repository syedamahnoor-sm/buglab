"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createHttpAccountApi } from "@/lib/account/api";
import { ACCOUNT_LOADING, type AccountState, type AccountUser } from "@/lib/account/model";

export const accountApi = createHttpAccountApi();
interface AccountContextValue { state: AccountState; refresh: () => Promise<void>; changed: () => Promise<void>; updatedUser: (user: AccountUser) => void }
const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>(ACCOUNT_LOADING);
  const sequence = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setState(ACCOUNT_LOADING);
    const result = await accountApi.getSession();
    if (current !== sequence.current) return;
    if (result.ok) setState(result.data ? { status: "authenticated", session: result.data } : { status: "anonymous" });
    else if (result.error.kind === "unavailable" || result.error.status === 503) setState({ status: "unavailable" });
    else setState({ status: "error", problem: result.error.kind === "timeout" ? "timeout" : "network" });
  }, []);
  const changed = useCallback(async () => {
    channel.current?.postMessage("identity-changed");
    await refresh();
  }, [refresh]);
  const updatedUser = useCallback((user: AccountUser) => {
    setState((previous) => previous.status === "authenticated" && previous.session.user.id === user.id ? { ...previous, session: { ...previous.session, user } } : previous);
    channel.current?.postMessage("identity-changed");
  }, []);
  useEffect(() => {
    // Event callbacks avoid reading or persisting account credentials in JS.
    const reload = () => { if (document.visibilityState !== "hidden") void refresh(); };
    queueMicrotask(reload);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("buglab-account");
      channel.current.onmessage = reload;
    }
    return () => { window.removeEventListener("focus", reload); document.removeEventListener("visibilitychange", reload); channel.current?.close(); };
  }, [refresh]);
  useEffect(() => {
    if (state.status !== "authenticated") return;
    const remaining = Date.parse(state.session.expiresAt) - Date.now();
    const timer = window.setTimeout(() => { void refresh(); }, Math.max(0, Math.min(remaining, 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [state, refresh]);
  return <AccountContext.Provider value={{ state, refresh, changed, updatedUser }}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) throw new Error("AccountProvider is required.");
  return context;
}

export function useOptionalAccount() { return useContext(AccountContext); }
