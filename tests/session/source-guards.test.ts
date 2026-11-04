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
  test("the module contains the files the learner-session foundation defines, and nothing else", () => {
    assert.deepEqual(sessionFiles.map(name).sort(), [
      "src/server/session/attempt-window.ts",
      "src/server/session/cookie.ts",
      "src/server/session/expiry.ts",
      "src/server/session/handlers.ts",
      "src/server/session/memory-store.ts",
      "src/server/session/request-hash.ts",
      "src/server/session/service.ts",
      "src/server/session/snapshots.ts",
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

  test("durations are defined in expiry.ts and attempt-window.ts and nowhere else in the module", () => {
    const homes = ["expiry.ts", "attempt-window.ts"];
    for (const path of sessionFiles.filter((file) => !homes.some((home) => file.endsWith(home)))) {
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

  test("no client-facing type mentions a token, its hash or an internal learner id", () => {
    for (const path of sourceFiles(join(ROOT, "src/types"))) {
      assert.doesNotMatch(
        withoutComments(read(path)),
        /tokenHash|SessionToken|sessionToken|learnerId|LearnerRecord|ChallengeSessionRecord/,
        name(path),
      );
    }
  });

  test("this phase adds no public API: nothing under src/app imports the session module", () => {
    for (const path of sourceFiles(join(ROOT, "src/app"))) {
      assert.doesNotMatch(read(path), /@\/server\/session|server\/session\//, name(path));
    }
  });

  test("no session file imports the challenge loader and registry: the service is given a diagnosis registry and a version function", () => {
    // Moved here from tests/challenges/source-guards.test.ts, where it covered only service.ts.
    for (const path of sessionFiles) {
      assert.doesNotMatch(read(path), /server\/challenges/, name(path));
    }
  });

  test("the module reaches challenges only through the injected registry, never the answer key itself", () => {
    for (const path of sessionFiles) {
      const code = withoutComments(read(path));
      assert.doesNotMatch(code, /answer-key|provisionalAnswerKey|challenge-001|createDefaultRegistry/, name(path));
    }
  });

  test("the learner cookie is defined once, and the service never reads a completion or id from a caller", () => {
    const cookieSource = withoutComments(read(join(SESSION_DIR, "cookie.ts")));
    assert.match(cookieSource, /LEARNER_COOKIE = "buglab_learner"/);

    const service = withoutComments(read(join(SESSION_DIR, "service.ts")));
    // Identity is parsed from the cookie value. No method takes a learner id, a session id or a completed flag.
    assert.doesNotMatch(service, /\bcompleted\s*:\s*(true|boolean)|body\.(completed|status)|learnerId\s*:\s*string/);
  });

  test("the existing buglab_attempt cookie is not reused as the session identity", () => {
    for (const path of sessionFiles) {
      assert.doesNotMatch(read(path), /buglab_attempt|ATTEMPT_COOKIE/, name(path));
    }
  });
});
