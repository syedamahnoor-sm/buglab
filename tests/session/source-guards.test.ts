/*
 * Static guards on the session module's source. They protect properties that are
 * easy to break by accident and hard to see in a diff: the module staying on the
 * server, tokens never being logged, randomness coming from the crypto API, and
 * numeric expiry values staying in one place.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SESSION_DIR = join(ROOT, "src/server/session");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function read(path: string) {
  return readFileSync(path, "utf8");
}

/** The code with comments removed, so a guard does not trip over prose. */
function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const sessionFiles = sourceFiles(SESSION_DIR);
const name = (path: string) => relative(ROOT, path).replaceAll("\\", "/");

describe("session module: source guards", () => {
  test("the module contains the files M1-1 defines, and nothing else", () => {
    assert.deepEqual(sessionFiles.map(name).sort(), [
      "src/server/session/expiry.ts",
      "src/server/session/memory-store.ts",
      "src/server/session/token.ts",
      "src/server/session/types.ts",
    ]);
  });

  test("every file is server-only", () => {
    for (const path of sessionFiles) {
      assert.match(withoutComments(read(path)).trimStart(), /^import "server-only";/, name(path));
    }
  });

  test("no file logs, so a token can never be printed", () => {
    for (const path of sessionFiles) {
      assert.doesNotMatch(withoutComments(read(path)), /\bconsole\s*\./, name(path));
    }
  });

  test("tokens come from the crypto API, never from Math.random", () => {
    for (const path of sessionFiles) {
      assert.doesNotMatch(withoutComments(read(path)), /Math\.random/, name(path));
    }
    assert.match(withoutComments(read(join(SESSION_DIR, "token.ts"))), /randomBytes\(SESSION_TOKEN_BYTES\)/);
  });

  test("the in-memory store never awaits, so each operation runs to completion", () => {
    assert.doesNotMatch(withoutComments(read(join(SESSION_DIR, "memory-store.ts"))), /\bawait\b/);
  });

  test("the in-memory store is labelled development and test only, and has no global singleton", () => {
    const source = read(join(SESSION_DIR, "memory-store.ts"));

    assert.match(source, /DEVELOPMENT AND TEST ONLY/);
    assert.doesNotMatch(withoutComments(source), /globalThis/);
  });

  test("expiry durations are defined in expiry.ts and nowhere else in the module", () => {
    for (const path of sessionFiles.filter((file) => !file.endsWith("expiry.ts"))) {
      assert.doesNotMatch(withoutComments(read(path)), /\b\d+\s*\*\s*(24|60|1000)\b|86_?400|\b\d{6,}\b/, name(path));
    }
  });

  test("nothing that can reach the browser imports the session module", () => {
    const clientSide = ["src/components", "src/engine", "src/lib", "src/types", "src/data", "src/config"];
    for (const dir of clientSide) {
      for (const path of sourceFiles(join(ROOT, dir))) {
        assert.doesNotMatch(read(path), /@\/server\/session|server\/session\//, name(path));
      }
    }
  });

  test("no client-facing type mentions a session token or its hash", () => {
    for (const path of sourceFiles(join(ROOT, "src/types"))) {
      assert.doesNotMatch(withoutComments(read(path)), /tokenHash|SessionToken|sessionToken/, name(path));
    }
  });

  test("the existing buglab_attempt cookie is not reused as the session identity", () => {
    for (const path of sessionFiles) {
      assert.doesNotMatch(read(path), /buglab_attempt|ATTEMPT_COOKIE/, name(path));
    }
  });
});
