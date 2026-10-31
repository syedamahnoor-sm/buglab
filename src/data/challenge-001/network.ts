/*
 * Browser network capture for Challenge 001, as DevTools would show it.
 *
 * Consistency rules:
 * - Every request maps to one `[http]` line in logs.ts (serverLogId) with the
 *   same timestamp, method, path, and status.
 * - durationMs is browser time, so it is always >= the server-logged ms.
 * - Headers follow what Express 4 / serve-static / cookie-parser emit for the
 *   code in files.ts (production: Secure cookies over HTTPS).
 *
 * All session IDs, signatures, and the host are fictional.
 * Keep this neutral: raw captures only, no commentary.
 */
import type { HttpHeader, NetworkRequest } from "@/types/investigation";
import { scenarioFiles } from "./files";
import { INCIDENT_DATE } from "./logs";

const ORIGIN = "https://orders.acme.example";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// cookie-signature output (URL-encoded by res.cookie) for two fictional sessions.
const SESSION_A =
  "s%3A3f6c2a9e-8b1d-4e57-a0c4-9d2e71b5f308.gY%2FDZJuzzvl8PpLv38TYCVTEhSA%2FK9A3P6NBG3C4KJQ";
const SESSION_B =
  "s%3Ab81e4d07-52fa-4c39-9e6b-0a7d3c18e2f4.00uXfh4uqoOIU1mZ6z7nwtWiAxzY0ZzCm%2BCUeMS90SI";

// Static assets were built at 08:54:12 UTC, just before the 08:55 deploy.
const ASSET_LAST_MODIFIED = "Fri, 30 Oct 2026 08:54:12 GMT";
const ASSET_MTIME_HEX = Date.parse(`${INCIDENT_DATE}T08:54:12Z`).toString(16);

const LOGIN_BODY = '{"email":"priya@example.com","password":"correct-horse"}';
const LOGIN_RESPONSE = '{"user":{"id":"u_1042","name":"Priya Shah"}}';
const LOGIN_RESPONSE_ETAG = 'W/"2c-tKV/LZYtwp6l6bdO+MsSIlWXm/k"';
const UNAUTHORIZED_RESPONSE = '{"error":"Unauthorized"}';
const UNAUTHORIZED_ETAG = 'W/"18-XPDV80vbMk4yY1/PADG4jYM4rSI"';
const CLIENT_ERROR_BODY = '{"message":"Dashboard failed to load: 2 requests returned 401"}';

const dashboardJs = scenarioFiles.find((file) => file.path === "public/dashboard.js")!.content;

const staticAssets = {
  "/dashboard.html": { size: 1874, type: "text/html; charset=UTF-8" },
  "/login.html": { size: 1532, type: "text/html; charset=UTF-8" },
  "/dashboard.js": { size: byteLength(dashboardJs), type: "application/javascript; charset=UTF-8" },
} as const;

type StaticPath = keyof typeof staticAssets;

function byteLength(text: string) {
  return new TextEncoder().encode(text).length;
}

/** "09:14:02.118" -> "Fri, 30 Oct 2026 09:14:02 GMT" */
function httpDate(timestamp: string) {
  return new Date(`${INCIDENT_DATE}T${timestamp}Z`).toUTCString();
}

function cookieExpiry(timestamp: string, maxAgeSeconds: number) {
  return new Date(Date.parse(`${INCIDENT_DATE}T${timestamp}Z`) + maxAgeSeconds * 1000).toUTCString();
}

function headers(record: Record<string, string | undefined>): HttpHeader[] {
  return Object.entries(record)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => ({ name, value }));
}

function sorted(list: HttpHeader[]) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

interface BrowserRequestOptions {
  type: NetworkRequest["type"];
  referer: string;
  cookie?: string;
  body?: { contentType: string; text: string };
  /** ETag of the cached copy, for conditional (revalidation) requests. */
  ifNoneMatch?: string;
}

function browserHeaders({ type, referer, cookie, body, ifNoneMatch }: BrowserRequestOptions) {
  const fetchMeta = {
    document: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", dest: "document", mode: "navigate" },
    script: { accept: "*/*", dest: "script", mode: "no-cors" },
    fetch: { accept: "*/*", dest: "empty", mode: "cors" },
    ping: { accept: "*/*", dest: "empty", mode: "no-cors" },
  }[type];

  return sorted(
    headers({
      Accept: fetchMeta.accept,
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Length": body ? String(byteLength(body.text)) : undefined,
      "Content-Type": body?.contentType,
      Cookie: cookie ? `sid=${cookie}` : undefined,
      Host: "orders.acme.example",
      "If-Modified-Since": ifNoneMatch ? ASSET_LAST_MODIFIED : undefined,
      "If-None-Match": ifNoneMatch,
      Origin: body ? ORIGIN : undefined,
      Referer: `${ORIGIN}${referer}`,
      "Sec-Fetch-Dest": fetchMeta.dest,
      "Sec-Fetch-Mode": fetchMeta.mode,
      "Sec-Fetch-Site": "same-origin",
      "Upgrade-Insecure-Requests": type === "document" ? "1" : undefined,
      "User-Agent": USER_AGENT,
    }),
  );
}

function staticEtag(path: StaticPath) {
  return `W/"${staticAssets[path].size.toString(16)}-${ASSET_MTIME_HEX}"`;
}

function nodeTrailer(timestamp: string) {
  return { Date: httpDate(timestamp), Connection: "keep-alive", "Keep-Alive": "timeout=5" };
}

function jsonResponseHeaders(timestamp: string, body: string, etag: string, setCookie?: string) {
  return headers({
    "X-Powered-By": "Express",
    "Set-Cookie": setCookie,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(byteLength(body)),
    ETag: etag,
    ...nodeTrailer(timestamp),
  });
}

function staticResponseHeaders(timestamp: string, path: StaticPath, notModified: boolean) {
  return headers({
    "X-Powered-By": "Express",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=0",
    "Last-Modified": ASSET_LAST_MODIFIED,
    ETag: staticEtag(path),
    "Content-Type": notModified ? undefined : staticAssets[path].type,
    "Content-Length": notModified ? undefined : String(staticAssets[path].size),
    ...nodeTrailer(timestamp),
  });
}

function sessionCookie(value: string, timestamp: string) {
  const maxAge = 60 * 60 * 8;
  return `sid=${value}; Max-Age=${maxAge}; Path=/; Expires=${cookieExpiry(timestamp, maxAge)}; HttpOnly; Secure; SameSite=Lax`;
}

// --- Request builders -------------------------------------------------------

interface Base {
  id: string;
  serverLogId: string;
  timestamp: string;
  durationMs: number;
}

function login(base: Base, existingCookie: string | undefined, newCookie: string): NetworkRequest {
  return {
    ...base,
    method: "POST",
    url: `${ORIGIN}/api/auth/login`,
    path: "/api/auth/login",
    status: 200,
    statusText: "OK",
    type: "fetch",
    initiator: "public/login.js",
    requestHeaders: browserHeaders({
      type: "fetch",
      referer: "/login.html",
      cookie: existingCookie,
      body: { contentType: "application/json", text: LOGIN_BODY },
    }),
    requestBody: LOGIN_BODY,
    responseHeaders: jsonResponseHeaders(
      base.timestamp,
      LOGIN_RESPONSE,
      LOGIN_RESPONSE_ETAG,
      sessionCookie(newCookie, base.timestamp),
    ),
    responseBody: LOGIN_RESPONSE,
  };
}

function staticAsset(
  base: Base,
  path: StaticPath,
  options: { cookie: string; referer: string; notModified: boolean; initiator?: string },
): NetworkRequest {
  const type = path.endsWith(".js") ? "script" : "document";
  const requestHeaders = browserHeaders({
    type,
    referer: options.referer,
    cookie: options.cookie,
    ifNoneMatch: options.notModified ? staticEtag(path) : undefined,
  });

  return {
    ...base,
    method: "GET",
    url: `${ORIGIN}${path}`,
    path,
    status: options.notModified ? 304 : 200,
    statusText: options.notModified ? "Not Modified" : "OK",
    type,
    initiator: options.initiator,
    requestHeaders,
    responseHeaders: staticResponseHeaders(base.timestamp, path, options.notModified),
    responseBody: type === "script" && !options.notModified ? dashboardJs : undefined,
  };
}

function protectedApi(base: Base, path: "/api/profile" | "/api/orders", cookie: string): NetworkRequest {
  return {
    ...base,
    method: "GET",
    url: `${ORIGIN}${path}`,
    path,
    status: 401,
    statusText: "Unauthorized",
    type: "fetch",
    initiator: "public/dashboard.js",
    requestHeaders: browserHeaders({ type: "fetch", referer: "/dashboard.html", cookie }),
    responseHeaders: jsonResponseHeaders(base.timestamp, UNAUTHORIZED_RESPONSE, UNAUTHORIZED_ETAG),
    responseBody: UNAUTHORIZED_RESPONSE,
  };
}

function clientErrorBeacon(base: Base, cookie: string): NetworkRequest {
  return {
    ...base,
    method: "POST",
    url: `${ORIGIN}/api/client-errors`,
    path: "/api/client-errors",
    status: 204,
    statusText: "No Content",
    type: "ping",
    initiator: "public/dashboard.js",
    requestHeaders: browserHeaders({
      type: "ping",
      referer: "/dashboard.html",
      cookie,
      body: { contentType: "text/plain;charset=UTF-8", text: CLIENT_ERROR_BODY },
    }),
    requestBody: CLIENT_ERROR_BODY,
    responseHeaders: headers({ "X-Powered-By": "Express", ...nodeTrailer(base.timestamp) }),
  };
}

export const networkRequests: NetworkRequest[] = [
  // Attempt 1: fresh login, no prior session cookie.
  login({ id: "req-01", serverLogId: "log-03", timestamp: "09:14:02.118", durationMs: 151 }, undefined, SESSION_A),
  staticAsset({ id: "req-02", serverLogId: "log-04", timestamp: "09:14:02.301", durationMs: 9 }, "/dashboard.html", {
    cookie: SESSION_A, referer: "/login.html", notModified: false, initiator: "public/login.js",
  }),
  staticAsset({ id: "req-03", serverLogId: "log-05", timestamp: "09:14:02.344", durationMs: 6 }, "/dashboard.js", {
    cookie: SESSION_A, referer: "/dashboard.html", notModified: false,
  }),
  protectedApi({ id: "req-04", serverLogId: "log-07", timestamp: "09:14:02.487", durationMs: 8 }, "/api/profile", SESSION_A),
  protectedApi({ id: "req-05", serverLogId: "log-09", timestamp: "09:14:02.489", durationMs: 7 }, "/api/orders", SESSION_A),
  clientErrorBeacon({ id: "req-06", serverLogId: "log-11", timestamp: "09:14:02.513", durationMs: 5 }, SESSION_A),
  staticAsset({ id: "req-07", serverLogId: "log-12", timestamp: "09:14:02.530", durationMs: 5 }, "/login.html", {
    cookie: SESSION_A, referer: "/dashboard.html", notModified: true, initiator: "public/dashboard.js",
  }),

  // Attempt 2: the browser still holds the first session cookie.
  login({ id: "req-08", serverLogId: "log-14", timestamp: "09:14:09.872", durationMs: 146 }, SESSION_A, SESSION_B),
  staticAsset({ id: "req-09", serverLogId: "log-15", timestamp: "09:14:09.990", durationMs: 5 }, "/dashboard.html", {
    cookie: SESSION_B, referer: "/login.html", notModified: true, initiator: "public/login.js",
  }),
  staticAsset({ id: "req-10", serverLogId: "log-16", timestamp: "09:14:10.021", durationMs: 4 }, "/dashboard.js", {
    cookie: SESSION_B, referer: "/dashboard.html", notModified: true,
  }),
  protectedApi({ id: "req-11", serverLogId: "log-18", timestamp: "09:14:10.105", durationMs: 7 }, "/api/profile", SESSION_B),
  protectedApi({ id: "req-12", serverLogId: "log-20", timestamp: "09:14:10.107", durationMs: 6 }, "/api/orders", SESSION_B),
  clientErrorBeacon({ id: "req-13", serverLogId: "log-22", timestamp: "09:14:10.122", durationMs: 5 }, SESSION_B),
  staticAsset({ id: "req-14", serverLogId: "log-23", timestamp: "09:14:10.140", durationMs: 4 }, "/login.html", {
    cookie: SESSION_B, referer: "/dashboard.html", notModified: true, initiator: "public/dashboard.js",
  }),
];
