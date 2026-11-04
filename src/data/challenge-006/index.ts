/*
 * Challenge 006: The Missing Recent Orders. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-21";
const COOKIE = { cookie: "session=9a51c3e0b7d24f6e" };

/** c_1093's 47 orders, newest first, as the database returns them. */
const orders = Array.from({ length: 47 }, (_, index) => {
  const day = new Date(Date.UTC(2026, 9, 20) - index * 4 * 86_400_000);
  return { id: `ord_${7173 - index}`, placed_at: day.toISOString().slice(0, 10), total: `${(19 + ((index * 37) % 180)).toFixed(2)}` };
});
const page = (pageNumber: number, rows: unknown[], total: number) =>
  JSON.stringify({ page: pageNumber, per_page: 20, total, pages: Math.ceil(total / 20), orders: rows });

export const challenge006 = defineChallenge({
  number: "006",
  title: "The Missing Recent Orders",
  incident: "Customers' order history no longer shows their most recent orders, and some customers see no orders at all.",
  difficulty: "beginner",
  tags: ["Pagination", "REST", "FastAPI"],
  estimatedMinutes: 15,
  description:
    "After a refactor of the orders endpoint, the order history page skips customers' newest purchases, and customers with only a few orders are told they have none.",
  category: "api",
  technologies: ["Python", "FastAPI", "PostgreSQL", "React"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://shop.fernleaf.example",
  files: {
    "INCIDENT.md": `# INC-006 · The Missing Recent Orders

**Opened:** ${DATE} 10:30 UTC
**Severity:** SEV-3
**Service:** fernleaf-orders-api v1.9.0 (released ${DATE} 09:40 UTC)

## Summary
Customers report that "My orders" no longer shows what they bought last
week. Customer c_2210, who has 12 orders, sees "You haven't placed any
orders yet".

## What we know
- v1.9.0 moved pagination from the React app into the API
- The orders table looks complete: every order is present in the database
- Support reproduced the problem by viewing both customers' order pages

## Your task
Explain why recent orders are missing from the order history.
`,
    "requirements.txt": `fastapi==0.115.4
uvicorn==0.32.0
sqlalchemy==2.0.36
psycopg[binary]==3.2.3
`,
    "app/main.py": `import logging

from fastapi import FastAPI

from app.routes import orders

logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s")

app = FastAPI(title="fernleaf-orders-api", version="1.9.0")
app.include_router(orders.router)
`,
    "app/routes/orders.py": `import math

from fastapi import APIRouter, Depends, Query

from app.auth import Customer, current_customer
from app.repositories import orders as orders_repo

router = APIRouter()

PAGE_SIZE_LIMIT = 100


@router.get("/api/orders")
def list_orders(
    page: int = Query(1, ge=1, description="1-based page number"),
    per_page: int = Query(20, ge=1, le=PAGE_SIZE_LIMIT),
    customer: Customer = Depends(current_customer),
):
    total = orders_repo.count_for(customer.id)
    rows = orders_repo.page_for(customer.id, limit=per_page, offset=page * per_page)
    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "pages": math.ceil(total / per_page),
        "orders": rows,
    }
`,
    "app/repositories/orders.py": `import logging

from sqlalchemy import text

from app.db import engine

log = logging.getLogger("sql")

COUNT = text("SELECT count(*) FROM orders WHERE customer_id = :customer_id")
PAGE = text(
    """
    SELECT id, placed_at::text AS placed_at, total::text AS total
    FROM orders
    WHERE customer_id = :customer_id
    ORDER BY placed_at DESC, id DESC
    LIMIT :limit OFFSET :offset
    """
)


def count_for(customer_id: str) -> int:
    with engine.connect() as conn:
        total = conn.execute(COUNT, {"customer_id": customer_id}).scalar_one()
    log.debug("count customer=%s total=%d", customer_id, total)
    return total


def page_for(customer_id: str, *, limit: int, offset: int) -> list[dict]:
    log.debug("orders query customer=%s limit=%d offset=%d", customer_id, limit, offset)
    with engine.connect() as conn:
        result = conn.execute(PAGE, {"customer_id": customer_id, "limit": limit, "offset": offset})
        return [dict(row._mapping) for row in result]
`,
    "app/db.py": `import os

from sqlalchemy import create_engine

engine = create_engine(os.environ.get("DATABASE_URL", "postgresql+psycopg://localhost/fernleaf"), pool_size=10)
`,
    "web/src/OrderHistory.tsx": `import { useEffect, useState } from "react";

interface OrdersPage {
  page: number;
  pages: number;
  total: number;
  orders: { id: string; placed_at: string; total: string }[];
}

export function OrderHistory() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OrdersPage | null>(null);

  useEffect(() => {
    fetch(\`/api/orders?page=\${page}\`, { credentials: "same-origin" })
      .then((response) => response.json())
      .then(setData);
  }, [page]);

  if (!data) return <p>Loading…</p>;
  if (data.orders.length === 0) return <p>You haven't placed any orders yet.</p>;

  return (
    <section>
      <ul>
        {data.orders.map((order) => (
          <li key={order.id}>
            {order.placed_at} · {order.id} · £{order.total}
          </li>
        ))}
      </ul>
      <nav>
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</button>
        <span>Page {data.page} of {data.pages}</span>
        <button disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Older</button>
      </nav>
    </section>
  );
}
`,
  },
  logs: [
    ["09:40:12.880", "INFO", "uvicorn", "Application startup complete."],
    ["10:14:03.221", "DEBUG", "sql", "count customer=c_1093 total=47"],
    ["10:14:03.240", "DEBUG", "sql", "orders query customer=c_1093 limit=20 offset=20"],
    ["10:14:03.247", "INFO", "uvicorn.access", "GET /api/orders?page=1 200 31ms"],
    ["10:14:09.102", "DEBUG", "sql", "count customer=c_1093 total=47"],
    ["10:14:09.110", "DEBUG", "sql", "orders query customer=c_1093 limit=20 offset=40"],
    ["10:14:09.114", "INFO", "uvicorn.access", "GET /api/orders?page=2 200 18ms"],
    ["10:14:15.880", "DEBUG", "sql", "count customer=c_1093 total=47"],
    ["10:14:15.886", "DEBUG", "sql", "orders query customer=c_1093 limit=20 offset=60"],
    ["10:14:15.889", "INFO", "uvicorn.access", "GET /api/orders?page=3 200 9ms"],
    ["10:16:30.502", "DEBUG", "sql", "count customer=c_2210 total=12"],
    ["10:16:30.509", "DEBUG", "sql", "orders query customer=c_2210 limit=20 offset=20"],
    ["10:16:30.511", "INFO", "uvicorn.access", "GET /api/orders?page=1 200 7ms"],
  ],
  network: [
    { log: 4, initiator: "web/src/OrderHistory.tsx", requestHeaders: COOKIE, response: page(1, orders.slice(20, 40), 47) },
    { log: 7, initiator: "web/src/OrderHistory.tsx", requestHeaders: COOKIE, response: page(2, orders.slice(40), 47) },
    { log: 10, initiator: "web/src/OrderHistory.tsx", requestHeaders: COOKIE, response: page(3, [], 47) },
    {
      log: 13,
      initiator: "web/src/OrderHistory.tsx",
      requestHeaders: { cookie: "session=4c07e2a19f3b8d56" },
      response: page(1, [], 12),
    },
  ],
  options: [
    [
      "sorted-oldest-first",
      "The query sorts orders oldest first, so the newest end up on the last page",
      "An ascending sort pushes recent orders to the end of the list, past where customers look.",
    ],
    [
      "client-starts-at-page-two",
      "The React app asks for page 2 when it should ask for page 1",
      "The page counter starts one too high, so the first page of results is never requested.",
    ],
    [
      "offset-skips-first-page",
      "The offset is calculated as if pages were numbered from 0",
      "With 1-based page numbers, multiplying the page by the page size skips a full page of rows before the first one shown.",
    ],
    [
      "count-is-wrong",
      "The total count is wrong, so the page navigation is cut short",
      "The count query does not match the page query, so the app thinks there are fewer pages than there are.",
    ],
    [
      "stale-cache",
      "A cache is serving order lists from before the recent orders were placed",
      "Responses are cached somewhere between the API and the browser, so recent orders do not appear yet.",
    ],
  ],
});
