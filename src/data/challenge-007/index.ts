/*
 * Challenge 007: Payments Stuck as Pending. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-24";

/** A delivery as Paylane sent it: the exact body bytes and their signature header (fictional values). */
const delivery = (log: number, body: string, t: number, v1: string, status: 200 | 400) => ({
  log,
  body,
  requestHeaders: {
    "content-type": "application/json",
    "user-agent": "Paylane-Webhooks/2.1",
    "paylane-signature": `t=${t},v1=${v1}`,
  },
  response: status === 200 ? '{"received":true}' : '{"error":"invalid signature"}',
});

const event = (id: string, type: string, order: string, amount: number, name: string) =>
  `{"id":"${id}","type":"${type}","created":1792843200,"data":{"order":"${order}","amount":${amount},"currency":"EUR","customer":{"name":"${name}"}}}`;

export const challenge007 = defineChallenge({
  number: "007",
  title: "Payments Stuck as Pending",
  incident: "Some paid orders stay \"pending\" because their payment webhooks are rejected with \"invalid signature\".",
  difficulty: "intermediate",
  tags: ["Webhooks", "HMAC", "Express"],
  estimatedMinutes: 25,
  description:
    "Most payment notifications are accepted, but a steady trickle are rejected as forged, and those customers' orders never leave \"pending\". The payment provider insists its signatures are correct.",
  category: "api",
  technologies: ["TypeScript", "Node.js", "Express"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://hooks.pinecrest.example",
  files: {
    "INCIDENT.md": `# INC-007 · Payments Stuck as Pending

**Opened:** ${DATE} 12:20 UTC
**Severity:** SEV-2
**Service:** pinecrest-shop-api v6.0.3

## Summary
Customers are charged, but some orders never move from "pending" to
"paid". Each one matches a Paylane webhook that our endpoint rejected
with 400 "invalid signature". Paylane retries a rejected delivery once a
minute, and every retry is rejected too.

## What we know
- The webhook secret was last rotated three months ago; Paylane's
  dashboard shows the same secret we have
- Paylane support verified the signatures on the rejected deliveries
  and says they are valid
- Roughly one delivery in five is rejected

## Evidence attached
- Server logs (Investigation Console, logs/app.log)
- Inbound deliveries recorded by the ingress debug recorder (Network tab),
  with the exact bytes Paylane sent
- Paylane's webhook documentation (docs/paylane-webhooks.md)

## Your task
Explain why valid deliveries are rejected.
`,
    "docs/paylane-webhooks.md": `# Paylane webhooks: verifying signatures

Every delivery has a \`Paylane-Signature\` header:

    Paylane-Signature: t=<unix seconds>,v1=<hex signature>

\`v1\` is the HMAC-SHA256, keyed with your endpoint secret, of the string
\`<t>.<payload>\`, where payload is the request body.

Reject deliveries whose \`t\` is more than 300 seconds old.

During a secret rotation a delivery carries one \`v1\` per active secret.
`,
    "package.json": `{
  "name": "pinecrest-shop-api",
  "version": "6.0.3",
  "private": true,
  "dependencies": { "express": "^4.21.1" }
}
`,
    "src/server.ts": `import express from "express";
import { requestLog } from "./middleware/request-log";
import { ordersRouter } from "./routes/orders";
import { webhooksRouter } from "./routes/webhooks";

const app = express();

app.use(requestLog);
app.use(express.json({ limit: "1mb" }));

app.use("/api/orders", ordersRouter);
app.use("/webhooks", webhooksRouter);

app.listen(8080, () => console.info("[http] Server listening on :8080"));
`,
    "src/routes/webhooks.ts": `import { Router } from "express";
import { log } from "../lib/log";
import { markOrderPaid, recordRefund } from "../lib/orders";
import { verifyPaylaneSignature } from "../lib/paylane-signature";

export const webhooksRouter = Router();

webhooksRouter.post("/paylane", async (req, res) => {
  const event = req.body as { id: string; type: string; data: { order: string; amount: number } };
  log.info("webhook", \`Received event=\${event.id} type=\${event.type}\`);

  const verdict = verifyPaylaneSignature(req.get("paylane-signature"), JSON.stringify(req.body));
  if (!verdict.ok) {
    log.warn("webhook", \`Signature check failed reason=\${verdict.reason} event=\${event.id}\`);
    return res.status(400).json({ error: "invalid signature" });
  }
  log.info("webhook", \`Signature verified event=\${event.id}\`);

  if (event.type === "payment.succeeded") await markOrderPaid(event.data.order, event.data.amount);
  if (event.type === "refund.created") await recordRefund(event.data.order, event.data.amount);
  res.json({ received: true });
});
`,
    "src/lib/paylane-signature.ts": `import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

const TOLERANCE_SECONDS = 300;

export type Verdict = { ok: true } | { ok: false; reason: "missing_header" | "stale_timestamp" | "mismatch" };

export function verifyPaylaneSignature(header: string | undefined, payload: string, now = Date.now()): Verdict {
  if (!header) return { ok: false, reason: "missing_header" };
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = createHmac("sha256", config.paylaneSecret).update(\`\${parts.t}.\${payload}\`, "utf8").digest();
  const given = Buffer.from(parts.v1 ?? "", "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
`,
    "src/lib/orders.ts": `import { db } from "./db";
import { log } from "./log";

export async function markOrderPaid(orderId: string, amount: number) {
  await db.none("UPDATE orders SET status = 'paid', paid_amount = $2 WHERE id = $1 AND status = 'pending'", [orderId, amount]);
  log.info("orders", \`Order paid order=\${orderId}\`);
}

export async function recordRefund(orderId: string, amount: number) {
  await db.none("INSERT INTO refunds (order_id, amount) VALUES ($1, $2)", [orderId, amount]);
  log.info("orders", \`Refund recorded order=\${orderId}\`);
}
`,
    "src/config.ts": `export const config = {
  // Set from the PAYLANE_WEBHOOK_SECRET environment variable in every environment.
  paylaneSecret: process.env.PAYLANE_WEBHOOK_SECRET ?? "",
};
`,
  },
  logs: [
    ["11:58:02.310", "INFO", "http", "Server listening on :8080"],
    ["12:01:14.220", "INFO", "webhook", "Received event=evt_8841 type=payment.succeeded"],
    ["12:01:14.221", "INFO", "webhook", "Signature verified event=evt_8841"],
    ["12:01:14.226", "INFO", "orders", "Order paid order=ord_5530"],
    ["12:01:14.227", "INFO", "http", "POST /webhooks/paylane 200 7ms"],
    ["12:03:52.610", "INFO", "webhook", "Received event=evt_8842 type=payment.succeeded"],
    ["12:03:52.611", "WARN", "webhook", "Signature check failed reason=mismatch event=evt_8842"],
    ["12:03:52.612", "INFO", "http", "POST /webhooks/paylane 400 2ms"],
    ["12:04:52.701", "INFO", "webhook", "Received event=evt_8842 type=payment.succeeded"],
    ["12:04:52.702", "WARN", "webhook", "Signature check failed reason=mismatch event=evt_8842"],
    ["12:04:52.703", "INFO", "http", "POST /webhooks/paylane 400 2ms"],
    ["12:07:30.118", "INFO", "webhook", "Received event=evt_8843 type=refund.created"],
    ["12:07:30.119", "INFO", "webhook", "Signature verified event=evt_8843"],
    ["12:07:30.125", "INFO", "orders", "Refund recorded order=ord_5498"],
    ["12:07:30.126", "INFO", "http", "POST /webhooks/paylane 200 8ms"],
    ["12:09:05.442", "INFO", "webhook", "Received event=evt_8844 type=payment.succeeded"],
    ["12:09:05.443", "WARN", "webhook", "Signature check failed reason=mismatch event=evt_8844"],
    ["12:09:05.444", "INFO", "http", "POST /webhooks/paylane 400 2ms"],
    ["12:15:00.004", "WARN", "orders", "Orders pending for over 10 minutes after checkout: ord_5531, ord_5533"],
  ],
  network: [
    delivery(5, event("evt_8841", "payment.succeeded", "ord_5530", 4200, "Liam Carter"), 1792843274, "4f0c1e9a7b2d5c8e3a6f9b1d4c7e0a3f5b8d1e4a7c0f3b6d9e2a5c8f1b4d7e0a", 200),
    delivery(8, event("evt_8842", "payment.succeeded", "ord_5531", 1890, "Zo\\u00eb Ferreira"), 1792843432, "9b3e6a1d4f7c0e2b5a8d1f4c7e0b3a6d9f2c5e8b1a4d7f0c3e6b9a2d5f8c1e4b", 400),
    delivery(11, event("evt_8842", "payment.succeeded", "ord_5531", 1890, "Zo\\u00eb Ferreira"), 1792843492, "2d7a0c5f8b1e4d7a0c3f6b9e2d5a8c1f4b7e0d3a6c9f2b5e8d1a4c7f0b3e6d9a", 400),
    delivery(15, event("evt_8843", "refund.created", "ord_5498", 650, "Amara Okafor"), 1792843650, "6e1b4d7a0f3c6e9b2d5a8f1c4e7b0d3a6f9c2e5b8d1a4f7c0e3b6d9a2f5c8e1b", 200),
    delivery(18, event("evt_8844", "payment.succeeded", "ord_5533", 7310, "Jos\\u00e9 Mart\\u00edn"), 1792843745, "c8f1b4e7a0d3c6f9b2e5a8d1c4f7b0e3a6d9c2f5b8e1a4d7c0f3b6e9a2d5c8f1", 400),
  ],
  options: [
    [
      "secret-mismatch",
      "The endpoint is using a different webhook secret from Paylane",
      "The secret in the environment does not match the one Paylane signs with.",
    ],
    [
      "timestamp-tolerance",
      "Deliveries are rejected for being older than the tolerance window",
      "Clock differences make the timestamp check fail for some deliveries.",
    ],
    [
      "only-first-v1-checked",
      "Only the first signature in the header is checked during a secret rotation",
      "Deliveries carrying several v1 values fail when the matching one is not first.",
    ],
    [
      "signature-over-reserialized-json",
      "The signature is checked against re-serialized JSON instead of the body Paylane sent",
      "Parsing and stringifying the body does not always reproduce the original bytes, so the HMAC differs for some payloads.",
    ],
  ],
});
