/*
 * Challenge 004: Signed Out by Some Servers. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-11-03";
// A fictional token for u_5530, issued at 14:30:58. The signature was removed from the capture.
const TOKEN =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6IjIwMjYtMTEtYSIsInR5cCI6IkpXVCJ9." +
  "eyJpc3MiOiJodHRwczovL2lkLmF0bGFzLmV4YW1wbGUiLCJhdWQiOiJhdGxhcy1hcGkiLCJzdWIiOiJ1XzU1MzAiLCJpYXQiOjE3OTM3MTYyNTgsImV4cCI6MTc5MzcxOTg1OH0." +
  "[signature removed]";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const PROJECTS = '{"projects":[{"id":"prj_88","name":"Spring launch"}]}';
const TASKS = '{"tasks":[{"id":"tsk_1201","title":"Final copy review","done":false}]}';
const UNAUTHORIZED = {
  "www-authenticate": 'Bearer error="invalid_token"',
};

export const challenge004 = defineChallenge({
  number: "004",
  title: "Signed Out by Some Servers",
  incident: "Since the afternoon, newly signed-in users get random 401 errors while older sessions keep working.",
  difficulty: "advanced",
  tags: ["JWT", "Key rotation", "Caching"],
  estimatedMinutes: 40,
  description:
    "After a routine afternoon change, people who sign in see some API calls fail with 401 and then succeed on retry. People who signed in that morning are fine.",
  category: "authentication",
  technologies: ["TypeScript", "Node.js", "Kubernetes"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://app.atlas.example",
  logFile: "logs/cluster.log",
  files: {
    "INCIDENT.md": `# INC-004 · Signed Out by Some Servers

**Opened:** ${DATE} 14:45 UTC
**Severity:** SEV-2
**Service:** atlas-api v5.4.2 (3 pods behind a round-robin load balancer)

## Summary
Users who sign in this afternoon see their task lists fail to load with
401 Unauthorized, then load fine on a refresh. Users who signed in earlier
in the day are not affected.

## Timeline (UTC)
- 06:12  atlas-api pods api-6d9f-x2k and api-6d9f-r7m started (nightly restart)
- 14:00  Identity team rotated the token signing key (scheduled, quarterly)
- 14:20  Autoscaler added pod api-7c41-p9q
- 14:31  First reports

## Notes
- The identity service publishes its keys at https://id.atlas.example/.well-known/jwks.json
- After a rotation the previous key stays published for 24 hours
- Logs below are the aggregated cluster log; each line is tagged with its pod

## Your task
Explain why the same request is accepted by some pods and refused by others.
`,
    "package.json": `{
  "name": "atlas-api",
  "version": "5.4.2",
  "private": true,
  "dependencies": { "express": "^4.21.1", "jose": "^5.9.6" }
}
`,
    "src/auth/verify-token.ts": `import { importJWK, jwtVerify, type JWTPayload, type KeyLike } from "jose";
import { config } from "../config";
import { fetchJwks } from "./jwks";

export class AuthError extends Error {
  constructor(readonly reason: "malformed" | "unknown_kid" | "invalid_signature" | "expired" | "wrong_audience") {
    super(reason);
  }
}

interface KeyCache {
  keys: Map<string, KeyLike | Uint8Array>;
  fetchedAt: number;
}

let cache: KeyCache | undefined;

async function loadKeys(): Promise<KeyCache> {
  const jwks = await fetchJwks(config.jwksUrl);
  const keys = new Map<string, KeyLike | Uint8Array>();
  for (const jwk of jwks.keys) keys.set(jwk.kid!, await importJWK(jwk, "RS256"));
  return { keys, fetchedAt: Date.now() };
}

async function signingKey(kid: string) {
  if (!cache || Date.now() - cache.fetchedAt > config.jwksCacheTtlMs) cache = await loadKeys();
  const key = cache.keys.get(kid);
  if (!key) throw new AuthError("unknown_kid");
  return key;
}

export async function verifyToken(token: string): Promise<JWTPayload & { kid: string }> {
  const [header] = token.split(".");
  let kid: string | undefined;
  try {
    kid = JSON.parse(Buffer.from(header, "base64url").toString("utf8")).kid;
  } catch {
    throw new AuthError("malformed");
  }
  if (!kid) throw new AuthError("malformed");

  const key = await signingKey(kid);
  try {
    const { payload } = await jwtVerify(token, key, { issuer: config.issuer, audience: config.audience, clockTolerance: 30 });
    return { ...payload, kid };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_JWT_EXPIRED") throw new AuthError("expired");
    if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") throw new AuthError("wrong_audience");
    throw new AuthError("invalid_signature");
  }
}
`,
    "src/auth/jwks.ts": `import { log } from "../lib/log";

export interface Jwks {
  keys: (JsonWebKey & { kid?: string })[];
}

export async function fetchJwks(url: string): Promise<Jwks> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(\`JWKS request failed with \${response.status}\`);
  const jwks = (await response.json()) as Jwks;
  log.info(\`JWKS fetched keys=\${jwks.keys.map((key) => key.kid).join(",")}\`);
  return jwks;
}
`,
    "src/auth/middleware.ts": `import type { NextFunction, Request, Response } from "express";
import { log } from "../lib/log";
import { AuthError, verifyToken } from "./verify-token";

export async function requireToken(req: Request, res: Response, next: NextFunction) {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const claims = await verifyToken(token);
    log.debug(\`Token verified kid=\${claims.kid} sub=\${claims.sub}\`);
    req.userId = String(claims.sub);
    next();
  } catch (error) {
    const reason = error instanceof AuthError ? error.reason : "error";
    const kid = token ? safeKid(token) : "-";
    log.warn(\`Token rejected reason=\${reason} kid=\${kid}\`);
    res.status(401).set("WWW-Authenticate", 'Bearer error="invalid_token"').json({ error: "invalid_token" });
  }
}

function safeKid(token: string) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")).kid ?? "-";
  } catch {
    return "-";
  }
}
`,
    "src/config.ts": `export const config = {
  issuer: "https://id.atlas.example",
  audience: "atlas-api",
  jwksUrl: "https://id.atlas.example/.well-known/jwks.json",
  // Keys change a few times a year; a day keeps the identity service out of the request path.
  jwksCacheTtlMs: 24 * 60 * 60 * 1000,
};
`,
    "src/lib/log.ts": `import { hostname } from "node:os";

// Each line is tagged with the pod name, which Kubernetes sets as the hostname.
const pod = hostname();
const write = (level: string, message: string) =>
  console.log(\`\${new Date().toISOString()} \${level.padEnd(5)} [\${pod}] \${message}\`);

export const log = {
  debug: (message: string) => write("DEBUG", message),
  info: (message: string) => write("INFO", message),
  warn: (message: string) => write("WARN", message),
};
`,
    "deploy/atlas-api.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: atlas-api
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: api
          image: registry.atlas.example/atlas-api:5.4.2
          ports: [{ containerPort: 8080 }]
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: atlas-api
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: atlas-api }
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 65 } }
`,
  },
  logs: [
    ["06:12:04.551", "INFO", "api-6d9f-x2k", "Started atlas-api v5.4.2"],
    ["06:12:04.902", "INFO", "api-6d9f-x2k", "JWKS fetched keys=2026-10-b"],
    ["06:12:05.118", "INFO", "api-6d9f-r7m", "Started atlas-api v5.4.2"],
    ["06:12:05.470", "INFO", "api-6d9f-r7m", "JWKS fetched keys=2026-10-b"],
    ["14:00:00.013", "INFO", "identity", "Signing key rotated active=2026-11-a previous=2026-10-b"],
    ["14:20:31.660", "INFO", "api-7c41-p9q", "Started atlas-api v5.4.2"],
    ["14:20:32.004", "INFO", "api-7c41-p9q", "JWKS fetched keys=2026-10-b,2026-11-a"],
    ["14:30:58.300", "INFO", "identity", "Token issued sub=u_5530 kid=2026-11-a"],
    ["14:31:07.071", "DEBUG", "api-7c41-p9q", "Token verified kid=2026-11-a sub=u_5530"],
    ["14:31:07.112", "INFO", "api-7c41-p9q", "GET /v1/projects 200 41ms"],
    ["14:31:09.845", "WARN", "api-6d9f-x2k", "Token rejected reason=unknown_kid kid=2026-11-a"],
    ["14:31:09.846", "INFO", "api-6d9f-x2k", "GET /v1/projects/prj_88/tasks 401 2ms"],
    ["14:31:12.204", "WARN", "api-6d9f-r7m", "Token rejected reason=unknown_kid kid=2026-11-a"],
    ["14:31:12.205", "INFO", "api-6d9f-r7m", "GET /v1/projects/prj_88/tasks 401 1ms"],
    ["14:31:15.927", "DEBUG", "api-7c41-p9q", "Token verified kid=2026-11-a sub=u_5530"],
    ["14:31:15.990", "INFO", "api-7c41-p9q", "GET /v1/projects/prj_88/tasks 200 63ms"],
    ["14:32:40.002", "DEBUG", "api-6d9f-x2k", "Token verified kid=2026-10-b sub=u_2091"],
    ["14:32:40.031", "INFO", "api-6d9f-x2k", "GET /v1/projects 200 38ms"],
    ["14:32:44.519", "DEBUG", "api-6d9f-r7m", "Token verified kid=2026-10-b sub=u_2091"],
    ["14:32:44.570", "INFO", "api-6d9f-r7m", "GET /v1/projects/prj_31/tasks 200 51ms"],
  ],
  network: [
    { log: 10, requestHeaders: AUTH, responseHeaders: { "x-served-by": "api-7c41-p9q" }, response: PROJECTS },
    {
      log: 12,
      requestHeaders: AUTH,
      responseHeaders: { ...UNAUTHORIZED, "x-served-by": "api-6d9f-x2k" },
      response: '{"error":"invalid_token"}',
    },
    {
      log: 14,
      requestHeaders: AUTH,
      responseHeaders: { ...UNAUTHORIZED, "x-served-by": "api-6d9f-r7m" },
      response: '{"error":"invalid_token"}',
    },
    { log: 16, requestHeaders: AUTH, responseHeaders: { "x-served-by": "api-7c41-p9q" }, response: TASKS },
  ],
  options: [
    [
      "clock-skew",
      "The older pods' clocks have drifted and they see new tokens as not yet valid",
      "A pod whose clock is behind treats a token issued moments ago as issued in the future and rejects it.",
    ],
    [
      "previous-key-withdrawn",
      "The identity service stopped publishing the previous signing key too early",
      "Removing the old key from the key set makes every token signed with it fail verification.",
    ],
    [
      "authorization-header-dropped",
      "The load balancer drops the Authorization header on some routes",
      "Requests reach some pods without a token, so they are treated as anonymous.",
    ],
    [
      "stale-key-cache",
      "Pods keep a cached key set and never fetch it again when they meet a new key ID",
      "A pod that loaded the keys before the rotation does not know the new key, and nothing makes it look again until its cache expires.",
    ],
    [
      "audience-changed",
      "Tokens issued after the change carry a different audience",
      "The identity service now issues tokens for another audience, which the API refuses.",
    ],
  ],
});
