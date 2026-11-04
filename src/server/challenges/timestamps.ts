/*
 * Timestamp rules for a challenge definition. Server-only.
 *
 * What the existing contract is. A log line and a network request each carry `timestamp`, and
 * the scenario carries one `incidentDate`, "the UTC date (YYYY-MM-DD) that log and network
 * timestamps belong to" (src/types/workspace.ts). Challenge 001 writes every timestamp as a UTC
 * time of day with milliseconds, "09:14:02.117", and builds real instants from the pair
 * (`${INCIDENT_DATE}T${timestamp}Z` in src/data/challenge-001/network.ts).
 *
 * What is enforced. ISO 8601 UTC applies to that pair: `incidentDate` must be a real calendar
 * date (fields.ts) and `timestamp` must be a real UTC time of day written HH:mm:ss.SSS, so
 * `${incidentDate}T${timestamp}Z` is always a valid ISO 8601 UTC instant, such as
 * 2026-10-30T09:14:02.117Z. The time zone is not written per timestamp because the contract says
 * the whole scenario is UTC, so there is exactly one reading of every value. This is approved.
 *
 * What is NOT done here. The public wire format is not changed to carry full instants. That would
 * change the shared WorkspaceScenario contract, Challenge 001's data and how the console renders a
 * time, all of which belong to Syeda.
 *
 * There are deliberately NO rules between records (approved). A request's timestamp need not equal
 * the timestamp of the log line it links to, log lines may be in any time order, and a request's
 * duration is not compared with any log text. How a request links to a log (optional, many requests
 * to one log, and a supplied link must resolve) is validate.ts.
 */
import "server-only";
import { shown } from "./text";

/** 00:00:00.000 to 23:59:59.999. A leap second (23:59:60) is not a valid ISO 8601 UTC instant in JavaScript, so it is refused. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}$/;

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_OF_DAY.test(value);
}

/** The message for a timestamp that is not a UTC time of day, or null when it is one. */
export function timestampProblem(owner: Record<string, unknown>, at: string): string | null {
  const value = owner.timestamp;
  if (isTimeOfDay(value)) return null;
  return (
    `${at}.timestamp must be a UTC time of day written HH:mm:ss.SSS, such as 09:14:02.117 ` +
    `(with scenario.incidentDate it forms an ISO 8601 UTC instant), not ${shown(value)}`
  );
}
