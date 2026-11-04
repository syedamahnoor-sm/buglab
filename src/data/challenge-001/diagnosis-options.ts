/*
 * Root-cause options shown to the learner for Challenge 001.
 * Public data: the order is fixed and nothing here indicates which option
 * is correct. Correctness lives only in answer-key.server.ts.
 */
import type { RootCauseOption } from "@/types/diagnosis";

export const rootCauseOptions: RootCauseOption[] = [
  {
    id: "cookie-not-sent",
    label: "The browser isn't sending the session cookie",
    description:
      "Cookie attributes such as Secure or SameSite stop the browser from attaching the cookie to API requests.",
  },
  {
    id: "session-expires-early",
    label: "Sessions expire almost immediately",
    description:
      "A TTL or unit mismatch makes sessions expire before the dashboard's requests arrive.",
  },
  {
    id: "signed-cookie-read-as-unsigned",
    label: "Login issues a signed cookie, but the middleware looks for an unsigned one",
    description:
      "The session ID is stored in one cookie collection at login and looked up in another during authentication.",
  },
  {
    id: "session-store-lost",
    label: "The in-memory session store loses sessions between requests",
    description:
      "Sessions are created at login, but a restart or a second instance means they are gone when later requests arrive.",
  },
  {
    id: "fetch-missing-credentials",
    label: "The dashboard's fetch calls omit credentials",
    description:
      "The fetch options in the dashboard script tell the browser not to attach cookies to API requests.",
  },
];
