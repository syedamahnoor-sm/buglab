/*
 * Client-side checks for the account forms. Browser-safe and pure.
 *
 * These exist to give fast, specific feedback. They are never the authority:
 * the server validates every field again and its answer wins. The email and
 * display-name rules match parseRegistration (src/server/auth/registration.ts)
 * so the browser never accepts what the server would refuse. The password
 * policy matches the configured Better Auth boundary: length limits with no
 * composition rules. Server validation and provider hashing remain authoritative.
 */

export const EMAIL_MAX = 254;
export const DISPLAY_NAME_MAX = 80;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function checkEmail(value: string): string | null {
  const email = normaliseEmail(value);
  if (!email) return "Enter your email address.";
  if (email.length > EMAIL_MAX || !EMAIL.test(email)) return "Enter a valid email address, like name@example.com.";
  return null;
}

/** For a NEW password: the policy applies. */
export function checkNewPassword(value: string): string | null {
  if (!value) return "Choose a password.";
  // Match the provider's UTF-16 length checks exactly; never accept a password
  // the provider will reject (including supplementary Unicode characters).
  const length = value.length;
  if (length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (value.trim() === "") return "A password can't be only spaces.";
  return null;
}

/** For an EXISTING password: only presence. Its rules were checked when it was set. */
export function checkCurrentPassword(value: string): string | null {
  return value ? null : "Enter your password.";
}

export function checkConfirmation(password: string, confirmation: string): string | null {
  if (!confirmation) return "Enter the password again.";
  return password === confirmation ? null : "The passwords don't match.";
}

export function checkDisplayName(value: string): string | null {
  return value.trim().length > DISPLAY_NAME_MAX ? `Use at most ${DISPLAY_NAME_MAX} characters.` : null;
}

/** A display name as sent: trimmed, or null when empty (it is optional). */
export function normaliseDisplayName(value: string): string | null {
  return value.trim() || null;
}

/** How strong a new password looks, for the meter. Advisory only. */
export type PasswordStrength = "empty" | "too-short" | "fair" | "strong";

export function passwordStrength(value: string): PasswordStrength {
  if (!value) return "empty";
  const length = [...value].length;
  if (length < PASSWORD_MIN) return "too-short";
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  return length >= 16 || (length >= PASSWORD_MIN && kinds >= 3) ? "strong" : "fair";
}

export interface SignUpValues {
  email: string;
  password: string;
  confirmation: string;
  displayName: string;
}

export function validateSignUp(values: SignUpValues): FieldErrors<keyof SignUpValues> {
  const errors: FieldErrors<keyof SignUpValues> = {};
  const email = checkEmail(values.email);
  if (email) errors.email = email;
  const password = checkNewPassword(values.password);
  if (password) errors.password = password;
  const confirmation = checkConfirmation(values.password, values.confirmation);
  if (confirmation) errors.confirmation = confirmation;
  const name = checkDisplayName(values.displayName);
  if (name) errors.displayName = name;
  return errors;
}

export function validateSignIn(values: { email: string; password: string }): FieldErrors<"email" | "password"> {
  const errors: FieldErrors<"email" | "password"> = {};
  const email = checkEmail(values.email);
  if (email) errors.email = email;
  const password = checkCurrentPassword(values.password);
  if (password) errors.password = password;
  return errors;
}

export function validateReset(values: { password: string; confirmation: string }): FieldErrors<"password" | "confirmation"> {
  const errors: FieldErrors<"password" | "confirmation"> = {};
  const password = checkNewPassword(values.password);
  if (password) errors.password = password;
  const confirmation = checkConfirmation(values.password, values.confirmation);
  if (confirmation) errors.confirmation = confirmation;
  return errors;
}

export function validatePasswordChange(values: {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}): FieldErrors<"currentPassword" | "newPassword" | "confirmation"> {
  const errors: FieldErrors<"currentPassword" | "newPassword" | "confirmation"> = {};
  const current = checkCurrentPassword(values.currentPassword);
  if (current) errors.currentPassword = current;
  const next = checkNewPassword(values.newPassword);
  if (next) errors.newPassword = next;
  else if (values.newPassword === values.currentPassword) errors.newPassword = "Choose a password different from your current one.";
  const confirmation = checkConfirmation(values.newPassword, values.confirmation);
  if (confirmation) errors.confirmation = confirmation;
  return errors;
}

/** The first field with an error, in the form's order, so focus can move to it. */
export function firstInvalid<K extends string>(order: readonly K[], errors: FieldErrors<K>): K | null {
  return order.find((key) => errors[key]) ?? null;
}
