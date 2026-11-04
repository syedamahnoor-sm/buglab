import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server.js";
import { NextRequest } from "next/server";
import { listChallengeSummaries } from "@/lib/challenge-catalog";
import { challengePath } from "@/lib/challenge-routes";
import { config, proxy } from "@/proxy";

const BASE = "http://localhost:3000";
const run = (path: string) => proxy(new NextRequest(BASE + path));

/** True when the proxy lets the request continue to the route unchanged. */
function passesThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1" && !response.headers.has("x-middleware-rewrite");
}

async function assertRejected(path: string) {
  const response = run(path);
  assert.equal(response.status, 404, path);
  assert.equal(passesThrough(response), false, path);
  assert.equal(response.headers.get("location"), null, `${path}: never redirected`);
  assert.equal(response.headers.get("x-middleware-rewrite"), null, `${path}: never rewritten`);
  assert.equal(response.headers.get("cache-control"), "no-store", path);
  assert.equal(await response.text(), "Challenge not found.", path);
}

const matches = (path: string) => unstable_doesMiddlewareMatch({ config, url: BASE + path });

describe("challenge proxy: request handling", () => {
  test("lets Challenge 001's path through unchanged", () => {
    const response = run("/challenges/challenge-001");
    assert.equal(response.status, 200);
    assert.ok(passesThrough(response));
  });

  test("lets every catalog challenge's path through", () => {
    for (const { id } of listChallengeSummaries()) assert.ok(passesThrough(run(challengePath(id))), id);
  });

  test("keeps query strings on valid paths", () => {
    for (const query of ["?x=1", "?_rsc=abc123", "?"]) {
      assert.ok(passesThrough(run(`/challenges/challenge-001${query}`)), query);
    }
  });

  test("rejects wrong-case IDs with a 404, never redirecting to the real one", async () => {
    for (const id of ["CHALLENGE-001", "Challenge-001", "challenge-00l", "chALLenge-001"]) {
      await assertRejected(`/challenges/${id}`);
    }
  });

  test("rejects unknown IDs with a 404", async () => {
    for (const id of ["challenge-999", "challenge-9999", "001", "__proto__", "constructor", "x"]) {
      await assertRejected(`/challenges/${id}`);
    }
  });

  test("rejects other encodings of a valid ID", async () => {
    for (const id of ["challenge%2D001", "challenge%2d001", "%63hallenge-001", "challenge-001%20", "challenge-001%00"]) {
      await assertRejected(`/challenges/${id}`);
    }
  });

  test("rejects unknown IDs whatever their query string", async () => {
    await assertRejected("/challenges/CHALLENGE-001?_rsc=abc123");
    await assertRejected("/challenges/challenge-999?id=challenge-001");
  });
});

describe("challenge proxy: matcher", () => {
  test("runs on single-segment challenge paths", () => {
    for (const path of ["/challenges/challenge-001", "/challenges/CHALLENGE-001", "/challenges/x?y=1"]) {
      assert.ok(matches(path), path);
    }
  });

  test("does not run on any other route or asset", () => {
    for (const path of [
      "/",
      "/challenges",
      "/api/challenges/challenge-001/diagnosis",
      "/api/challenges/CHALLENGE-001/diagnosis",
      "/_next/static/chunks/app.js",
      "/_next/image?url=%2Fx.png&w=64&q=75",
      "/monaco/0.57.0/vs/loader.js",
      "/favicon.ico",
      "/challenge-001",
      "/challenges-archive/x",
    ]) {
      assert.equal(matches(path), false, path);
    }
  });
});

describe("challenge proxy: public data only", () => {
  test("reads only the public catalog and the challenge path helper", () => {
    const source = readFileSync(new URL("../../src/proxy.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map(([, from]) => from);
    assert.deepEqual(imports, ["next/server", "@/lib/challenge-catalog", "@/lib/challenge-routes"]);
    assert.doesNotMatch(source, /answer-key|\.server\b|@\/server\/|server-only|session|cookies|headers\(\)/);
  });
});
