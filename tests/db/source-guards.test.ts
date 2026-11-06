/*
 * Static guards on the durable-storage modules. They protect properties that are easy to break by accident and
 * hard to see in a diff: SQL that is never assembled from data, credentials that are never logged, the adapter
 * staying on the server and unmounted, and the baseline's protected areas staying untouched.
 *
 * Account-linking modules (`postgres-account-links.ts`, `src/server/identity/*`) are optional relative to the core
 * PR. When present locally or in a follow-up PR they are still guarded; when absent, core guards still pass.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DB_DIR = join(ROOT, "src/server/db");
const LIMIT_DIR = join(ROOT, "src/server/ratelimit");
const IDENTITY_DIR = join(ROOT, "src/server/identity");
const ACCOUNT_LINKS_FILE = join(DB_DIR, "postgres-account-links.ts");

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const read = (path: string) => readFileSync(path, "utf8");

/**
 * The modules a file really imports (static imports, re-exports, `import()` and `require()` of a string literal), read
 * with the TypeScript parser. Challenge scenario files under src/data carry sample source code as strings (a fictional
 * package.json, `import { Pool } from "pg"` in a file the learner reads), and that text is content, not an import.
 */
function importedModules(source: string): string[] {
  const file = ts.createSourceFile("file.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
const DATA_DIR = join(ROOT, "src/data");
const STORAGE_MODULE = /server\/db|server\/ratelimit|server\/session|^pg$/;
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const name = (path: string) => relative(ROOT, path).replaceAll("\\", "/");

const CORE_DB_FILES = [
  "src/server/db/config.ts",
  "src/server/db/persistence.ts",
  "src/server/db/postgres-rate-limiter.ts",
  "src/server/db/postgres-store.ts",
  "src/server/db/sql.ts",
] as const;
const OPTIONAL_ACCOUNT_LINKS_FILE = "src/server/db/postgres-account-links.ts";
/** The one storage adapter that lives beside its port (src/server/learning-loop) instead of in src/server/db. */
const LEARNING_LOOP_POSTGRES_FILE = "src/server/learning-loop/postgres-store.ts";
const CORE_LIMIT_FILES = [
  "src/server/ratelimit/client-address.ts",
  "src/server/ratelimit/learner-creation.ts",
  "src/server/ratelimit/memory-rate-limiter.ts",
  "src/server/ratelimit/proxy-config.ts",
  "src/server/ratelimit/types.ts",
] as const;
const OPTIONAL_IDENTITY_FILES = [
  "src/server/identity/link-boundary.ts",
  "src/server/identity/shared-learner-adapter.ts",
  "src/server/identity/types.ts",
  "src/server/identity/verified-account.ts",
] as const;

const dbFiles = sourceFiles(DB_DIR);
const limitFiles = sourceFiles(LIMIT_DIR);
const identityFiles = sourceFiles(IDENTITY_DIR);
const coreDbFiles = dbFiles.filter((path) => name(path) !== OPTIONAL_ACCOUNT_LINKS_FILE);
const LEARNING_LOOP_POSTGRES_PATH = join(ROOT, LEARNING_LOOP_POSTGRES_FILE);
const serverFiles = [
  ...dbFiles,
  ...limitFiles,
  ...identityFiles,
  ...(existsSync(LEARNING_LOOP_POSTGRES_PATH) ? [LEARNING_LOOP_POSTGRES_PATH] : []),
];
const hasAccountLinks = existsSync(ACCOUNT_LINKS_FILE);
const hasIdentity = identityFiles.length > 0;

describe("durable storage: source guards", () => {
  test("the core modules are exactly the ones this milestone defines; account-linking modules are optional", () => {
    assert.deepEqual(coreDbFiles.map(name).sort(), [...CORE_DB_FILES]);
    assert.deepEqual(limitFiles.map(name).sort(), [...CORE_LIMIT_FILES]);
    for (const path of dbFiles.map(name)) {
      assert.ok((CORE_DB_FILES as readonly string[]).includes(path) || path === OPTIONAL_ACCOUNT_LINKS_FILE, `unexpected db module: ${path}`);
    }
    if (hasAccountLinks) {
      assert.ok(dbFiles.map(name).includes(OPTIONAL_ACCOUNT_LINKS_FILE));
    }
    if (hasIdentity) {
      assert.deepEqual(identityFiles.map(name).sort(), [...OPTIONAL_IDENTITY_FILES]);
    } else {
      assert.deepEqual(identityFiles, []);
    }
  });

  test("every file is server-only", () => {
    for (const path of serverFiles) {
      assert.match(withoutComments(read(path)).trimStart(), /^import "server-only";/, name(path));
    }
  });

  test("nothing logs, so a connection string or a token can never be printed", () => {
    for (const path of serverFiles) {
      assert.doesNotMatch(withoutComments(read(path)), /\bconsole\s*\./, name(path));
    }
  });

  test("nothing uses Math.random", () => {
    for (const path of serverFiles) assert.doesNotMatch(withoutComments(read(path)), /Math\.random/, name(path));
  });

  test("SQL is never assembled from data: every interpolation into a query is a known constant or fragment", () => {
    // The ONLY expressions allowed inside ${...} in the store and the limiter. Each is a column list, a fixed
    // fragment or a choice between two fixed fragments. Any value reaches the database as a $n parameter.
    const allowed = new Set([
      "LEARNER_COLUMNS",
      "ACCOUNT_LEARNER_COLUMNS",
      "SESSION_COLUMNS",
      "ATTEMPT_COLUMNS",
      "DB_NOW_MS_SQL",
      "nowSql",
      'ignoreConflict ? "ON CONFLICT (learner_id, challenge_id) WHERE superseded_at IS NULL DO NOTHING" : ""',
      'lock ? "FOR NO KEY UPDATE" : ""',
      "values.length",
      "LOCK_TIMEOUT_MS",
      "STATEMENT_TIMEOUT_MS",
      "COLUMNS",
      "filter",
    ]);
    const files: Array<{ label: string; path: string }> = [
      { label: "postgres-store.ts", path: join(DB_DIR, "postgres-store.ts") },
      { label: "postgres-rate-limiter.ts", path: join(DB_DIR, "postgres-rate-limiter.ts") },
      { label: "sql.ts", path: join(DB_DIR, "sql.ts") },
    ];
    if (hasAccountLinks) files.push({ label: "postgres-account-links.ts", path: ACCOUNT_LINKS_FILE });
    if (existsSync(LEARNING_LOOP_POSTGRES_PATH)) {
      files.push({ label: LEARNING_LOOP_POSTGRES_FILE, path: LEARNING_LOOP_POSTGRES_PATH });
    }
    for (const { label, path } of files) {
      const code = withoutComments(read(path));
      for (const [, expression] of code.matchAll(/\$\{([^}]+)\}/g)) {
        assert.ok(allowed.has(expression.trim()), `${label} interpolates "${expression}" into a template string`);
      }
    }
  });

  test("the pool is built in one place, with no credentials and no hosting platform in the code", () => {
    const persistence = withoutComments(read(join(DB_DIR, "persistence.ts")));
    assert.equal((persistence.match(/new pg\.Pool\(/g) ?? []).length, 1);
    for (const path of serverFiles) {
      const code = withoutComments(read(path));
      assert.doesNotMatch(code, /postgres(ql)?:\/\/[^"'`\s$]*@/, `${name(path)} contains a connection string`);
      assert.doesNotMatch(code, /vercel|neon\.tech|supabase|amazonaws|@vercel|@neondatabase/i, `${name(path)} names a hosting platform`);
    }
  });

  test("only config.ts, persistence.ts, learner-creation.ts and proxy-config.ts read the environment, and only the documented variables", () => {
    const names = new Map<string, string[]>();
    for (const path of serverFiles) {
      const found = [...withoutComments(read(path)).matchAll(/process\.env\b(?:\.(\w+))?/g)].map((m) => m[1] ?? "(whole)");
      if (found.length > 0) names.set(name(path), found);
    }
    assert.deepEqual(Object.fromEntries(names), {
      "src/server/db/config.ts": ["(whole)"],
      // Hands process.env whole to the strict proxy validator when the creation guard is built. Reads no variable itself.
      "src/server/db/persistence.ts": ["(whole)"],
      // Two readers, both as default parameters: the policy and the unidentified-client mode. Nothing else.
      "src/server/ratelimit/learner-creation.ts": ["(whole)", "(whole)"],
      // Three readers, all default parameters (inspect, assert, resolve). NODE_ENV is read from the env object they are given.
      "src/server/ratelimit/proxy-config.ts": ["(whole)", "(whole)", "(whole)"],
    });
    // The direct (migration) URL is read only by the migration script, never by the running application.
    for (const path of sourceFiles(join(ROOT, "src"))) {
      assert.doesNotMatch(withoutComments(read(path)), /BUGLAB_DATABASE_URL_DIRECT/, name(path));
    }
  });

  test("forwarded headers are read in exactly one place: the rate-limit code never touches a request header itself", () => {
    for (const path of [...limitFiles, ...dbFiles]) {
      const code = withoutComments(read(path));
      // The only header access is handing `request.headers` whole to getTrustedClientIp, which reads x-forwarded-for.
      const withoutTheOneAllowedCall = code.replace("getTrustedClientIp(request.headers, trustedProxyHops)", "");
      assert.doesNotMatch(withoutTheOneAllowedCall, /\.headers\b/, `${name(path)} touches a request header`);
      assert.doesNotMatch(code, /headers\.get\(|x-forwarded|x-real-ip|cf-connecting|true-client/i, `${name(path)} reads a header directly`);
    }
    // And the proxy count is never defaulted, guessed or derived from the request.
    const config = withoutComments(read(join(LIMIT_DIR, "proxy-config.ts")));
    assert.doesNotMatch(config, /request|Request|headers/);
  });

  test("the `pg` driver is imported only inside Habin db adapters, Learning Loop postgres, or Codex account engine", () => {
    const allowed = new Set([
      LEARNING_LOOP_POSTGRES_FILE,
      "src/server/account/engine.ts",
    ]);
    for (const path of sourceFiles(join(ROOT, "src"))) {
      if (importedModules(read(path)).includes("pg")) {
        const rel = name(path);
        assert.ok(
          path.startsWith(DB_DIR) || allowed.has(rel),
          `${rel} imports pg from outside approved database modules`,
        );
      }
    }
  });

  test("the import reader sees real imports and ignores source code that is only text (a scenario's sample files)", () => {
    const real = 'import { Pool } from "pg";\nexport { x } from "@/server/db/sql";\nconst y = await import("@/server/session/service");\nconst z = require("pg");\n';
    assert.deepEqual(importedModules(real).sort(), ["@/server/db/sql", "@/server/session/service", "pg", "pg"]);
    const content = 'export const scenario = {\n  files: { "src/db.ts": `import { Pool } from "pg";\nimport x from "../server/db";\n` },\n  dependencies: { "pg": "^8" },\n};\n';
    assert.deepEqual(importedModules(content), []);
  });

  test("nothing outside storage, learner-http composition, or Codex account code imports database/rate-limit/identity modules", () => {
    const allowedImporters = new Set([
      ...serverFiles.map(name),
      "src/server/learner-http.ts",
      "src/server/learner-persistence.ts",
      "src/server/account/handler.ts",
      "src/server/account/shared-learner.ts",
      "src/server/account/engine.ts",
      "src/server/auth/verified-account.ts",
      "src/server/auth/provider.ts",
    ]);
    for (const path of sourceFiles(join(ROOT, "src"))) {
      const rel = name(path);
      if (rel === LEARNING_LOOP_POSTGRES_FILE) {
        for (const specifier of importedModules(read(path))) {
          if (/server\/db|@\/server\/db/.test(specifier)) {
            assert.ok(
              specifier === "@/server/db/sql" || specifier.endsWith("/db/sql"),
              `${rel} may import only db/sql, not ${specifier}`,
            );
          }
          assert.doesNotMatch(
            specifier,
            /server\/ratelimit|@\/server\/ratelimit|server\/identity|@\/server\/identity/,
            `${rel} imports ${specifier}`,
          );
        }
        continue;
      }
      if (allowedImporters.has(rel)) continue;
      assert.doesNotMatch(read(path), /server\/db\/|server\/ratelimit\/|server\/identity\/|@\/server\/db|@\/server\/ratelimit|@\/server\/identity/, rel);
    }
  });

  test("the learning-loop PostgreSQL store imports pg only as a type", () => {
    if (!existsSync(LEARNING_LOOP_POSTGRES_PATH)) return;
    const code = withoutComments(read(LEARNING_LOOP_POSTGRES_PATH));
    assert.doesNotMatch(code, /^import pg from "pg";/m, LEARNING_LOOP_POSTGRES_FILE);
    assert.match(code, /import type pg from "pg";/, LEARNING_LOOP_POSTGRES_FILE);
  });

  test("the PostgreSQL learning-loop store is selected only by learner-http (not by app-services)", () => {
    const allowed = new Set(["src/server/learner-http.ts"]);
    for (const path of sourceFiles(join(ROOT, "src"))) {
      if (name(path) === LEARNING_LOOP_POSTGRES_FILE) continue;
      const sibling = name(path).startsWith("src/server/learning-loop/");
      for (const specifier of importedModules(read(path))) {
        const imports = /learning-loop\/postgres-store/.test(specifier) || (sibling && specifier === "./postgres-store");
        if (imports) {
          assert.ok(allowed.has(name(path)), `${name(path)} imports the learning-loop PostgreSQL store`);
        }
      }
    }
    const appServices = withoutComments(read(join(ROOT, "src/server/app-services.ts")));
    assert.doesNotMatch(appServices, /learning-loop\/postgres-store|PostgresLearningLoopStore|learner-persistence|createPostgresPersistence/);
  });

  test("the identity boundary is only imported by Habin identity/db modules and the inactive SharedLearner adapter surface", (t) => {
    if (!hasIdentity && !hasAccountLinks) return t.skip("optional account-linking modules are not in this checkout");
    const allowed = new Set([
      OPTIONAL_ACCOUNT_LINKS_FILE,
      "src/server/account/shared-learner.ts",
      "src/server/account/handler.ts",
    ]);
    for (const path of sourceFiles(join(ROOT, "src"))) {
      const importsIdentity = /@\/server\/identity|server\/identity\//.test(read(path));
      if (importsIdentity) {
        const rel = name(path);
        assert.ok(rel.startsWith("src/server/identity/") || allowed.has(rel), `${rel} imports the identity boundary`);
      }
    }
    for (const dir of ["src/app", "src/components", "src/engine", "src/lib"]) {
      for (const path of sourceFiles(join(ROOT, dir))) assert.doesNotMatch(read(path), /server\/identity/, name(path));
    }
  });

  test("an account can only be obtained through the provider: Habin wrappers and Codex auth own verifyAccount", (t) => {
    if (!hasIdentity && !hasAccountLinks) return t.skip("optional account-linking modules are not in this checkout");
    const allowed = new Set([
      "src/server/identity/link-boundary.ts",
      "src/server/identity/verified-account.ts",
      "src/server/identity/shared-learner-adapter.ts",
      "src/server/auth/verified-account.ts",
      "src/server/account/handler.ts",
      OPTIONAL_ACCOUNT_LINKS_FILE,
    ]);
    for (const path of sourceFiles(join(ROOT, "src"))) {
      if (/\bverifyAccount\b|\bassertVerifiedAccount\b/.test(withoutComments(read(path)))) {
        assert.ok(allowed.has(name(path)), `${name(path)} uses verifyAccount or assertVerifiedAccount`);
      }
    }
    if (hasAccountLinks) {
      assert.doesNotMatch(withoutComments(read(ACCOUNT_LINKS_FILE)), /\bverifyAccount\b/);
    }
  });

  test("Habin verifyAccount wrapper delegates to Codex and does not parse the request itself", (t) => {
    if (!hasIdentity) return t.skip("optional identity modules are not in this checkout");
    const code = withoutComments(read(join(IDENTITY_DIR, "verified-account.ts")));
    assert.doesNotMatch(code, /\.headers|\.url\b|\.json\(|\.text\(|\.formData|searchParams|cookie|authorization/i);
    assert.match(code, /verifyAuthAccount\(request,\s*provider\)/, "Habin wraps Codex verifyAccount(request, provider)");
  });

  test("the identity boundary invents no authentication: no passwords, hashing of credentials, sessions, tokens or cookies of its own", (t) => {
    if (!hasIdentity) return t.skip("optional identity modules are not in this checkout");
    for (const file of ["link-boundary.ts", "verified-account.ts", "types.ts"]) {
      const code = withoutComments(read(join(IDENTITY_DIR, file)));
      assert.doesNotMatch(code, /bcrypt|argon|scrypt|pbkdf2|createHmac|randomBytes|jsonwebtoken|\bjwt\b|Set-Cookie|serializeLearnerCookie|password/i, file);
    }
    // The only cookie it reads is the existing anonymous learner cookie, through the existing reader.
    const boundary = withoutComments(read(join(IDENTITY_DIR, "link-boundary.ts")));
    assert.match(boundary, /readLearnerCookie\(request\.headers\.get\("cookie"\)\)/);
    assert.doesNotMatch(boundary, /x-account|accountId\s*[:=]\s*(request|body)/i);
  });

  test("no storage file trusts an account id it was handed: every account method starts by checking the account", (t) => {
    if (!hasAccountLinks) return t.skip("optional account-links module is not in this checkout");
    const code = withoutComments(read(ACCOUNT_LINKS_FILE));
    for (const method of ["findLearnerByAccount", "ensureAccountLearner", "linkBrowserLearner"]) {
      const body = code.slice(code.indexOf(`async ${method}(`));
      assert.match(body.slice(0, 300), /assertVerifiedAccount\(account\)/, method);
    }
  });

  test("mounted API routes exist; pages and components still do not import Habin storage modules directly", () => {
    const routes = sourceFiles(join(ROOT, "src/app/api")).map(name).sort();
    assert.ok(routes.includes("src/app/api/challenges/[challengeId]/diagnosis/route.ts"));
    assert.ok(routes.includes("src/app/api/learner/completions/route.ts"));
    for (const dir of ["src/components", "src/engine", "src/lib", "src/types", "src/data", "src/config"]) {
      for (const path of sourceFiles(join(ROOT, dir))) {
        if (path.startsWith(DATA_DIR)) {
          for (const specifier of importedModules(read(path))) assert.doesNotMatch(specifier, STORAGE_MODULE, `${name(path)} imports ${specifier}`);
        } else {
          assert.doesNotMatch(read(path), /server\/db|server\/ratelimit|server\/session|"pg"/, name(path));
        }
      }
    }
    for (const path of sourceFiles(join(ROOT, "src/app"))) {
      const rel = name(path);
      if (rel.startsWith("src/app/api/")) continue;
      assert.doesNotMatch(read(path), /server\/db|server\/ratelimit|server\/session|"pg"/, rel);
    }
  });

  test("the postgres store never names the answer key or the challenge data", () => {
    for (const path of serverFiles) {
      assert.doesNotMatch(withoutComments(read(path)), /answer-key|provisionalAnswerKey|challenge-001|server\/challenges|correctRootCauseId/, name(path));
    }
  });

  test("the production code introduces no TLS or certificate weakening", () => {
    for (const path of serverFiles) {
      assert.doesNotMatch(withoutComments(read(path)), /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/, name(path));
    }
  });

  test("no credentials are committed: .env files are ignored, and no file carries a connection string with a password for a real host", () => {
    assert.match(read(join(ROOT, ".gitignore")), /^\.env\*$/m, ".env* must stay ignored");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    let files: string[];
    try {
      files = [...git("ls-files"), ...git("ls-files", "--others", "--exclude-standard")];
    } catch {
      return; // not a git checkout: nothing to scan
    }
    const skip = /^(\.claude-logs\/|package-lock\.json$|public\/)/;
    // Hosts that are placeholders or the local machine. Anything else with a password is a real-looking secret.
    const placeholderHosts = new Set(["127.0.0.1", "localhost", "host", "host.example", "example.com", "hostname"]);
    for (const file of files.filter((f) => !skip.test(f) && /\.(ts|tsx|mjs|js|json|md|sql|yml|yaml|env|txt)$/.test(f))) {
      let text: string;
      try {
        text = read(join(ROOT, file));
      } catch {
        continue;
      }
      for (const [, host] of text.matchAll(/postgres(?:ql)?:\/\/[^:\s/@"'`]+:[^@\s"'`]+@([^\s/:?"'`]+)/g)) {
        assert.ok(placeholderHosts.has(host), `${file} contains a connection string with a password for host "${host}"`);
      }
    }
    assert.equal(files.some((file) => /(^|\/)\.env(\.|$)/.test(file)), false, "no .env file is tracked or untracked-but-unignored");
  });

  test("the composition root does not select the database, the creation limit or the identity boundary: it only applies the publication gate", () => {
    const code = withoutComments(read(join(ROOT, "src/server/app-services.ts")));
    assert.doesNotMatch(code, /postgres|server\/db|ratelimit|learnerCreation|BUGLAB_DATABASE|server\/identity|accountLinks|verifyAccount/i);
    // The gate is part of the default composition, and every registry (injected or default) goes through it.
    assert.match(code, /import \{ publishedChallengeIds, restrictToPublished \} from "@\/server\/diagnosis\/published"/);
    assert.match(code, /const challenges = publishedOnly\(\s*options\.challenges \?\? createDefaultChallengeRegistry\(\),\s*options\.publishedChallengeIds \?\? publishedChallengeIds\(\),\s*\)/);
  });

  test("the publication gate and the live diagnosis route are still Syeda's, unchanged", () => {
    const route = read(join(ROOT, "src/app/api/challenges/[challengeId]/diagnosis/route.ts"));
    assert.match(route, /registry: restrictToPublished\(createDefaultRegistry\(\)\)/);
    assert.doesNotMatch(route, /server\/session|server\/db|server\/identity|app-services|publishedChallengeIds/);
    assert.doesNotMatch(read(join(ROOT, "src/server/diagnosis/published.ts")), /server\/session|server\/db|server\/identity/);
  });
});

/**
 * origin/main as this milestone was last brought up to date: Merge 8C. Everything Syeda merged up to here is, by
 * definition, not this milestone's change. Move this forward only when the branch is deliberately brought up to date
 * with a newer main.
 */
/** Latest main tip after merging recommendations/Learning Path (PR #9/#12) into this learner branch. */
const BASELINE = "661ee62f7182f9953a88af7e14a7cbb0adfd7969";

describe("durable storage: protected areas of the baseline are untouched", () => {
  /** Files changed relative to the milestone's baseline, committed or not. Skipped when git or the baseline is unavailable. */
  function changedFiles(): string[] | null {
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
      git("cat-file", "-e", `${BASELINE}^{commit}`);
      const tracked = git("diff", "--name-only", BASELINE).split("\n");
      const untracked = git("ls-files", "--others", "--exclude-standard").split("\n");
      return [...tracked, ...untracked].filter(Boolean);
    } catch {
      return null;
    }
  }

  test("learner API mounts and diagnosis evaluation files are the only intentional app/server surface changes", (t) => {
    const changed = changedFiles();
    if (!changed) return t.skip("git or the baseline commit is not available here");
    const protectedPrefixes = [
      "src/components/",
      "src/engine/",
      "src/lib/",
      "src/types/",
      "src/data/",
      "src/config/",
      "src/proxy.ts",
      "src/server/challenges/",
      "src/server/admin/",
    ];
    const diagnosisEvaluationAllowed = new Set([
      "src/server/diagnosis/evaluator.ts",
      "src/server/diagnosis/evaluate.ts",
      "src/server/diagnosis/handler.ts",
      "src/server/diagnosis/reasoning.ts",
      "src/server/diagnosis/verdict-composer.ts",
      "src/server/diagnosis/gemini-reasoning.ts",
      "src/server/diagnosis/gemini-session.ts",
      "src/server/diagnosis/gemini-observability.ts",
      "src/server/diagnosis/gemini-concurrency.ts",
      "src/server/diagnosis/reasoning-safety.ts",
    ]);
    const learnerMountAllowed = new Set([
      "src/app/challenges/[challengeId]/page.tsx",
      "src/app/api/learner/route.ts",
      "src/app/api/learner/completions/route.ts",
      "src/app/api/challenges/[challengeId]/session/route.ts",
      "src/app/api/challenges/[challengeId]/attempts/route.ts",
      "src/app/api/learning/reflections/route.ts",
      "src/app/api/learning/reflections/[reflectionId]/route.ts",
      "src/app/api/learning/journal/route.ts",
      "src/app/api/learning/activity/route.ts",
    ]);
    const accountUiAllowed = new Set([
      // Account discovery reuses the existing landing/header navigation.
      "src/components/landing/Hero.tsx",
      "src/components/landing/LandingHeader.tsx",
      "src/components/layout/MobileMenu.tsx",
      "src/components/account/AccountDashboard.tsx",
      "src/components/account/AccountNav.tsx",
      "src/components/account/AccountProvider.tsx",
      "src/components/account/AuthForm.tsx",
      "src/components/account/LearningIdentityNotice.tsx",
      "src/components/account/ui.tsx",
      "src/components/journal/JournalPage.tsx",
      "src/components/layout/AppHeader.tsx",
      "src/components/layout/nav.ts",
      "src/components/progress/ProgressPage.tsx",
      "src/lib/account/api.ts",
      "src/lib/account/config.ts",
      "src/lib/account/contract.ts",
      "src/lib/account/link.ts",
      "src/lib/account/model.ts",
      "src/lib/account/routes.ts",
      "src/lib/account/validation.ts",
    ]);
    const touched = changed.filter(
      (file) =>
        !learnerMountAllowed.has(file) &&
        !diagnosisEvaluationAllowed.has(file) &&
        !accountUiAllowed.has(file) &&
        !file.startsWith("src/server/auth/") &&
        !file.startsWith("src/server/account/") &&
        !file.startsWith("src/app/account/") &&
        !file.startsWith("src/app/api/account/") &&
        !file.startsWith("src/app/api/auth/") &&
        !file.startsWith("src/lib/account/") &&
        !file.startsWith("src/components/account/") &&
        protectedPrefixes.some((prefix) => file === prefix || file.startsWith(prefix)),
    );
    assert.deepEqual(touched, [], "these protected files changed");
  });

  test("the challenge page diff is only the instant-shell opt-out", (t) => {
    let diff: string;
    try {
      execFileSync("git", ["cat-file", "-e", `${BASELINE}^{commit}`], { cwd: ROOT, encoding: "utf8" });
      diff = execFileSync("git", ["diff", "-U0", BASELINE, "--", "src/app/challenges/[challengeId]/page.tsx"], {
        cwd: ROOT,
        encoding: "utf8",
      });
    } catch {
      return t.skip("git or the baseline commit is not available here");
    }
    const changedLines = diff.split("\n").filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
    assert.deepEqual(
      changedLines.filter((line) => line.startsWith("-")),
      [],
      "the instant-shell opt-out must not remove existing route behavior",
    );
    assert.deepEqual(
      changedLines.filter((line) => line.startsWith("+")).map((line) => line.slice(1)),
      [
        "// The page body is the challenge for this URL. `params` is read before any",
        "// output so notFound() can return 404; a Suspense boundary around that read",
        "// would stream a 200 instead. There is no URL-independent shell to show",
        "// first, so this segment is allowed to block.",
        "export const instant = false;",
        "",
      ],
    );
    const page = read(join(ROOT, "src/app/challenges/[challengeId]/page.tsx"));
    assert.match(page, /export const ensureStatic = "navigation"/);
    assert.match(page, /export const instant = false/);
    assert.match(page, /if \(!scenario\) notFound\(\)/);
    assert.doesNotMatch(page, /@\/server\/|answer-key|cookies\(|headers\(/);
  });

  test("accounts-and-rbac documents Habin learner DB URLs and Codex Better Auth DATABASE_URL separately", () => {
    const doc = read(join(ROOT, "docs/architecture/accounts-and-rbac.md"));
    assert.match(doc, /BUGLAB_DATABASE_URL/);
    assert.match(doc, /Better Auth|better-auth|DATABASE_URL/);
  });
});
