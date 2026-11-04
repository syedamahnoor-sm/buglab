/*
 * Sign-up input handling. Server-only.
 *
 * A registration request may carry only an email and a display name. Anything
 * else (a role, an "isAdmin" flag, permissions, an id) is dropped, never
 * applied: public registration always creates a learner.
 */
import "server-only";
import type { RegistrationInput, Role } from "./types";

export const REGISTRATION_ROLE: Role = "learner";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MAX_NAME = 80;

export type RegistrationParse =
  | { ok: true; input: RegistrationInput; role: Role; ignoredFields: string[] }
  | { ok: false; errors: { field: "email" | "displayName" | "body"; message: string }[] };

export function parseRegistration(body: unknown): RegistrationParse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "body", message: "must be a JSON object" }] };
  }
  const record = body as Record<string, unknown>;
  const errors: { field: "email" | "displayName" | "body"; message: string }[] = [];

  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > MAX_EMAIL) errors.push({ field: "email", message: "must be a valid email address" });

  let displayName: string | null = null;
  if (record.displayName !== undefined && record.displayName !== null) {
    if (typeof record.displayName !== "string" || record.displayName.trim().length > MAX_NAME) {
      errors.push({ field: "displayName", message: `must be text of at most ${MAX_NAME} characters` });
    } else {
      displayName = record.displayName.trim() || null;
    }
  }
  if (errors.length) return { ok: false, errors };

  const ignoredFields = Object.keys(record).filter((key) => key !== "email" && key !== "displayName").sort();
  return { ok: true, input: { email, displayName }, role: REGISTRATION_ROLE, ignoredFields };
}
