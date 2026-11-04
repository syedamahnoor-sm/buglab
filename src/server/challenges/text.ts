/*
 * Safe text for error messages. Server-only.
 *
 * A validation message repeats values an author typed: an id, a path, a source name. Those
 * values are not trusted. Left raw, a value could be megabytes long, could contain a newline
 * and so forge a second log line, could contain terminal escape codes, or could be an object
 * whose toString() throws while the message is being built.
 *
 * Everything here is total: it never throws, returns a single line, and is bounded.
 */
import "server-only";

const MAX_SHOWN = 60;
const MAX_REASON = 200;

// C0 and C1 control characters (including newline and the escape character) and the two Unicode line separators.
const LINE_BREAKING = new RegExp(`[\u0000-\u001f\u007f-\u009f${String.fromCharCode(0x2028, 0x2029)}]`, "g");

function escapeControls(text: string): string {
  return text.replace(LINE_BREAKING, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** What a value looks like in a message. Never calls into the value, so it cannot throw or run author code. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "symbol") return "a symbol";
  if (typeof value === "function") return "a function";
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "a list" : "an object";
  return String(value); // number, bigint, boolean, undefined, null
}

/** One line, at most 60 characters of the value, control characters escaped. No quotes. */
export function safe(value: unknown): string {
  return escapeControls(truncate(textOf(value), MAX_SHOWN));
}

/** Like safe(), in double quotes, so an empty or padded value is visible as such. */
export function shown(value: unknown): string {
  return escapeControls(JSON.stringify(truncate(textOf(value), MAX_SHOWN)));
}

/** The message of a caught error, as one bounded line. Accepts anything that was thrown. */
export function reasonOf(error: unknown): string {
  let message = "unknown error";
  try {
    if (error instanceof Error && typeof error.message === "string") message = error.message;
  } catch {
    // A message getter that throws leaves the default.
  }
  return escapeControls(truncate(message, MAX_REASON));
}
