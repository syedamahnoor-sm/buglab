/*
 * Pure rules shared by every LearningLoopStore implementation: body normalization
 * and octet limits match the HTTP contract. No clock and no I/O.
 */
import "server-only";
import { LearningLoopStoreError } from "./types";

export const MAX_REFLECTION_BODY_BYTES = 16384;

/** Trims leading/trailing Unicode whitespace only; inner newlines are preserved. */
export function normalizeReflectionBody(raw: string): string {
  const body = raw.replace(/^\s+|\s+$/gu, "");
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes < 1 || bytes > MAX_REFLECTION_BODY_BYTES) {
    throw new LearningLoopStoreError("validation-failed", "Reflection body must be non-empty after trim and at most 16 KiB UTF-8.");
  }
  return body;
}
