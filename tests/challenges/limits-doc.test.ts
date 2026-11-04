/*
 * The architecture document states the limits that the code enforces.
 *
 * Kept apart from limits.test.ts, which has no reason to read the documentation: this file travels
 * with the document, so each can be committed on its own. The limits themselves are pinned to
 * literal values in limits.test.ts, so a change to one fails there first and here second.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { LIMITS } from "@/server/challenges/limits";

describe("the documented limits", () => {
  const doc = readFileSync(fileURLToPath(new URL("../../docs/architecture/learner-session-foundation.md", import.meta.url)), "utf8");
  const start = doc.indexOf("**The limits, and the Challenge 001 values they are grounded in.**");
  // The table ends at the sentence that follows it.
  const end = doc.indexOf("The largest ratios are for code and bodies");

  test("the limits table is in section 8.7, followed by its closing sentence", () => {
    assert.ok(start > 0 && end > start);
  });

  test("the table states every limit that is enforced", () => {
    const table = doc.slice(start, end);

    for (const [key, value] of Object.entries(LIMITS)) {
      assert.ok(table.includes(value.toLocaleString("en-US")), `the documentation does not state ${key} = ${value.toLocaleString("en-US")}`);
    }
  });
});
