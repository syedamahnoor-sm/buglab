/*
 * Challenge 029: The Retry Storm. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-08";
const UNAVAILABLE = '{"error":"Stock check unavailable, please try again"}';

export const challenge029 = defineChallenge({
  number: "029",
  title: "The Retry Storm",
  incident: "A 20-second database failover turned into a 40-minute checkout outage.",
  difficulty: "advanced",
  tags: ["Retries", "Backoff", "Resilience"],
  estimatedMinutes: 40,
  description:
    "The inventory database failed over cleanly in 20 seconds, as designed. The inventory service never recovered on its own, and checkout stayed down until traffic was shed by hand.",
  category: "performance",
  technologies: ["TypeScript", "Node.js", "Kubernetes"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://shop.alderpine.example",
  files: {
    "INCIDENT.md": `# INC-029 · The Retry Storm

**Opened:** ${DATE} 10:02 UTC
**Severity:** SEV-1
**Services:** checkout-api v6.2.0 → inventory-service v2.9.1

## Timeline (UTC)
- 10:00:00  Inventory database primary failed over (planned maintenance)
- 10:00:20  Failover complete; database latency back to normal
- 10:00–10:40  Inventory service overloaded; checkout returns 503
- 10:40  Checkout traffic shed at the gateway; inventory recovers in 2 minutes

## Notes
- Normal load on inventory-service is about 30 requests/second
- inventory-service runs 4 pods; each handles about 60 requests/second
- Checkout traffic did not increase during the outage
- Logs below are from both services and the edge gateway

## Your task
Explain why the service stayed down after the database recovered.
`,
    "checkout-api/src/inventory-client.ts": `import { log } from "./log";

const BASE_URL = process.env.INVENTORY_URL ?? "http://inventory-service:8080";
const TIMEOUT_MS = 500;
const MAX_ATTEMPTS = 5;

/** Asks the inventory service whether every line in the cart can be reserved. */
export async function checkStock(cartId: string): Promise<{ ok: boolean }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(\`\${BASE_URL}/v1/stock-check/\${cartId}\`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.ok) return response.json();
      lastError = new Error(\`status \${response.status}\`);
    } catch (error) {
      lastError = error;
    }
    log.warn("inventory-client", \`attempt \${attempt}/\${MAX_ATTEMPTS} failed cart=\${cartId} reason=\${String(lastError)}\`);
  }
  throw lastError;
}
`,
    "checkout-api/src/routes/quote.ts": `import { Router } from "express";
import { checkStock } from "../inventory-client";

export const quote = Router();

quote.get("/api/checkout/quote", async (req, res) => {
  try {
    const stock = await checkStock(String(req.query.cart));
    res.json({ stock_ok: stock.ok });
  } catch {
    res.status(503).json({ error: "Stock check unavailable, please try again" });
  }
});
`,
    "gateway/routes.yaml": `- path: /api/checkout/quote
  methods: [GET]
  upstream: http://checkout-api:8080
  timeout: 3s
  retries: 2            # GETs are safe to retry
  retry_on: [503, timeout]
`,
    "inventory-service/src/server.ts": `import express from "express";
import { db } from "./db";
import { log } from "./log";

const app = express();
let inFlight = 0;

app.get("/v1/stock-check/:cartId", async (req, res) => {
  inFlight++;
  try {
    const lines = await db.query("SELECT sku, available FROM stock WHERE sku = ANY($1)", [await db.cartSkus(req.params.cartId)]);
    res.json({ ok: lines.rows.every((line) => line.available > 0) });
  } finally {
    inFlight--;
  }
});

setInterval(() => log.info("inventory", \`requests_in_flight=\${inFlight}\`), 10_000);
app.listen(8080);
`,
  },
  logs: [
    ["09:59:50.000", "INFO", "metrics", "inventory-service rps=29 p99=41ms checkout-api rps=29 gateway rps=29"],
    ["10:00:00.120", "WARN", "db", "inventory primary failover started"],
    ["10:00:00.630", "WARN", "inventory-client", "attempt 1/5 failed cart=c_7712 reason=TimeoutError: The operation was aborted due to timeout"],
    ["10:00:01.131", "WARN", "inventory-client", "attempt 2/5 failed cart=c_7712 reason=TimeoutError: The operation was aborted due to timeout"],
    ["10:00:01.632", "WARN", "inventory-client", "attempt 3/5 failed cart=c_7712 reason=TimeoutError: The operation was aborted due to timeout"],
    ["10:00:02.133", "WARN", "inventory-client", "attempt 4/5 failed cart=c_7712 reason=TimeoutError: The operation was aborted due to timeout"],
    ["10:00:02.634", "WARN", "inventory-client", "attempt 5/5 failed cart=c_7712 reason=TimeoutError: The operation was aborted due to timeout"],
    ["10:00:02.636", "WARN", "gateway", "Upstream returned 503 route=/api/checkout/quote; retrying (1 of 2)"],
    ["10:00:07.644", "INFO", "gateway", "GET /api/checkout/quote 503 7524ms"],
    ["10:00:20.410", "INFO", "db", "inventory failover complete; query latency p99=6ms"],
    ["10:01:00.000", "INFO", "metrics", "inventory-service rps=412 p99=4880ms checkout-api rps=86 gateway rps=29"],
    ["10:01:10.004", "INFO", "inventory", "requests_in_flight=1873"],
    ["10:20:00.000", "INFO", "metrics", "inventory-service rps=431 p99=5020ms checkout-api rps=87 gateway rps=29"],
    ["10:20:03.551", "INFO", "gateway", "GET /api/checkout/quote 503 7519ms"],
    ["10:40:00.000", "WARN", "gateway", "Load shedding enabled route=/api/checkout/quote"],
    ["10:42:00.000", "INFO", "metrics", "inventory-service rps=18 p99=38ms checkout-api rps=6 gateway rps=29"],
  ],
  network: [
    { log: 9, path: "/api/checkout/quote?cart=c_7712", ms: 7546, response: UNAVAILABLE },
    { log: 14, path: "/api/checkout/quote?cart=c_9034", ms: 7541, response: UNAVAILABLE },
  ],
  options: [
    [
      "failover-incomplete",
      "The database failover never really finished",
      "The new primary was still slow, so stock checks kept timing out.",
    ],
    [
      "retries-multiply-load",
      "Immediate retries at two layers multiplied the load beyond what the service could handle",
      "Each checkout request became up to fifteen stock checks with no backoff, so the slowdown fed itself and never cleared.",
    ],
    [
      "traffic-spike",
      "Customers flooded checkout when it started failing",
      "Shoppers refreshing during the failover sent far more checkout traffic than usual.",
    ],
    [
      "too-few-pods",
      "The inventory service simply has too few pods for normal traffic",
      "Four pods cannot keep up with ordinary checkout volume.",
    ],
  ],
});
