/*
 * Challenge 017: One Lamp, Two Buyers. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-23";

export const challenge017 = defineChallenge({
  number: "017",
  title: "One Lamp, Two Buyers",
  incident: "Two customers bought the last item in stock, and the warehouse could only ship one.",
  difficulty: "intermediate",
  tags: ["Transactions", "Concurrency", "SQL"],
  estimatedMinutes: 25,
  description:
    "During a flash sale the shop sold more lamps than it had. Stock never went below zero, every checkout succeeded, and yet the warehouse came up short.",
  category: "database",
  technologies: ["Python", "Flask", "SQLAlchemy", "PostgreSQL"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://shop.marlowhome.example",
  files: {
    "INCIDENT.md": `# INC-017 · One Lamp, Two Buyers

**Opened:** ${DATE} 19:30 UTC
**Severity:** SEV-2
**Service:** marlow-shop v8.3.1 (two web workers)

## Summary
SKU LAMP-07 had one unit left at the start of the 19:00 flash sale. Two
customers completed checkout for it within 40 ms of each other. The
warehouse picked one order and flagged the other as "no stock". Eleven
other SKUs were oversold the same way during the sale.

## Notes
- Stock is held in one PostgreSQL primary (default isolation level)
- There is no cache in front of stock levels
- stock_levels has CHECK (available >= 0)

## Your task
Explain how one unit was sold twice.
`,
    "requirements.txt": `flask==3.0.3
sqlalchemy==2.0.36
psycopg[binary]==3.2.3
gunicorn==23.0.0
`,
    "shop/inventory.py": `import logging

from sqlalchemy import select, update

from shop.db import engine
from shop.schema import stock_levels

log = logging.getLogger("inventory")


class OutOfStock(Exception):
    pass


def reserve(sku: str, quantity: int, *, order_id: str) -> int:
    """Takes quantity units of sku out of available stock and returns what is left."""
    with engine.begin() as conn:
        available = conn.execute(
            select(stock_levels.c.available).where(stock_levels.c.sku == sku)
        ).scalar_one()
        log.info("reserve sku=%s order=%s read available=%d", sku, order_id, available)
        if available < quantity:
            raise OutOfStock(sku)

        remaining = available - quantity
        conn.execute(update(stock_levels).where(stock_levels.c.sku == sku).values(available=remaining))
        log.info("reserve sku=%s order=%s wrote available=%d", sku, order_id, remaining)
        return remaining
`,
    "shop/checkout.py": `import logging

from flask import Blueprint, jsonify, request

from shop import orders
from shop.inventory import OutOfStock, reserve

bp = Blueprint("checkout", __name__)
log = logging.getLogger("checkout")


@bp.post("/api/checkout")
def checkout():
    cart = request.get_json()
    order_id = orders.new_id()
    try:
        for line in cart["lines"]:
            reserve(line["sku"], line["quantity"], order_id=order_id)
    except OutOfStock as error:
        return jsonify(error="out_of_stock", sku=str(error)), 409
    orders.create(order_id, cart)
    log.info("order created order=%s", order_id)
    return jsonify(order=order_id), 201
`,
    "shop/schema.py": `from sqlalchemy import CheckConstraint, Column, Integer, MetaData, Table, Text

metadata = MetaData()

stock_levels = Table(
    "stock_levels",
    metadata,
    Column("sku", Text, primary_key=True),
    Column("on_hand", Integer, nullable=False),
    Column("available", Integer, nullable=False),
    CheckConstraint("available >= 0", name="available_not_negative"),
)
`,
    "shop/db.py": `import os

from sqlalchemy import create_engine

# Default isolation level (READ COMMITTED). One primary; no replicas are used by the shop.
engine = create_engine(os.environ["DATABASE_URL"], pool_size=10)
`,
  },
  logs: [
    ["19:00:00.002", "INFO", "web-1", "Flash sale started"],
    ["19:00:03.118", "INFO", "web-1", "reserve sku=LAMP-07 order=ord_8810 read available=1"],
    ["19:00:03.131", "INFO", "web-2", "reserve sku=LAMP-07 order=ord_8811 read available=1"],
    ["19:00:03.140", "INFO", "web-1", "reserve sku=LAMP-07 order=ord_8810 wrote available=0"],
    ["19:00:03.149", "INFO", "web-1", "order created order=ord_8810"],
    ["19:00:03.150", "INFO", "web-1", "POST /api/checkout 201 52ms"],
    ["19:00:03.158", "INFO", "web-2", "reserve sku=LAMP-07 order=ord_8811 wrote available=0"],
    ["19:00:03.166", "INFO", "web-2", "order created order=ord_8811"],
    ["19:00:03.167", "INFO", "web-2", "POST /api/checkout 201 49ms"],
    ["19:00:09.502", "INFO", "web-1", "reserve sku=LAMP-07 order=ord_8815 read available=0"],
    ["19:00:09.504", "INFO", "web-1", "POST /api/checkout 409 6ms"],
    ["19:12:40.771", "WARN", "warehouse", "Pick failed order=ord_8811 sku=LAMP-07 reason=no_stock on_hand=0"],
    ["19:25:02.330", "INFO", "web-2", "GET /api/admin/stock/LAMP-07 200 5ms"],
  ],
  network: [
    {
      log: 6,
      body: '{"lines":[{"sku":"LAMP-07","quantity":1}]}',
      requestHeaders: { cookie: "cart=7a1d" },
      response: '{"order":"ord_8810"}',
    },
    {
      log: 13,
      requestHeaders: { cookie: "admin_sid=e93b" },
      response: '{"sku":"LAMP-07","on_hand":0,"available":0,"orders_today":["ord_8810","ord_8811"],"picked":["ord_8810"]}',
    },
  ],
  options: [
    [
      "stale-replica-read",
      "Stock was read from a replica that had not caught up",
      "The second checkout read stock from a lagging copy of the database.",
    ],
    [
      "negative-stock-allowed",
      "Nothing stops stock from going below zero",
      "Without a constraint, the second sale takes stock to -1 and nothing complains.",
    ],
    [
      "read-modify-write-race",
      "Two checkouts read the same stock level before either wrote it back",
      "Reading the level, subtracting in the application and writing the result lets concurrent transactions overwrite each other.",
    ],
    [
      "stock-cache",
      "A cached stock level was out of date",
      "The second checkout used a cached value instead of the database.",
    ],
  ],
});
