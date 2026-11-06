/** A UI preference only; never reads or changes the browser's learning record. */
export const GUEST_REMINDER_DISMISSAL_KEY = "buglab.guest-account-reminder.dismissed.v1";

export function guestReminderDismissed(): boolean {
  try { return window.localStorage.getItem(GUEST_REMINDER_DISMISSAL_KEY) === "1"; }
  catch { return false; }
}

export function dismissGuestReminder(): void {
  try { window.localStorage.setItem(GUEST_REMINDER_DISMISSAL_KEY, "1"); }
  catch { /* The caller still dismisses for this visit when storage is blocked. */ }
}
