/*
 * Challenge 025: The Missing Audit Trail. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 * All users, events and identifiers are fictional.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-06";
const ADMIN = { cookie: "console_sid=[removed]" };

export const challenge025 = defineChallenge({
  number: "025",
  title: "The Missing Audit Trail",
  incident: "An administrator changed a user's role successfully, but the change never appeared in the audit log.",
  difficulty: "advanced",
  tags: ["Audit logging", "Queues", "Migrations"],
  estimatedMinutes: 40,
  description:
    "Compliance asked who granted a contractor admin rights. The role change is in the database, the admin console reported success, and the audit log has nothing at all for that day.",
  category: "security",
  technologies: ["TypeScript", "Node.js", "PostgreSQL", "Redis"],
  publishedAt: "2026-11-05",
  incidentDate: DATE,
  origin: "https://console.saltmarsh.example",
  files: {
    "INCIDENT.md": `# INC-025 · The Missing Audit Trail

**Opened:** ${DATE} 16:00 UTC
**Severity:** SEV-2 (compliance)
**Service:** saltmarsh-console v9.1.0 and audit-worker v9.1.0

## Summary
Contractor account u_c204 was given the admin role at 10:14. The users
table shows it, and admin u_008 confirms making the change. The audit log
has no entries since 09:30, for any user.

## What we know
- Role changes publish an event to the audit queue; the audit worker
  stores each event in audit_events
- Migration 0047 ran at 09:30 as part of v9.1.0 (db/migrations)
- Queue monitoring shows no backlog: events are being consumed
- The worker and the console share one log pipeline

## Your task
Explain why the audit record was never stored, and why nothing alerted.
`,
    "src/admin/change-role.ts": `import { audit } from "../audit/publish";
import { db } from "../db";
import { log } from "../log";

export async function changeRole(actorId: string, userId: string, role: "member" | "admin") {
  const previous = await db.one<{ role: string }>("SELECT role FROM users WHERE id = $1", [userId]);
  await db.none("UPDATE users SET role = $2 WHERE id = $1", [userId, role]);
  log.info("admin", \`Role changed user=\${userId} from=\${previous.role} to=\${role} by=\${actorId}\`);
  await audit.publish({ type: "user.role_changed", actorId, targetId: userId, details: { from: previous.role, to: role } });
}
`,
    "src/audit/publish.ts": `import { randomUUID } from "node:crypto";
import { queue } from "../queue";
import { log } from "../log";

export interface AuditEvent {
  type: string;
  actorId: string;
  targetId: string;
  details: Record<string, string>;
}

export const audit = {
  async publish(event: AuditEvent) {
    const id = randomUUID();
    await queue.push("audit-events", JSON.stringify({ id, at: new Date().toISOString(), ...event }));
    log.info("audit", \`Published event=\${id.slice(0, 8)} type=\${event.type}\`);
  },
};
`,
    "worker/audit-worker.ts": `import { db } from "../src/db";
import { log } from "../src/log";
import { queue } from "../src/queue";

/** Moves audit events from the queue into audit_events, one at a time. */
export async function runAuditWorker() {
  for await (const message of queue.consume("audit-events")) {
    const event = JSON.parse(message.body);
    try {
      await db.none(
        "INSERT INTO audit_events (id, occurred_at, type, actor_id, target_user, details) VALUES ($1, $2, $3, $4, $5, $6)",
        [event.id, event.at, event.type, event.actorId, event.targetId, event.details],
      );
      log.info("audit-worker", \`Stored event=\${event.id.slice(0, 8)}\`);
    } catch (error) {
      log.warn("audit-worker", \`Could not store event=\${event.id.slice(0, 8)}: \${(error as Error).message}\`);
    } finally {
      // Acknowledge so a single bad message cannot block the queue.
      await message.ack();
    }
  }
}
`,
    "db/migrations/0047_audit_event_target.sql": `-- v9.1.0: audit events can now target projects as well as users.
ALTER TABLE audit_events RENAME COLUMN target_user TO target_id;
ALTER TABLE audit_events ADD COLUMN target_kind text NOT NULL DEFAULT 'user';
`,
    "ops/alerts.yaml": `# Alerts for the audit pipeline.
- name: audit-queue-backlog
  expr: queue_depth{queue="audit-events"} > 500
  for: 10m
  severity: page
`,
  },
  logs: [
    ["09:12:05.330", "INFO", "audit-worker", "Stored event=5d1e09aa"],
    ["09:30:02.004", "INFO", "migrate", "Applied 0047_audit_event_target.sql"],
    ["09:30:40.118", "INFO", "deploy", "saltmarsh-console v9.1.0 rolled out; audit-worker v9.1.0 rolled out"],
    ["09:41:17.882", "INFO", "audit", "Published event=8c2f11b0 type=project.archived"],
    ["09:41:17.901", "WARN", "audit-worker", "Could not store event=8c2f11b0: column \"target_user\" of relation \"audit_events\" does not exist"],
    ["10:14:22.410", "INFO", "admin", "Role changed user=u_c204 from=member to=admin by=u_008"],
    ["10:14:22.416", "INFO", "audit", "Published event=e3a94c27 type=user.role_changed"],
    ["10:14:22.418", "INFO", "http", "POST /api/admin/users/u_c204/role 200 31ms"],
    ["10:14:22.437", "WARN", "audit-worker", "Could not store event=e3a94c27: column \"target_user\" of relation \"audit_events\" does not exist"],
    ["15:00:00.000", "INFO", "metrics", "queue audit-events depth=0 consumed_today=1842 acked_today=1842"],
    ["15:00:00.001", "INFO", "metrics", "audit_events rows since 09:30 = 0"],
    ["15:48:09.506", "INFO", "http", "GET /api/admin/audit?target=u_c204&day=2026-10-06 200 9ms"],
  ],
  network: [
    { log: 8, requestHeaders: ADMIN, body: '{"role":"admin"}', response: '{"id":"u_c204","role":"admin"}' },
    { log: 12, requestHeaders: ADMIN, response: '{"events":[]}' },
  ],
  options: [
    [
      "event-never-published",
      "The role change never publishes an audit event",
      "The admin action updates the user but skips the call that sends the event to the audit queue.",
    ],
    [
      "worker-drops-failed-inserts",
      "The worker's insert fails after the migration, and it acknowledges the message anyway",
      "The worker still writes the renamed column, every insert fails, and each failed event is acknowledged and lost without an alert.",
    ],
    [
      "queue-retention",
      "Events expired in the queue before the worker read them",
      "The queue's retention is shorter than the worker's delay, so old events disappear unread.",
    ],
    [
      "audit-query-filter",
      "The audit screen filters out the events",
      "The events are stored, but the audit view's query hides them.",
    ],
  ],
});
