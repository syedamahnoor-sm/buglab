/*
 * Builds the learner-visible view of a challenge. Server-only.
 *
 * Every field is copied by name. There is no spread of a definition or a scenario,
 * so a field added to either, however secret, stays out of the public view until
 * someone adds it here on purpose. The result is a deep copy (plain-data.ts), then frozen:
 * it shares no object with the authored data, so neither can reach the other, and the
 * freezing never touches an object the author owns.
 *
 * The result is a WorkspaceScenario, unchanged: the public contract is still under
 * review and this module does not define a new one.
 */
import "server-only";
import type { HttpHeader, NetworkRequest } from "@/types/investigation";
import type { WorkspaceScenario } from "@/types/workspace";
import { clonePlainData } from "./plain-data";

/** The key is present only when the value is, so an optional field never appears as `undefined`. */
function present<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

function copyHeaders(headers: readonly HttpHeader[]): HttpHeader[] {
  return headers.map((header) => ({ name: header.name, value: header.value }));
}

function copyRequest(request: NetworkRequest): NetworkRequest {
  // `serverLogId` is optional here by decision (a request may have no linked log), but the shared type
  // NetworkRequest still declares it required, so the object is asserted back to that type. The key is
  // simply absent when the request has no log. See docs/architecture/learner-session-foundation.md, 8.7.
  return {
    id: request.id,
    timestamp: request.timestamp,
    method: request.method,
    url: request.url,
    path: request.path,
    status: request.status,
    statusText: request.statusText,
    type: request.type,
    durationMs: request.durationMs,
    ...present("initiator", request.initiator),
    ...present("serverLogId", request.serverLogId),
    requestHeaders: copyHeaders(request.requestHeaders),
    ...present("requestBody", request.requestBody),
    responseHeaders: copyHeaders(request.responseHeaders),
    ...present("responseBody", request.responseBody),
  } as NetworkRequest;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function toPublicChallenge(scenario: WorkspaceScenario): WorkspaceScenario {
  const { challenge } = scenario;
  const named: WorkspaceScenario = {
    contractVersion: scenario.contractVersion,
    challenge: {
      id: challenge.id,
      number: challenge.number,
      title: challenge.title,
      incident: challenge.incident,
      difficulty: challenge.difficulty,
      completion: challenge.completion,
      tags: challenge.tags,
      estimatedMinutes: challenge.estimatedMinutes,
    },
    files: scenario.files.map((file) => ({ path: file.path, content: file.content })),
    incidentDate: scenario.incidentDate,
    logs: scenario.logs.map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      level: entry.level,
      source: entry.source,
      message: entry.message,
    })),
    network: scenario.network.map(copyRequest),
    rootCauseOptions: scenario.rootCauseOptions.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
    })),
    entryFilePath: scenario.entryFilePath,
  };

  // `named` still points at the author's nested objects (tags, for one). One deep copy removes
  // every such link, so freezing the result never freezes anything the author owns, and a value
  // that is not plain data is refused here instead of being aliased or breaking serialization later.
  return deepFreeze(clonePlainData(named, "public view"));
}
