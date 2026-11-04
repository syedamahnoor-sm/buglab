/*
 * Challenge 028: The Cache That Lied. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-09";
const product = (price: string) =>
  JSON.stringify({ id: "p_311", slug: "linen-shirt", name: "Linen shirt", price, currency: "GBP" });

export const challenge028 = defineChallenge({
  number: "028",
  title: "The Cache That Lied",
  incident: "A price change saved in the admin panel still shows the old price on the shop an hour later.",
  difficulty: "beginner",
  tags: ["Caching", "Redis", "Invalidation"],
  estimatedMinutes: 15,
  description:
    "Merchandising cut the price of the linen shirt from 49.00 to 39.00. The admin panel shows 39.00, the database says 39.00, and the product page still says 49.00.",
  category: "performance",
  technologies: ["TypeScript", "Node.js", "Redis", "PostgreSQL"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://shop.northfold.example",
  files: {
    "INCIDENT.md": `# INC-028 · The Cache That Lied

**Opened:** ${DATE} 09:00 UTC
**Severity:** SEV-3
**Service:** northfold-catalog v3.1.0

## Summary
At 08:10 the linen shirt (p_311) was reduced to 39.00. Customers still
see 49.00 on the product page almost an hour later. The admin panel and the
database both show 39.00.

## Notes
- Product responses are cached in Redis for 24 hours
- Saving a product in the admin panel is supposed to clear its cache entry
- There is no CDN in front of /api; responses carry Cache-Control: no-store

## Your task
Explain why the shop keeps showing the old price.
`,
    "package.json": `{
  "name": "northfold-catalog",
  "version": "3.1.0",
  "private": true,
  "dependencies": { "express": "^4.21.1", "redis": "^4.7.0", "pg": "^8.13.1" }
}
`,
    "src/cache.ts": `import { createClient } from "redis";
import { log } from "./log";

export const redis = createClient({ url: process.env.REDIS_URL });

const TTL_SECONDS = 24 * 60 * 60;

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) {
    log.debug("cache", \`hit key=\${key}\`);
    return JSON.parse(hit) as T;
  }
  log.debug("cache", \`miss key=\${key}\`);
  const value = await load();
  await redis.set(key, JSON.stringify(value), { EX: TTL_SECONDS });
  return value;
}

export async function invalidate(key: string) {
  await redis.del(key);
  log.info("cache", \`invalidated key=\${key}\`);
}
`,
    "src/routes/products.ts": `import { Router } from "express";
import { cached } from "../cache";
import { products } from "../products";

export const productRoutes = Router();

// Product pages are addressed by slug, for readable URLs.
productRoutes.get("/api/products/:slug", async (req, res) => {
  const product = await cached(\`product:\${req.params.slug}\`, () => products.bySlug(req.params.slug));
  if (!product) return res.status(404).json({ error: "Not found" });
  res.set("Cache-Control", "no-store").json(product);
});
`,
    "src/routes/admin-products.ts": `import { Router } from "express";
import { invalidate } from "../cache";
import { log } from "../log";
import { products } from "../products";

export const adminProducts = Router();

adminProducts.post("/api/admin/products/:id", async (req, res) => {
  const updated = await products.update(req.params.id, { price: String(req.body.price) });
  log.info("admin", \`Product updated id=\${updated.id} price=\${updated.price}\`);
  await invalidate(\`product:\${updated.id}\`);
  res.json(updated);
});
`,
    "src/products.ts": `import { pool } from "./db";

export interface Product {
  id: string;
  slug: string;
  name: string;
  price: string;
  currency: string;
}

const COLUMNS = "id, slug, name, price::text AS price, currency";

export const products = {
  bySlug: async (slug: string) =>
    (await pool.query<Product>(\`SELECT \${COLUMNS} FROM products WHERE slug = $1\`, [slug])).rows[0] ?? null,
  update: async (id: string, change: { price: string }) =>
    (await pool.query<Product>(\`UPDATE products SET price = $2 WHERE id = $1 RETURNING \${COLUMNS}\`, [id, change.price])).rows[0],
};
`,
  },
  logs: [
    ["08:10:12.301", "INFO", "admin", "Product updated id=p_311 price=39.00"],
    ["08:10:12.304", "INFO", "cache", "invalidated key=product:p_311"],
    ["08:10:12.305", "INFO", "http", "POST /api/admin/products/p_311 200 18ms"],
    ["08:11:03.552", "DEBUG", "cache", "hit key=product:linen-shirt"],
    ["08:11:03.553", "INFO", "http", "GET /api/products/linen-shirt 200 2ms"],
    ["08:52:40.118", "DEBUG", "cache", "hit key=product:linen-shirt"],
    ["08:52:40.119", "INFO", "http", "GET /api/products/linen-shirt 200 2ms"],
    ["08:53:15.004", "INFO", "db", "SELECT price FROM products WHERE id = 'p_311' -> 39.00"],
    ["08:54:02.770", "INFO", "cache", "redis TTL product:linen-shirt = 2398 s; key product:p_311 does not exist"],
  ],
  network: [
    {
      log: 3,
      body: '{"price":"39.00"}',
      requestHeaders: { cookie: "admin_sid=4e0c" },
      response: product("39.00"),
    },
    { log: 5, responseHeaders: { "cache-control": "no-store" }, response: product("49.00") },
    { log: 7, responseHeaders: { "cache-control": "no-store" }, response: product("49.00") },
  ],
  options: [
    [
      "cdn-cache",
      "A CDN or browser cache is serving the old response",
      "A cache outside the application keeps the old product response.",
    ],
    [
      "update-not-saved",
      "The price change was never written to the database",
      "The admin save fails silently, so the database still holds the old price.",
    ],
    [
      "invalidates-wrong-key",
      "Saving clears a cache key that the shop never reads",
      "The admin save deletes the entry keyed by product id, but the product page caches under its slug.",
    ],
    [
      "ttl-too-long",
      "The cache lifetime is simply too long",
      "Entries live for 24 hours, so any change takes a day to appear.",
    ],
  ],
});
