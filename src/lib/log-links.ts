import type { NetworkRequest } from "@/types/investigation";

/**
 * The server log line a request links to, if it has one and that line exists.
 * The link is optional, so a request may have none.
 */
export function linkedLogId(request: NetworkRequest, logIds: ReadonlySet<string>): string | undefined {
  const id = request.serverLogId;
  return id && logIds.has(id) ? id : undefined;
}

/**
 * Each linked log line's request, for "View in Network" from a log. Requests
 * without a log are skipped. Several requests may share one log line; the first
 * of them is its request.
 */
export function requestIdsByLogId(requests: readonly NetworkRequest[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const request of requests) {
    if (request.serverLogId && !map.has(request.serverLogId)) map.set(request.serverLogId, request.id);
  }
  return map;
}
