"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { safeReturnPath, takeFragmentToken, withReturn } from "@/lib/account/routes";
import { validateSignUp, validateSignIn, validateReset, checkEmail, normaliseEmail } from "@/lib/account/validation";
import { accountApi, useAccount } from "./AccountProvider";
import { AccountFrame, AccountNotice, accountErrorMessage, buttonClass, fieldClass, linkClass } from "./ui";

export type AuthMode = "login" | "signup" | "verify-email" | "forgot-password" | "reset-password";
const content: Record<AuthMode, [string, string, string]> = {
  login: ["Welcome back", "Pick up your investigations with your BugLab account.", "Sign in"],
  signup: ["Make room for better debugging", "Create your account. Your browser history stays separate unless you explicitly choose to link it.", "Create account"],
  "verify-email": ["Verify your email", "Confirm that this email address belongs to you before signing in.", "Verify email"],
  "forgot-password": ["Find your way back", "Enter your email and we’ll send a link to choose a new password.", "Send reset link"],
  "reset-password": ["A fresh start", "Choose a strong password you don’t use anywhere else. Resetting it signs out existing sessions.", "Reset password"],
};

export function AuthForm({ mode }: { mode: AuthMode }) {
  const params = useSearchParams();
  const next = safeReturnPath(params.get("next")) ?? "/account";
  const { changed } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<{ available: boolean; google: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const tokenRead = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/account/capabilities", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) return { available: false, google: false };
      return response.json();
    }).then(setCapabilities).catch(() => { if (!controller.signal.aborted) setCapabilities({ available: false, google: false }); });
    if (!tokenRead.current && (mode === "verify-email" || mode === "reset-password")) {
      tokenRead.current = true;
      const value = takeFragmentToken(window.location, (url) => window.history.replaceState(null, "", url), window.location.pathname + window.location.search);
      queueMicrotask(() => setToken(value));
    }
    return () => controller.abort();
  }, [mode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(""); setSuccess("");
    const fields = mode === "signup" ? validateSignUp({ email, password, confirmation, displayName }) : mode === "login" ? validateSignIn({ email, password }) : mode === "reset-password" ? validateReset({ password, confirmation }) : mode === "forgot-password" ? (checkEmail(email) ? { email: checkEmail(email)! } : {}) : {};
    setErrors(fields);
    const first = Object.keys(fields)[0];
    if (first) { form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus(); return; }
    if ((mode === "verify-email" || mode === "reset-password") && !token) { setError("Open the complete link from your email, or request a new one below."); return; }
    setBusy(true);
    try {
      const result = mode === "signup" ? await accountApi.signUp({ email: normaliseEmail(email), password, displayName: displayName.trim() || null }) : mode === "login" ? await accountApi.signIn({ email: normaliseEmail(email), password }) : mode === "verify-email" ? await accountApi.verifyEmail(token!) : mode === "forgot-password" ? await accountApi.requestPasswordReset(normaliseEmail(email)) : await accountApi.resetPassword({ token: token!, password });
      if (!result.ok) { setError(accountErrorMessage(result.error.kind)); if (result.error.fields) setErrors(result.error.fields as Record<string, string>); return; }
      setPassword(""); setConfirmation("");
      if (mode === "login") { await changed(); window.location.assign(next); return; }
      if (mode === "verify-email" || mode === "reset-password") setToken(null);
      setSuccess(mode === "signup" ? "Check your inbox. If this address can be registered, you’ll receive a verification link. The link expires in one hour." : mode === "forgot-password" ? "If an account exists for that address, a reset link is on its way. It expires in 30 minutes." : mode === "verify-email" ? "Your email is verified. You can now sign in." : "Your password has been reset. Sign in with your new password.");
    } catch { setError(accountErrorMessage("network")); } finally { setBusy(false); }
  }
  async function resend() {
    if (checkEmail(email)) { setErrors({ email: checkEmail(email)! }); form.current?.querySelector<HTMLInputElement>('[name="email"]')?.focus(); return; }
    setBusy(true); setError("");
    try { const result = await accountApi.resendVerification(normaliseEmail(email)); if (result.ok) setSuccess("If verification is needed for this address, a fresh link is on its way."); else setError(accountErrorMessage(result.error.kind)); } catch { setError(accountErrorMessage("network")); } finally { setBusy(false); }
  }
  async function google() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account/oauth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ next }), credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok || typeof data.url !== "string") throw new Error();
      const destination = new URL(data.url);
      if (destination.protocol !== "https:" || destination.hostname !== "accounts.google.com") throw new Error();
      window.location.assign(destination.href);
    } catch { setError("Google sign-in could not start. Please try again or use your email."); setBusy(false); }
  }
  const [title, description, action] = content[mode];
  const emailField = mode === "signup" || mode === "login" || mode === "forgot-password";
  const passwordField = mode === "signup" || mode === "login" || mode === "reset-password";
  const tokenMode = mode === "verify-email" || mode === "reset-password";
  function fieldError(name: string) { return errors[name] ? <p id={`${name}-error`} className="mt-2 text-sm text-danger">{errors[name]}</p> : null; }
  return <AccountFrame title={title} description={description}>
    {capabilities === null ? <p role="status" className="text-sm text-muted">Connecting securely…</p> : !capabilities.available ? <AccountNotice>Accounts are not available in this deployment yet. You can continue exploring challenges; your browser learning history is unchanged.</AccountNotice> : <>
      {params.get("verified") === "1" && <AccountNotice>Your email is verified. Sign in to continue.</AccountNotice>}
      {params.get("error") && <AccountNotice danger>Sign-in could not be completed. Please try again.</AccountNotice>}
      {success && <div className="mb-5"><AccountNotice>{success}</AccountNotice></div>}
      {error && <div className="mb-5"><AccountNotice danger>{error}</AccountNotice></div>}
      {!(success && tokenMode) && <form ref={form} onSubmit={submit} noValidate className="space-y-5" aria-busy={busy}>
        <fieldset disabled={busy} className="space-y-5">
          {mode === "signup" && <div><label htmlFor="displayName" className="text-sm font-medium">Display name <span className="font-normal text-subtle">(optional)</span></label><input id="displayName" name="displayName" autoComplete="nickname" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={fieldClass} />{fieldError("displayName")}</div>}
          {emailField && <div><label htmlFor="email" className="text-sm font-medium">Email address</label><input id="email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} className={fieldClass} />{fieldError("email")}</div>}
          {passwordField && <div><label htmlFor="password" className="text-sm font-medium">{mode === "reset-password" ? "New password" : "Password"}</label><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} required maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "password-error" : mode !== "login" ? "password-help" : undefined} className={fieldClass} />{fieldError("password")}{mode !== "login" && <p id="password-help" className="mt-2 text-xs text-subtle">12–128 characters. A long, unique passphrase works well.</p>}<label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} className="size-4 accent-accent" />Show password</label></div>}
          {(mode === "signup" || mode === "reset-password") && <div><label htmlFor="confirmation" className="text-sm font-medium">Confirm password</label><input id="confirmation" name="confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} aria-invalid={Boolean(errors.confirmation)} aria-describedby={errors.confirmation ? "confirmation-error" : undefined} className={fieldClass} />{fieldError("confirmation")}</div>}
          {tokenMode && !token && <AccountNotice>Open the complete link from your email. If it has expired, request a new email below.</AccountNotice>}
          <button type="submit" disabled={busy || (tokenMode && !token)} className={`${buttonClass} w-full`}>{busy ? "Please wait…" : action}</button>
        </fieldset>
      </form>}
      {(mode === "signup" || mode === "login") && capabilities.google && <button type="button" disabled={busy} onClick={google} className={`${buttonClass} mt-3 w-full`}>Continue with Google</button>}
      {mode === "login" && <div className="mt-4 flex flex-wrap justify-between gap-3"><Link href="/forgot-password" className={linkClass}>Forgot password?</Link><button type="button" onClick={resend} disabled={busy} className={linkClass}>Resend verification</button></div>}
    </>}
    <div className="mt-7 border-t border-border pt-5 text-sm text-muted">{mode === "login" ? <>New to BugLab? <Link href={withReturn("/signup", next)} className={linkClass}>Create an account</Link></> : mode === "signup" ? <>Already have an account? <Link href={withReturn("/login", next)} className={linkClass}>Sign in</Link></> : <div className="flex flex-wrap gap-4"><Link href="/login" className={linkClass}>Back to sign in</Link>{mode === "reset-password" && <Link href="/forgot-password" className={linkClass}>Request a new reset link</Link>}{mode === "verify-email" && <Link href="/login" className={linkClass}>Request a new verification email</Link>}</div>}</div>
  </AccountFrame>;
}
