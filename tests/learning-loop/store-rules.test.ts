import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReflectionBody } from "@/server/learning-loop/store-rules";

test("trims ends only and rejects empty/too-large bodies", () => {
  assert.equal(normalizeReflectionBody("  hi\nthere  "), "hi\nthere");
  assert.throws(() => normalizeReflectionBody("   "));
  assert.throws(() => normalizeReflectionBody("x".repeat(20000)));
});
