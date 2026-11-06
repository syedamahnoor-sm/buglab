/**
 * The mounted learner composition against a throwaway database.
 * Migration 0003 is excluded. Nothing here points at a shared database.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import pg from "pg";
import { getLearnerHttp, resetSharedLearnerHttpForTests } from "@/server/learner-http";
import { createTestDatabase, ensureTestPgcrypto, SKIP, type TestDatabase } from "./helpers";

const ORIGIN = "http://127.0.0.1:3000";
const databases: TestDatabase[] = [];

after(async () => {
  await resetSharedLearnerHttpForTests();
  await Promise.all(databases.map((db) => db.drop()));
});

describe("mounted learner composition", { skip: SKIP }, () => {
  test("a database without the Learning Loop migration does not create a learner", async () => {
    const db = await createTestDatabase({ through: "0002_rate_limit_buckets" });
    databases.push(db);
    const response = await postLearner(db.url);
    assert.equal(response.status, 500);
    const probe = new pg.Client({ connectionString: db.url });
    await probe.connect();
    try {
      const learners = await probe.query<{ count: string }>("SELECT count(*)::text AS count FROM learners");
      const links = await probe.query<{ present: string | null }>("SELECT to_regclass('public.account_learner_links') AS present");
      assert.equal(learners.rows[0].count, "0");
      assert.equal(links.rows[0].present, null);
    } finally {
      await probe.end();
    }
  });

  test("a migrated database creates one learner and does not apply account linking", async () => {
    const db = await createTestDatabase({
      through: "0005_diagnosis_submission_claims",
      exclude: ["0003_account_links"],
    });
    databases.push(db);
    const setup = new pg.Pool({ connectionString: db.url, max: 1 });
    setup.on("error", () => {});
    try {
      await ensureTestPgcrypto(setup);
    } finally {
      await setup.end();
    }

    const response = await postLearner(db.url);
    assert.equal(response.status, 201);
    const cookie = response.headers.get("set-cookie") ?? "";
    const token = /buglab_learner=([^;]+)/.exec(cookie)?.[1] ?? "";
    assert.match(cookie, /HttpOnly/i);
    assert.notEqual(token, "");

    const probe = new pg.Client({ connectionString: db.url });
    await probe.connect();
    try {
      const learners = await probe.query<{ token_hash: string }>("SELECT token_hash FROM learners");
      const versions = await probe.query<{ version: string }>("SELECT version FROM buglab_schema_migrations ORDER BY version");
      const links = await probe.query<{ present: string | null }>("SELECT to_regclass('public.account_learner_links') AS present");
      assert.equal(learners.rows.length, 1);
      assert.notEqual(learners.rows[0].token_hash, token);
      assert.match(learners.rows[0].token_hash, /^[0-9a-f]{64}$/);
      assert.deepEqual(versions.rows.map((row) => row.version), [
        "0001_learner_sessions",
        "0002_rate_limit_buckets",
        "0004_learning_reflections",
        "0005_diagnosis_submission_claims",
      ]);
      assert.equal(links.rows[0].present, null);
    } finally {
      await probe.end();
    }
  });
});

async function postLearner(databaseUrl: string): Promise<Response> {
  await resetSharedLearnerHttpForTests();
  const previous = {
    url: process.env.BUGLAB_DATABASE_URL,
    origin: process.env.BUGLAB_APP_ORIGIN,
    hops: process.env.BUGLAB_TRUSTED_PROXY_HOPS,
    nodeEnv: process.env.NODE_ENV,
  };
  setEnv("BUGLAB_DATABASE_URL", databaseUrl);
  setEnv("BUGLAB_APP_ORIGIN", undefined);
  setEnv("BUGLAB_TRUSTED_PROXY_HOPS", "0");
  setEnv("NODE_ENV", "test");
  try {
    return await getLearnerHttp().learner.POST(
      new Request(`${ORIGIN}/api/learner`, {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          "content-type": "application/json",
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
        },
        body: "{}",
      }),
    );
  } finally {
    setEnv("BUGLAB_DATABASE_URL", previous.url);
    setEnv("BUGLAB_APP_ORIGIN", previous.origin);
    setEnv("BUGLAB_TRUSTED_PROXY_HOPS", previous.hops);
    setEnv("NODE_ENV", previous.nodeEnv);
  }
}

function setEnv(name: string, value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}
