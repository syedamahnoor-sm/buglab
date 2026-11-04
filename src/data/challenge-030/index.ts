/*
 * Challenge 030: The Deployment That Broke Monday. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-05";

export const challenge030 = defineChallenge({
  number: "030",
  title: "The Deployment That Broke Monday",
  incident: "Monday's release passed staging but its production pods never become ready, so the rollout is stuck.",
  difficulty: "intermediate",
  tags: ["Configuration", "Deployments", "Kubernetes"],
  estimatedMinutes: 25,
  description:
    "Version 3.0 ran cleanly in staging all of last week. In production, every new pod fails its readiness check, while the old pods on the same cluster keep serving traffic.",
  category: "performance",
  technologies: ["TypeScript", "Node.js", "Redis", "Kubernetes", "Helm"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://api.wrenfield.example",
  logFile: "logs/cluster.log",
  files: {
    "INCIDENT.md": `# INC-030 · The Deployment That Broke Monday

**Opened:** ${DATE} 07:20 UTC
**Severity:** SEV-2 (rollout paused; v2.9 still serving)
**Service:** wrenfield-api v3.0.0

## Summary
The v3.0.0 rollout started at 07:00. Kubernetes created three new pods; none
has become ready, so the rollout is paused at 0 of 6 updated pods. The six
v2.9.4 pods are healthy and serving all traffic.

## Notes
- v3.0.0 has run in staging since Tuesday without problems
- The same container image is used in staging and production
- Production and staging each have their own Helm values file
- Redis (cache.prod.internal) is healthy; the v2.9.4 pods use it constantly

## Your task
Explain why v3.0.0 works in staging but not in production.
`,
    "CHANGELOG.md": `# Changelog

## 3.0.0
- Redis connection is configured with a single REDIS_URL setting
  (REDIS_HOST and REDIS_PORT are no longer read)
- Health check reports each dependency separately

## 2.9.4
- Fixed rounding in invoice totals
`,
    "src/config.ts": `export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required("DATABASE_URL"),
  // Defaults keep local development working without any setup.
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name} must be set\`);
  return value;
}
`,
    "src/health.ts": `import { Router } from "express";
import { db } from "./db";
import { redis } from "./redis";

export const health = Router();

health.get("/healthz", async (_req, res) => {
  const checks = {
    database: await db.query("SELECT 1").then(() => "up", () => "down"),
    redis: await redis.ping().then(() => "up", () => "down"),
  };
  const ok = Object.values(checks).every((state) => state === "up");
  res.status(ok ? 200 : 503).json(checks);
});
`,
    "src/redis.ts": `import { createClient } from "redis";
import { config } from "./config";
import { log } from "./log";

export const redis = createClient({ url: config.redisUrl });
redis.on("error", (error) => log.error("redis", \`\${error.message}\`));

log.info("redis", \`Connecting to \${config.redisUrl}\`);
void redis.connect();
`,
    "deploy/staging/values.yaml": `image:
  repository: registry.wrenfield.example/wrenfield-api
env:
  DATABASE_URL: { secretRef: staging-db-url }
  REDIS_URL: redis://cache.staging.internal:6379
readinessProbe:
  path: /healthz
`,
    "deploy/production/values.yaml": `image:
  repository: registry.wrenfield.example/wrenfield-api
replicas: 6
env:
  DATABASE_URL: { secretRef: prod-db-url }
  REDIS_HOST: cache.prod.internal
  REDIS_PORT: "6379"
readinessProbe:
  path: /healthz
`,
  },
  logs: [
    ["06:58:10.000", "INFO", "api-v294-6hq", "Connecting to redis://cache.prod.internal:6379"],
    ["07:00:04.512", "INFO", "deploy", "helm upgrade wrenfield-api --version 3.0.0 -f deploy/production/values.yaml"],
    ["07:00:21.330", "INFO", "api-v300-k2p", "Connecting to redis://localhost:6379"],
    ["07:00:21.341", "ERROR", "api-v300-k2p", "connect ECONNREFUSED 127.0.0.1:6379"],
    ["07:00:26.004", "INFO", "api-v300-k2p", "GET /healthz 503 3ms"],
    ["07:00:26.005", "WARN", "kubelet", "Readiness probe failed pod=api-v300-k2p status=503"],
    ["07:00:31.870", "INFO", "api-v300-m8d", "Connecting to redis://localhost:6379"],
    ["07:00:31.884", "ERROR", "api-v300-m8d", "connect ECONNREFUSED 127.0.0.1:6379"],
    ["07:00:36.212", "WARN", "kubelet", "Readiness probe failed pod=api-v300-m8d status=503"],
    ["07:01:02.119", "INFO", "api-v294-6hq", "GET /healthz 200 2ms"],
    ["07:10:04.600", "WARN", "deploy", "Rollout paused: 0/6 updated pods ready after 10 minutes"],
    ["07:12:45.430", "INFO", "api-v300-k2p", "GET /healthz 503 2ms"],
  ],
  network: [
    { log: 10, requestHeaders: { host: "api-v294-6hq:8080" }, response: '{"status":"ok"}' },
    { log: 12, requestHeaders: { host: "api-v300-k2p:8080" }, response: '{"database":"up","redis":"down"}' },
  ],
  options: [
    [
      "redis-down",
      "The production Redis server is down",
      "The new pods cannot reach Redis because Redis itself is failing.",
    ],
    [
      "network-policy",
      "A network policy stops the new pods from reaching the Redis host",
      "Only pods with the old labels are allowed to connect to cache.prod.internal.",
    ],
    [
      "renamed-setting-not-in-prod",
      "Production still sets the old Redis settings, so v3 falls back to localhost",
      "v3.0 reads only REDIS_URL. The production values file sets REDIS_HOST and REDIS_PORT, so the default redis://localhost:6379 is used.",
    ],
    [
      "database-misconfigured",
      "The new pods cannot reach the production database",
      "The database setting is wrong in production, so the health check fails.",
    ],
  ],
});
