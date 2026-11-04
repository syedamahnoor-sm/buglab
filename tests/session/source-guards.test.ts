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
      "src/server/session/diagnosis-handler.ts",
      "src/server/session/expiry.ts",
      "src/server/session/handlers.ts",
      "src/server/session/memory-store.ts",
      "src/server/session/request-guards.ts",
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

describe("diagnosis submission handler and composition: source guards", () => {
  const handlerSource = withoutComments(read(join(SESSION_DIR, "diagnosis-handler.ts")));
  const guardsSource = withoutComments(read(join(SESSION_DIR, "request-guards.ts")));
  const handlersSource = withoutComments(read(join(SESSION_DIR, "handlers.ts")));
  const servicesPath = join(ROOT, "src/server/app-services.ts");

  test("the handler is not a second evaluator, validator, attempt store or limiter: it delegates to the service", () => {
    assert.doesNotMatch(handlerSource, /evaluateDiagnosis|validateDiagnosisSubmission|createDefaultRegistry|MemoryStore|new FixedWindowLimiter|new Map|new Set/);
    assert.doesNotMatch(handlerSource, /\.record\(|\.touch\(|\.start\(|\.restart\(|\.find\(|\.list\(/, "it never calls a store");
    assert.match(handlerSource, /deps\.service\.submitDiagnosis\(/);
    // The limiter is injected, and only its type is imported.
    assert.match(handlerSource, /import type \{ FixedWindowLimiter \}/);
  });

  test("the handler reads no field of the request body: identity and completion cannot come from it", () => {
    assert.doesNotMatch(handlerSource, /\bbody\s*\.\s*\w|\bbody\s*\[/);
    assert.doesNotMatch(handlerSource, /\.completed|completedAt|learnerId|sessionId|tokenHash/);
  });

  test("the handler imports nothing of the live diagnosis endpoint except the pure client-IP reader, the registry type and the limiter type", () => {
    const imports = [...handlerSource.matchAll(/from "([^"]+)"/g)].map((match) => match[1]).filter((path) => path.startsWith("@/server/diagnosis"));
    assert.deepEqual(imports.sort(), ["@/server/diagnosis/attempt-limiter", "@/server/diagnosis/client-ip", "@/server/diagnosis/registry"]);
    assert.doesNotMatch(handlerSource, /server\/diagnosis\/handler/);
  });

  test("the same-origin policy is written once, in request-guards.ts: neither handler file compares origins itself", () => {
    assert.match(guardsSource, /export function isSameOrigin/);
    assert.match(guardsSource, /sec-fetch-site/);
    for (const [file, source] of [["handlers.ts", handlersSource], ["diagnosis-handler.ts", handlerSource]]) {
      assert.doesNotMatch(source, /sec-fetch-site|new URL\(origin\)|\.origin\s*===|function isSameOrigin|headers\.get\("origin"\)/i, file);
    }
  });

  test("the guards keep the strict policy: whole-origin comparison, and a missing Origin needs Fetch Metadata", () => {
    assert.match(guardsSource, /claimed\.origin === new URL\(request\.url\)\.origin/);
    assert.match(guardsSource, /claimed\.origin !== "null"/);
    assert.match(guardsSource, /request\.headers\.get\("sec-fetch-site"\) === "same-origin"/);
    assert.doesNotMatch(guardsSource, /\.host\b|headers\.get\("host"\)/, "the Host header and the bare host are never compared");
  });

  test("the origin compatibility requirement is written down where the policy lives and where the handler is built", () => {
    const guards = read(join(SESSION_DIR, "request-guards.ts"));
    const handler = read(join(SESSION_DIR, "diagnosis-handler.ts"));

    assert.match(guards, /COMPATIBILITY REQUIREMENT BEFORE ANYTHING IS MOUNTED/);
    assert.match(guards, /not on any branch/);
    assert.match(guards, /ONE policy/);
    assert.match(handler, /unpublished change/);
    assert.match(handler, /compatibility requirement at the top of request-guards\.ts/);
  });

  test("nothing is mounted: the only route under src/app/api is the live diagnosis route", () => {
    const routes = sourceFiles(join(ROOT, "src/app/api")).map(name);
    assert.deepEqual(routes, ["src/app/api/challenges/[challengeId]/diagnosis/route.ts"]);
  });

  test("nothing but a test imports the composition root: no route, page, component, engine or other server code", () => {
    for (const path of sourceFiles(join(ROOT, "src"))) {
      if (path === servicesPath) continue;
      assert.doesNotMatch(read(path), /app-services/, name(path));
    }
  });

  test("the live diagnosis files do not import the session module, the guards or the composition root", () => {
    for (const path of sourceFiles(join(ROOT, "src/server/diagnosis"))) {
      assert.doesNotMatch(read(path), /server\/session|app-services|request-guards/, name(path));
    }
    const route = read(join(ROOT, "src/app/api/challenges/[challengeId]/diagnosis/route.ts"));
    assert.doesNotMatch(route, /server\/session|app-services|request-guards/);
  });

  test("the composition root is server-only, and is not evaluated into a store or a registry on import", () => {
    const source = withoutComments(read(servicesPath));

    assert.match(source.trimStart(), /^import "server-only";/);
    // Anything built at the top level would be built when the module is imported, including during `next build`.
    assert.doesNotMatch(source, /^(export[ \t]+)?(const|let|var)[ \t]+\w+([ \t]*:[^=\n]+)?[ \t]*=[ \t]*(await[ \t]+)?(getAppServices|createAppServices|createDefaultChallengeRegistry|getSharedState|new[ \t]+MemoryStore|new[ \t]+FixedWindowLimiter)[ \t]*\(/m);
    assert.doesNotMatch(source, /^(getAppServices|createAppServices|getSharedState)\s*\(/m);
  });

  test("the composition root says, in its own header, that the default store is for development and tests only", () => {
    const header = read(servicesPath);

    assert.match(header, /THE STORE IS DEVELOPMENT AND TEST ONLY/);
    assert.match(header, /NOT durable/);
    assert.match(header, /production, serverless or multi-instance/);
    assert.match(header, /NOTHING MOUNTS THIS/);
  });

  test("the composition root keeps no server state of its own beyond the one documented global and one cached instance", () => {
    const source = withoutComments(read(servicesPath));

    assert.equal((source.match(/globalThis/g) ?? []).length, 2, "one read of the shared state and one type cast");
    assert.match(source, /export const SHARED_STATE_KEY = "__buglabSharedServerState"/);
    assert.doesNotMatch(source, /process\.env\.(?!BUGLAB_TRUSTED_PROXY_HOPS\b)/);
  });

  test("nothing in the new files logs, reads Math.random, or names the answer key", () => {
    for (const source of [handlerSource, guardsSource, withoutComments(read(servicesPath))]) {
      assert.doesNotMatch(source, /\bconsole\s*\.|Math\.random|answer-key|provisionalAnswerKey|challenge-001|correctRootCauseId/);
    }
  });
});
