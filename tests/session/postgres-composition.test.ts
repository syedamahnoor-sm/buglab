import assert from "node:assert/strict";
import { test } from "node:test";
import { getLearnerHttp, resetSharedLearnerHttpForTests } from "@/server/learner-http";

const UNREACHABLE = "postgres://buglab:secret@127.0.0.1:1/buglab_absent";
const ORIGIN = "http://127.0.0.1:3000";

test("a configured Postgres URL does not fall back to memory when the database is unreachable", { timeout: 20_000 }, async () => {
  const previous = {
    url: process.env.BUGLAB_DATABASE_URL,
    origin: process.env.BUGLAB_APP_ORIGIN,
    hops: process.env.BUGLAB_TRUSTED_PROXY_HOPS,
    nodeEnv: process.env.NODE_ENV,
  };
  setEnv("BUGLAB_DATABASE_URL", UNREACHABLE);
  setEnv("BUGLAB_APP_ORIGIN", undefined);
  setEnv("BUGLAB_TRUSTED_PROXY_HOPS", "0");
  setEnv("NODE_ENV", "test");
  try {
    const response = await getLearnerHttp().learner.POST(
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
    const body = await response.text();
    assert.equal(response.status, 500);
    assert.match(body, /Something went wrong/);
    assert.doesNotMatch(body, /secret|127\.0\.0\.1:1|postgres:\/\/|MemoryStore|password/);
  } finally {
    await resetSharedLearnerHttpForTests();
    setEnv("BUGLAB_DATABASE_URL", previous.url);
    setEnv("BUGLAB_APP_ORIGIN", previous.origin);
    setEnv("BUGLAB_TRUSTED_PROXY_HOPS", previous.hops);
    setEnv("NODE_ENV", previous.nodeEnv);
  }
});

function setEnv(name: string, value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}
