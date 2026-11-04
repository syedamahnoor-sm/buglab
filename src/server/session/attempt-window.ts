/*
 * The default limit on incorrect diagnosis attempts. Server-only.
 *
 * The same numbers the diagnosis endpoint enforces today with its in-memory
 * limiter (three wrong attempts per ten minutes). Here the window is derived from
 * the recorded attempts, so it is exact and survives a restart once the store is
 * durable. The endpoint keeps its own limiter until it is integrated with the
 * session service, which needs Syeda's approval.
 *
 * Like the expiry values, the numbers live in one place: this file.
 */
import "server-only";
import type { AttemptWindow } from "./types";

export const DEFAULT_ATTEMPT_WINDOW: AttemptWindow = Object.freeze({
  limit: 3,
  windowMs: 10 * 60 * 1000,
});
