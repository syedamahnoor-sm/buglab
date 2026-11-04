/*
 * Challenge 008: Charged Twice at Checkout. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-26";
const KEY = "4b1f7c2e-9d3a-4e85-b6f0-2a7c9e1d5b38";
const CHECKOUT = '{"order":"ord_9921","payment_method":"pm_card_visa_4242"}';
const HEADERS = { "idempotency-key": KEY, authorization: "Bearer [removed]" };

export const challenge008 = defineChallenge({
  number: "008",
  title: "Charged Twice at Checkout",
  incident: "Customers on slow connections are occasionally charged twice for one order.",
  difficulty: "advanced",
  tags: ["Idempotency", "Retries", "Payments"],
  estimatedMinutes: 40,
  description:
    "The mobile app retries a failed checkout with the same idempotency key, which should make the retry harmless. Yet nightly reconciliation keeps finding orders with two successful charges.",
  category: "api",
  technologies: ["TypeScript", "Node.js", "Express", "PostgreSQL"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://api.tidewater.example",
  files: {
    "INCIDENT.md": `# INC-008 · Charged Twice at Checkout

**Opened:** ${DATE} 19:05 UTC
**Severity:** SEV-1 (customer money)
**Service:** tidewater-checkout v4.1.0, behind the API gateway

## Summary
Reconciliation flagged order ord_9921 with two successful card charges
of 64.90 EUR, 0.5 s apart. It is the ninth order this week. Every one was
placed from the mobile app, and in every case the app showed an error and
then succeeded on its automatic retry.

## What we know
- The app sends an Idempotency-Key header and reuses it on retries
- The card processor confirmed it received two separate charge requests
  from us for ord_9921
- The checkout service and the gateway write to the same log pipeline

## Evidence attached
- Gateway and checkout logs (Investigation Console, logs/app.log)
- The app's two requests for ord_9921, from a support engineer's proxy

## Your task
Explain how one order produced two charges despite the idempotency key.
`,
    "package.json": `{
  "name": "tidewater-checkout",
  "version": "4.1.0",
  "private": true,
  "dependencies": { "express": "^4.21.1", "pg-promise": "^11.10.1" }
}
`,
    "src/routes/checkout.ts": `import { Router } from "express";
import { idempotency } from "../lib/idempotency";
import { log } from "../lib/log";
import { orders } from "../lib/orders";
import { psp } from "../lib/psp";

export const checkout = Router();

checkout.post("/v2/checkout", async (req, res) => {
  const key = req.get("idempotency-key");
  if (!key) return res.status(400).json({ error: "Idempotency-Key header is required" });
  const { order: orderId, payment_method: paymentMethod } = req.body as { order: string; payment_method: string };
  log.info("api", \`Checkout started order=\${orderId} idempotency_key=\${key.slice(0, 8)}\`);

  // A retry with a key we have already answered gets the same answer again.
  const previous = await idempotency.find(key);
  if (previous) return res.status(previous.status).json(previous.body);

  const order = await orders.get(orderId);
  const charge = await psp.charge({ amount: order.total, currency: order.currency, paymentMethod, reference: order.id });
  await orders.markPaid(order.id, charge.id);

  const body = { order: order.id, charge: charge.id, status: "paid" };
  await idempotency.save(key, 201, body);
  res.status(201).json(body);
});
`,
    "src/lib/idempotency.ts": `import { db } from "./db";
import { log } from "./log";

export interface StoredResponse {
  status: number;
  body: unknown;
}

// CREATE TABLE idempotency_keys (key text PRIMARY KEY, status int NOT NULL, body jsonb NOT NULL, created_at timestamptz DEFAULT now());

export const idempotency = {
  async find(key: string): Promise<StoredResponse | undefined> {
    const row = await db.oneOrNone<StoredResponse>("SELECT status, body FROM idempotency_keys WHERE key = $1", [key]);
    log.debug("idempotency", \`Lookup key=\${key.slice(0, 8)} result=\${row ? "hit" : "miss"}\`);
    return row ?? undefined;
  },

  async save(key: string, status: number, body: unknown) {
    await db.none("INSERT INTO idempotency_keys (key, status, body) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING", [key, status, body]);
    log.info("idempotency", \`Stored key=\${key.slice(0, 8)} status=\${status}\`);
  },
};
`,
    "src/lib/psp.ts": `import { config } from "../config";
import { log } from "./log";

interface ChargeRequest {
  amount: number;
  currency: string;
  paymentMethod: string;
  reference: string;
}

export const psp = {
  async charge(request: ChargeRequest): Promise<{ id: string }> {
    const started = Date.now();
    log.info("psp", \`Charge requested order=\${request.reference} amount=\${request.amount.toFixed(2)}\`);
    const response = await fetch(\`\${config.pspUrl}/v1/charges\`, {
      method: "POST",
      headers: { authorization: \`Bearer \${config.pspKey}\`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(\`charge failed with \${response.status}\`);
    const charge = (await response.json()) as { id: string };
    log.info("psp", \`Charge succeeded charge=\${charge.id} order=\${request.reference} duration=\${Date.now() - started}ms\`);
    return charge;
  },
};
`,
    "gateway/routes.yaml": `# API gateway route for the checkout service.
- path: /v2/checkout
  methods: [POST]
  upstream: http://tidewater-checkout:8080
  timeout: 10s
  retries: 0          # never retry POSTs at the gateway
  access_log: true
`,
    "mobile/src/api/checkout.ts": `import { randomUUID } from "expo-crypto";
import { session } from "../session";

const RETRY_DELAY_MS = 1000;

/** Places the order. One key per checkout attempt, reused for the automatic retry. */
export async function placeOrder(orderId: string, paymentMethod: string) {
  const key = randomUUID();
  const send = () =>
    fetch("https://api.tidewater.example/v2/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key, authorization: \`Bearer \${session.token}\` },
      body: JSON.stringify({ order: orderId, payment_method: paymentMethod }),
    });

  let response = await send();
  if (response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await send();
  }
  return response.json();
}
`,
  },
  logs: [
    ["18:00:03.512", "INFO", "api", "Server listening on :8080"],
    ["18:22:01.004", "INFO", "api", "Checkout started order=ord_9921 idempotency_key=4b1f7c2e"],
    ["18:22:01.010", "DEBUG", "idempotency", "Lookup key=4b1f7c2e result=miss"],
    ["18:22:01.015", "INFO", "psp", "Charge requested order=ord_9921 amount=64.90"],
    ["18:22:11.006", "WARN", "gateway", "Upstream timed out after 10000ms route=/v2/checkout"],
    ["18:22:11.007", "INFO", "gateway", "POST /v2/checkout 504 10003ms"],
    ["18:22:12.218", "INFO", "api", "Checkout started order=ord_9921 idempotency_key=4b1f7c2e"],
    ["18:22:12.224", "DEBUG", "idempotency", "Lookup key=4b1f7c2e result=miss"],
    ["18:22:12.229", "INFO", "psp", "Charge requested order=ord_9921 amount=64.90"],
    ["18:22:12.861", "INFO", "psp", "Charge succeeded charge=ch_3QfA order=ord_9921 duration=11846ms"],
    ["18:22:12.870", "INFO", "idempotency", "Stored key=4b1f7c2e status=201"],
    ["18:22:12.871", "INFO", "api", "POST /v2/checkout 201 11867ms"],
    ["18:22:13.402", "INFO", "psp", "Charge succeeded charge=ch_3QfB order=ord_9921 duration=1173ms"],
    ["18:22:13.409", "INFO", "idempotency", "Stored key=4b1f7c2e status=201"],
    ["18:22:13.410", "INFO", "api", "POST /v2/checkout 201 1192ms"],
    ["18:22:13.411", "INFO", "gateway", "POST /v2/checkout 201 1195ms"],
    ["18:40:00.120", "WARN", "reconciliation", "Duplicate charges order=ord_9921 charges=ch_3QfA,ch_3QfB"],
  ],
  network: [
    { log: 6, body: CHECKOUT, requestHeaders: HEADERS, response: '{"error":"upstream timeout"}' },
    {
      log: 16,
      body: CHECKOUT,
      requestHeaders: HEADERS,
      response: '{"order":"ord_9921","charge":"ch_3QfB","status":"paid"}',
    },
  ],
  options: [
    [
      "retry-uses-new-key",
      "The app sends a new idempotency key on its retry",
      "Each attempt carries a different key, so the server cannot tell the retry is the same checkout.",
    ],
    [
      "gateway-retries-upstream",
      "The gateway retries the request to the checkout service on its own",
      "A gateway retry after the upstream timeout sends the same checkout to the service twice.",
    ],
    [
      "processor-double-charge",
      "The card processor processed one charge request twice",
      "A fault on the processor's side duplicated a single charge request from us.",
    ],
    [
      "key-recorded-after-charge",
      "The idempotency key is only recorded after the charge completes",
      "While the first request is still waiting on the processor, the retry finds no record for its key and charges again.",
    ],
    [
      "missing-unique-constraint",
      "The idempotency table lets the same key be stored twice",
      "Without a unique constraint two rows for one key can exist, so a lookup can miss the answered one.",
    ],
  ],
});
