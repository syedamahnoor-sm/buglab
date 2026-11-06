import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { learnerPersistenceMode } from "@/server/learner-persistence";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides };
}

test("learner persistence stays in memory unless BUGLAB_DATABASE_URL is set", () => {
  assert.equal(learnerPersistenceMode(env()), "memory");
  assert.equal(learnerPersistenceMode(env({ BUGLAB_DATABASE_URL: "   " })), "memory");
  assert.equal(learnerPersistenceMode(env({ BUGLAB_DATABASE_URL: "postgres://localhost/buglab_isolated" })), "postgres");
});

test("mounted account route does not inject the learner-linking adapter", () => {
  const route = read("src/app/api/account/[...path]/route.ts");
  assert.match(route, /createAccountHandler\(\)/);
  assert.doesNotMatch(route, /learner\s*:/);
});

test("learner HTTP selects Postgres persistence only through the runtime URL", () => {
  const source = read("src/server/learner-http.ts");
  assert.match(source, /resolveLearnerPersistence\(\)/);
  assert.match(source, /createPostgresLearningLoopStore/);
  assert.match(source, /verifySchema\(/);
  assert.match(source, /startPeriodicPurge/);
  assert.doesNotMatch(source, /new PostgresLearningLoopStore\(/);
  assert.match(source, /new MemoryLearningLoopStore/);
});
