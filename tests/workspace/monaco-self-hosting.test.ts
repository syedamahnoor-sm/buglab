import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MONACO_VERIFY_PHASES,
  REQUIRED_FILES,
  REQUIRED_WORKERS,
  copyMonacoAssets,
  findMissingAssets,
  monacoOutputDir,
  monacoVsPath,
  readInstalledVersion,
  readPinnedVersion,
  verifyMonacoAssets,
} from "../../scripts/monaco-assets.mjs";
import nextConfig from "../../next.config";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VERSION = "1.2.3";
const tempRoots: string[] = [];

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function write(file: string, content = "") {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A project root with a fake installed monaco-editor shaped like the real one. */
function makeProject({ pinned = VERSION, installed = VERSION as string | null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "buglab-monaco-"));
  tempRoots.push(root);
  write(join(root, "package.json"), JSON.stringify({ dependencies: { "monaco-editor": pinned } }));
  if (installed !== null) {
    const pkg = join(root, "node_modules", "monaco-editor");
    write(join(pkg, "package.json"), JSON.stringify({ version: installed }));
    write(join(pkg, "LICENSE"), "MIT");
    for (const file of REQUIRED_FILES) write(join(pkg, "min", "vs", file), `/* ${file} */`);
    for (const prefix of REQUIRED_WORKERS) write(join(pkg, "min", "vs", "assets", `${prefix}abc123.js`), "/* worker */");
    write(join(pkg, "min", "vs", "basic-languages", "monaco.contribution.js"), "/* lazy chunk */");
  }
  return root;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => statSync(join(dir, name)).isFile());
}

describe("Monaco asset copy", () => {
  test("copies every file into the versioned public directory, with the licence", () => {
    const root = makeProject();
    const result = copyMonacoAssets(root);
    const outputDir = monacoOutputDir(root, VERSION);

    assert.equal(result.copied, true);
    assert.equal(result.outputDir, outputDir);
    assert.ok(outputDir.endsWith(join("public", "monaco", VERSION, "vs")));
    assert.deepEqual(
      listFiles(outputDir).sort(),
      listFiles(join(root, "node_modules", "monaco-editor", "min", "vs")).sort(),
    );
    assert.equal(readFileSync(join(root, "public", "monaco", VERSION, "LICENSE"), "utf8"), "MIT");
    assert.deepEqual(findMissingAssets(outputDir), []);
  });

  test("is idempotent and skips an up-to-date copy", () => {
    const root = makeProject();
    copyMonacoAssets(root);
    const second = copyMonacoAssets(root);
    assert.equal(second.copied, false);
    assert.deepEqual(findMissingAssets(monacoOutputDir(root, VERSION)), []);
  });

  test("repairs an incomplete copy", () => {
    const root = makeProject();
    copyMonacoAssets(root);
    rmSync(join(monacoOutputDir(root, VERSION), "loader.js"));
    assert.equal(copyMonacoAssets(root).copied, true);
    assert.deepEqual(findMissingAssets(monacoOutputDir(root, VERSION)), []);
  });

  test("removes copies of other versions", () => {
    const root = makeProject();
    write(join(root, "public", "monaco", "0.0.1", "vs", "loader.js"), "stale");
    copyMonacoAssets(root);
    assert.deepEqual(readdirSync(join(root, "public", "monaco")), [VERSION]);
  });

  test("never deletes or writes through a linked public/monaco directory", () => {
    const root = makeProject();
    const outside = mkdtempSync(join(tmpdir(), "buglab-outside-"));
    tempRoots.push(outside);
    write(join(outside, "keep.txt"), "not ours");
    mkdirSync(join(root, "public"), { recursive: true });
    symlinkSync(outside, join(root, "public", "monaco"), "junction");

    assert.throws(() => copyMonacoAssets(root), /Refusing to write Monaco assets through a link/);
    assert.equal(existsSync(join(outside, "keep.txt")), true);
    assert.deepEqual(readdirSync(outside), ["keep.txt"]);
  });

  test("fails clearly when the package isn't installed", () => {
    const root = makeProject({ installed: null });
    assert.throws(() => copyMonacoAssets(root), /monaco-editor is not installed/);
  });

  test("fails when the installed version differs from the pin", () => {
    const root = makeProject({ installed: "1.2.4" });
    assert.throws(() => copyMonacoAssets(root), /Installed monaco-editor 1\.2\.4 does not match .* \(1\.2\.3\)/);
  });

  test("fails when the package layout no longer has a required file", () => {
    const root = makeProject();
    rmSync(join(root, "node_modules", "monaco-editor", "min", "vs", "editor", "editor.main.js"));
    assert.throws(() => copyMonacoAssets(root), /unexpected layout[\s\S]*editor\/editor\.main\.js/);
  });

  test("rejects a version range, which would not map to one URL", () => {
    const root = makeProject({ pinned: "^1.2.3" });
    assert.throws(() => copyMonacoAssets(root), /must be pinned to an exact version/);
  });
});

describe("Monaco asset verification", () => {
  test("passes for a complete copy", () => {
    const root = makeProject();
    copyMonacoAssets(root);
    assert.equal(verifyMonacoAssets(root).version, VERSION);
  });

  test("names the missing directory and tells you how to fix it", () => {
    const root = makeProject();
    assert.throws(() => verifyMonacoAssets(root), /Monaco 1\.2\.3 assets are missing[\s\S]*npm run monaco:copy/);
  });

  test("names each missing file and worker", () => {
    const root = makeProject();
    copyMonacoAssets(root);
    const vsDir = monacoOutputDir(root, VERSION);
    rmSync(join(vsDir, "editor", "editor.main.css"));
    for (const name of readdirSync(join(vsDir, "assets"))) {
      if (name.startsWith("ts.worker-")) rmSync(join(vsDir, "assets", name));
    }
    assert.throws(() => verifyMonacoAssets(root), (error: Error) => {
      assert.match(error.message, /editor\/editor\.main\.css/);
      assert.match(error.message, /assets\/ts\.worker-\*\.js/);
      return true;
    });
  });
});

describe("Monaco version consistency", () => {
  const pinned = readPinnedVersion(ROOT);

  test("package.json pins an exact version that matches the lockfile and the install", () => {
    const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
    assert.equal(lock.packages[""].dependencies["monaco-editor"], pinned);
    assert.equal(lock.packages["node_modules/monaco-editor"].version, pinned);
    assert.equal(readInstalledVersion(ROOT), pinned);
  });

  test("the installed package still has every file the editor needs", () => {
    assert.deepEqual(findMissingAssets(join(ROOT, "node_modules", "monaco-editor", "min", "vs")), []);
  });

  test("next.config.ts derives the editor's URL from the pin and caches it immutably", async () => {
    const config = nextConfig("phase-production-server");
    assert.equal(config.env?.MONACO_VS_PATH, monacoVsPath(pinned));
    assert.equal(monacoVsPath(pinned), `/monaco/${pinned}/vs`);

    const rules = (await config.headers?.()) ?? [];
    const monacoRule = rules.find((rule) => rule.source === "/monaco/:path*");
    assert.deepEqual(monacoRule?.headers, [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
    // Only the versioned Monaco files are cached forever.
    assert.equal(rules.length, 1);
  });

  test("next.config.ts verifies the assets in Next's own build and dev phases", () => {
    // require() reads next/constants reliably; ESM named imports of it don't.
    const { PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER } = createRequire(import.meta.url)("next/constants");
    assert.deepEqual(MONACO_VERIFY_PHASES, [PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER]);
  });

  test("dev and build regenerate the assets first", () => {
    const { scripts } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.equal(scripts.predev, "npm run monaco:copy");
    assert.equal(scripts.prebuild, "npm run monaco:copy");
    assert.equal(scripts["monaco:copy"], "node scripts/monaco-assets.mjs copy");
  });

  test("the generated copy is ignored by Git", () => {
    assert.match(readFileSync(join(ROOT, ".gitignore"), "utf8"), /^\/public\/monaco\/$/m);
  });
});

describe("no third-party Monaco CDN", () => {
  const CDN = /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|monaco-editor@/i;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((name) => /\.(tsx?|mjs|css)$/.test(name))
      .map((name) => join(dir, name));
  }

  test("app source and config never reference a CDN", () => {
    const files = [...sourceFiles(join(ROOT, "src")), join(ROOT, "next.config.ts"), join(ROOT, "scripts", "monaco-assets.mjs")];
    const offenders = files.filter((file) => CDN.test(readFileSync(file, "utf8")));
    assert.deepEqual(offenders, []);
  });

  test("the editor takes its loader path only from the self-hosted config", () => {
    const source = readFileSync(join(ROOT, "src", "components", "workspace", "MonacoEditor.tsx"), "utf8");
    assert.doesNotMatch(source, /https?:\/\//);
    assert.match(source, /loader\.config\(\{ paths: \{ vs: MONACO_VS_PATH \} \}\)/);
    // With no path configured the loader would fall back to its CDN default,
    // so the editor must not start at all.
    assert.match(source, /useState\(!MONACO_VS_PATH\)/);
    assert.match(source, /if \(!MONACO_VS_PATH\) return;/);
  });
});
