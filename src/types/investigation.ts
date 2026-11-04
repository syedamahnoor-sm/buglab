export interface HttpHeader {
  name: string;
  value: string;
}

export type NetworkRequestType = "document" | "script" | "fetch" | "ping";

/** One browser-side request captured during the incident, DevTools style. */
export interface NetworkRequest {
  id: string;
  /** Time the response completed; equals the matching server log timestamp. */
  timestamp: string;
  method: "GET" | "POST";
  url: string;
  path: string;
  status: number;
  statusText: string;
  type: NetworkRequestType;
  /** Total browser time; always >= the server-logged duration. */
  durationMs: number;
  /** Scenario file that triggered the request, if it is part of the scenario. */
  initiator?: string;
  /**
   * ID of the server log line written for this request, if it has one. Several
   * requests may share a log line.
   */
  serverLogId?: string;
  requestHeaders: HttpHeader[];
  requestBody?: string;
  responseHeaders: HttpHeader[];
  /** Plain text only. Always rendered as text, never as HTML. */
  responseBody?: string;
}

export type EvidenceRef =
  | { kind: "log"; logId: string }
  | { kind: "network"; requestId: string };

export interface EvidenceItem {
  /** Derived from the ref, so the same source can only be collected once. */
  id: string;
  ref: EvidenceRef;
  note: string;
  addedAt: number;
}

export type HypothesisStatus = "open" | "supported" | "ruled-out";

export interface Hypothesis {
  id: string;
  text: string;
  status: HypothesisStatus;
  createdAt: number;
}

export interface Observation {
  id: string;
  text: string;
  createdAt: number;
}
