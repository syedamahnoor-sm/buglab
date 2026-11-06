"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useOptionalAccount } from "@/components/account/AccountProvider";
import { buttonPrimary, buttonSecondary, card } from "@/components/journal/ui";
import { AUTH_ROUTES } from "@/lib/account/routes";
import { dismissGuestReminder, guestReminderDismissed, GUEST_REMINDER_DISMISSAL_KEY } from "@/lib/guest-reminder";

export function GuestAccountReminder() {
  const account = useOptionalAccount();
  const headingId = useId();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    const read = () => setDismissed(guestReminderDismissed());
    queueMicrotask(read);
    const onStorage = (event: StorageEvent) => {
      if (event.key === GUEST_REMINDER_DISMISSAL_KEY || event.key === null) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (account?.state.status !== "anonymous" || dismissed !== false) return null;

  const dismiss = () => {
    setDismissed(true);
    dismissGuestReminder();
  };

  return (
    <aside aria-labelledby={headingId} className={`${card} border-accent/25 bg-accent/5 p-6 sm:p-8`}>
      <h2 id={headingId} className="text-lg font-semibold tracking-tight text-foreground">Keep your debugging streak going!</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        Create a free account to start building your learning profile and prepare to track your daily progress across sessions.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted">Your progress and streak stay in this browser for now.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href={AUTH_ROUTES.signUp} className={buttonPrimary}>Create account</Link>
        <button type="button" onClick={dismiss} className={buttonSecondary}>Maybe later</button>
      </div>
    </aside>
  );
}
