/*
 * Persistence across application restarts: real operating-system processes against a real PostgreSQL.
 *
 * Phase one runs in a child process that issues a learner, starts a challenge and completes it through the real
 * diagnosis handler. That process EXITS. Phase two runs in a brand-new process, with a new connection pool and a
 * new store and nothing in memory, and uses only the cookie the first one issued. If any state lived in a
 * process-local Map, file or counter, phase two would find nothing.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashSessionToken, parseSessionToken } from "@/server/session/token";
import { createTestDatabase, SKIP, type TestDatabase } from "./helpers";
import { RESOLUTION } from "../diagnosis/fixtures";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function runWorker(phase: "write" | "read", databaseUrl: string, state?: unknown) {
  const run = spawnSync(process.execPath, ["--import", "./tests/setup/register.mjs", "tests/postgres/restart-worker.ts", phase], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, WORKER_DATABASE_URL: databaseUrl, ...(state ? { WORKER_STATE: JSON.stringify(state) } : {}) },
    timeout: 60_000,
  });
  assert.equal(run.status, 0, `the ${phase} process failed:\n${run.stderr}`);
  const line = run.stdout.trim().split("\n").at(-1) ?? "";
  return { pid: run.pid, output: JSON.parse(line), stderr: run.stderr };
}

describe("state survives an application restart (real processes, real PostgreSQL)", { skip: SKIP }, () => {
  let db: TestDatabase;
  before(async () => {
    db = await createTestDatabase();
  });
  after(async () => {
    await db.drop();
  });

  test("a learner, its session, its attempts and its completion are all still there in a fresh process", () => {
    const first = runWorker("write", db.url);
    assert.equal(first.output.started.status, "ok");
    assert.equal(first.output.wrong.status, 200);
    assert.equal(first.output.wrong.body.status, "incorrect");
    assert.equal(first.output.correct.status, 200);
    assert.equal(first.output.correct.body.status, "correct");
    assert.equal(first.output.correct.body.resolution.summary, RESOLUTION);

    // The first process is gone. A different one reads everything back using only the cookie.
    const second = runWorker("read", db.url, { cookie: first.output.cookie });
    assert.notEqual(second.pid, first.pid, "a genuinely separate process");

    assert.equal(second.output.learner.state, "active", "the learner survived");
    const view = second.output.session.session;
    assert.equal(view.status, "completed", "the session survived and is still completed");
    assert.equal(view.attempts.total, 2);
    assert.equal(view.attempts.wrong, 1);
    assert.equal(view.completion.resolution.summary, RESOLUTION, "the stored completion result survived");
    assert.deepEqual(
      second.output.attempts.attempts.map((attempt: { result: string }) => attempt.result),
      ["incorrect", "correct"],
      "both attempts survived, in order",
    );
  });

  test("a submission repeated after the restart is answered from what was stored, with 200", () => {
    const first = runWorker("write", db.url);
    const second = runWorker("read", db.url, { cookie: first.output.cookie });

    // The same idempotency key and payload: replayed, not judged again.
    assert.equal(second.output.replayCorrect.status, 200);
    assert.equal(second.output.replayCorrect.body.status, "correct");
    assert.equal(second.output.replayCorrect.body.resolution.summary, RESOLUTION);
    assert.equal(second.output.replayWrong.status, 200);
    assert.equal(second.output.replayWrong.body.status, "incorrect", "the earlier wrong answer is replayed as it was");

    // A brand-new submission to the completed session gets the stored correct result, not a new verdict.
    assert.equal(second.output.afterCompletion.status, 200);
    assert.equal(second.output.afterCompletion.body.status, "correct");
    assert.equal(second.output.afterCompletion.body.resolution.summary, RESOLUTION);
  });

  test("replays and completed-session submissions recorded nothing new", async () => {
    const first = runWorker("write", db.url);
    runWorker("read", db.url, { cookie: first.output.cookie });

    const token = parseSessionToken(first.output.cookie);
    assert.ok(token, "the cookie is a well-formed token");
    const client = new pg.Client({ connectionString: db.url });
    await client.connect();
    try {
      // Exactly this learner's attempts: the wrong one, then the correct one. The three submissions the read phase
      // made (a replay of each, and a fresh key after completion) added no rows.
      const { rows } = await client.query(
        `SELECT a.outcome FROM diagnosis_attempts a
           JOIN challenge_sessions s ON s.id = a.session_id
           JOIN learners l ON l.id = s.learner_id
          WHERE l.token_hash = $1
          ORDER BY a.seq`,
        [hashSessionToken(token)],
      );
      assert.deepEqual(rows.map((row) => row.outcome), ["incorrect", "correct"]);
    } finally {
      await client.end();
    }
  });

  test("the worker processes print nothing but their one line of JSON: no log line leaks a token or a connection string", () => {
    const first = runWorker("write", db.url);
    const second = runWorker("read", db.url, { cookie: first.output.cookie });
    for (const run of [first, second]) {
      assert.equal(run.stderr.trim(), "");
      assert.ok(!run.stderr.includes(db.url));
    }
  });
});
