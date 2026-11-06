import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { decideLearnerLink, type LinkContext } from "@/server/auth/learner-link";
import { parseRegistration, REGISTRATION_ROLE } from "@/server/auth/registration";

const ROOT = fileURLToPath(new URL("../../src/", import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
const rel = (path: string) => path.slice(ROOT.length).replaceAll("\\", "/");

describe("no admin self-registration", () => {
  test("role, isAdmin and similar fields are dropped; every sign-up is a learner", () => {
    const result = parseRegistration({
      email: " New.Person@Example.com ",
      displayName: " Ada ",
      role: "admin",
      isAdmin: true,
      permissions: ["admin:access"],
      id: "acct-1",
    });
    assert.ok(result.ok);
    assert.equal(result.role, "learner");
    assert.equal(REGISTRATION_ROLE, "learner");
    assert.deepEqual(result.input, { email: "new.person@example.com", displayName: "Ada" });
    assert.deepEqual(result.ignoredFields, ["id", "isAdmin", "permissions", "role"]);
    assert.ok(!("role" in result.input));
  });

  test("bad input is refused field by field", () => {
    assert.deepEqual(parseRegistration(null), { ok: false, errors: [{ field: "body", message: "must be a JSON object" }] });
    assert.deepEqual(parseRegistration([]), { ok: false, errors: [{ field: "body", message: "must be a JSON object" }] });
    const bad = parseRegistration({ email: "not-an-email", displayName: 7 });
    assert.ok(!bad.ok && bad.errors.map((error) => error.field).join() === "email,displayName");
  });
});

describe("account-to-learner linking", () => {
  const base: LinkContext = { accountId: "acct-a", accountLearnerId: null, browserLearnerId: "learner-1", browserLearnerClaimedBy: null, consent: false };
  const cases: [string, Partial<LinkContext>, string][] = [
    ["the account already has a learner: keep it, never merge", { accountLearnerId: "learner-9", consent: true }, "use-account-learner"],
    ["nothing in this browser", { browserLearnerId: null }, "create-account-learner"],
    ["browser learner belongs to someone else: never transferred", { browserLearnerClaimedBy: "acct-b", consent: true }, "create-account-learner"],
    ["unclaimed progress without consent: ask", {}, "ask-consent"],
    ["unclaimed progress with consent: link", { consent: true }, "link-browser-learner"],
  ];
  for (const [name, overrides, action] of cases) {
    test(name, () => assert.equal(decideLearnerLink({ ...base, ...overrides }).action, action));
  }

  test("consent alone never moves another account's or an already-linked learner", () => {
    for (const overrides of [{ accountLearnerId: "learner-9" }, { browserLearnerClaimedBy: "acct-b" }]) {
      const decision = decideLearnerLink({ ...base, ...overrides, consent: true });
      assert.notEqual(decision.action, "link-browser-learner", JSON.stringify(overrides));
    }
  });
});

describe("identity boundaries in the code", () => {
  const authFiles = walk(join(ROOT, "server/auth")).concat(walk(join(ROOT, "server/admin")));

  test("auth and admin modules are server-only", () => {
    for (const path of authFiles) assert.match(readFileSync(path, "utf8"), /^import "server-only";$/m, rel(path));
  });

  test("accounts do not reuse the learner-session module, cookie or store", () => {
    for (const path of authFiles) {
      const code = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(code, /@\/server\/session|buglab_learner|LearnerStore|MemoryStore/, rel(path));
    }
  });

  test("no password, hash, secret or token field in any type the browser can see", () => {
    for (const path of walk(join(ROOT, "types"))) {
      assert.doesNotMatch(readFileSync(path, "utf8"), /password|passwordHash|secret|accessToken|refreshToken/i, rel(path));
    }
  });

  test("nothing stores credentials in browser storage", () => {
    for (const path of walk(ROOT)) {
      const text = readFileSync(path, "utf8");
      if (/localStorage|sessionStorage|indexedDB/.test(text)) {
        assert.doesNotMatch(text, /token|session|password|credential|auth/i, rel(path));
      }
    }
  });
});

describe("no unprotected admin or account routes", () => {
  const appFiles = walk(join(ROOT, "app")).map(rel);

  test("admin stays unmounted; every account page inherits the server session boundary", () => {
    assert.deepEqual(appFiles.filter((path) => /(^|\/)admin(\/|$)/i.test(path)), []);
    const layout = readFileSync(join(ROOT, "app/account/layout.tsx"), "utf8");
    assert.match(layout, /readAccountSession/);
    assert.match(layout, /if \(!session\) redirect/);
    assert.match(layout, /Suspense/);
  });

  test("only the approved account, OAuth, diagnosis and recommendation APIs are mounted", () => {
    assert.deepEqual(appFiles.filter((path) => /(^|\/)route\.tsx?$/.test(path)).sort(), ["app/api/account/[...path]/route.ts", "app/api/auth/[...path]/route.ts", "app/api/challenges/[challengeId]/diagnosis/route.ts", "app/api/recommendations/v1/route.ts"]);
  });

  test("no page or component imports the auth or admin server modules yet", () => {
    for (const path of walk(join(ROOT, "app")).concat(walk(join(ROOT, "components")))) {
      assert.doesNotMatch(readFileSync(path, "utf8"), /@\/server\/(auth|admin)/, rel(path));
    }
  });
});
