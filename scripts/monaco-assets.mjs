/*
 * Self-hosted Monaco assets.
 *
 * Monaco's prebuilt AMD build (node_modules/monaco-editor/min/vs) is copied
 * into public/monaco/<version>/vs and served from our own origin, instead of
 * from a third-party CDN. The version comes from the exact pin in
 * package.json, which must match the installed package, so the URL the editor
 * loads, the copied files, and the installed types can't drift apart.
 *
 *   node scripts/monaco-assets.mjs copy     copy (skipped when up to date)
 *   node scripts/monaco-assets.mjs verify   fail if the copied files are missing
 *
 * The output is generated, so public/monaco/ is git-ignored.
 */
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const MONACO_PACKAGE = "monaco-editor";
export const MONACO_PUBLIC_DIR = "monaco";

/** Files the editor fetches on load. Missing any of them breaks the editor. */
export const REQUIRED_FILES = [
  "loader.js",
  "nls.messages-loader.js",
  "editor/editor.main.js",
  "editor/editor.main.css",
];

/**
 * Worker bundles (content-hashed names) that editor.main.js references. Our
 * file types start the editor, TypeScript and JSON workers; the CSS and HTML
 * ones are never started but are still referenced, so they must be served.
 */
export const REQUIRED_WORKERS = ["editor.worker-", "json.worker-", "ts.worker-", "css.worker-", "html.worker-"];

/**
 * Next.js phases in which next.config.ts checks the copied files: the values
 * of PHASE_PRODUCTION_BUILD and PHASE_DEVELOPMENT_SERVER. Written out rather
 * than imported because next/constants is CommonJS without an exports map, so
 * its named exports can't be imported reliably from plain Node ESM (tests).
 * A test checks these still match Next's own constants.
 */
export const MONACO_VERIFY_PHASES = ["phase-production-build", "phase-development-server"];

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The exact version pinned in package.json. Ranges are rejected. */
export function readPinnedVersion(root = PROJECT_ROOT) {
  const spec = readJson(join(root, "package.json")).dependencies?.[MONACO_PACKAGE];
  if (!spec || !/^\d+\.\d+\.\d+$/.test(spec)) {
    throw new Error(
      `${MONACO_PACKAGE} must be pinned to an exact version in package.json (found ${JSON.stringify(spec)}), ` +
        "because its files are served from a versioned URL.",
    );
  }
  return spec;
}

/** The version of the installed package, or null when it isn't installed. */
export function readInstalledVersion(root = PROJECT_ROOT) {
  const manifest = join(root, "node_modules", MONACO_PACKAGE, "package.json");
  return existsSync(manifest) ? readJson(manifest).version : null;
}

/** The URL path Monaco's loader is configured with, e.g. "/monaco/0.57.0/vs". */
export function monacoVsPath(version) {
  return `/${MONACO_PUBLIC_DIR}/${version}/vs`;
}

/** Where the copied files live on disk, e.g. public/monaco/0.57.0/vs. */
export function monacoOutputDir(root, version) {
  return join(root, "public", MONACO_PUBLIC_DIR, version, "vs");
}

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

/** Lists what's missing from a copied vs directory (empty when complete). */
export function findMissingAssets(vsDir) {
  if (!existsSync(vsDir)) return ["(the whole directory: nothing has been copied yet)"];
  const missing = REQUIRED_FILES.filter((file) => !existsSync(join(vsDir, file)));
  const assets = existsSync(join(vsDir, "assets")) ? readdirSync(join(vsDir, "assets")) : [];
  for (const prefix of REQUIRED_WORKERS) {
    if (!assets.some((name) => name.startsWith(prefix) && name.endsWith(".js"))) {
      missing.push(`assets/${prefix}*.js`);
    }
  }
  return missing;
}

/** Throws a clear error when the self-hosted files aren't in public/. */
export function verifyMonacoAssets(root = PROJECT_ROOT) {
  const version = readPinnedVersion(root);
  const vsDir = monacoOutputDir(root, version);
  const missing = findMissingAssets(vsDir);
  if (missing.length > 0) {
    throw new Error(
      `Self-hosted Monaco ${version} assets are missing from ${relative(root, vsDir) || vsDir}:\n` +
        missing.map((file) => `  - ${file}`).join("\n") +
        "\nRun `npm run monaco:copy` (it also runs before `npm run dev`, `npm run build` and `npm run typecheck`).",
    );
  }
  return { version, vsDir };
}

/**
 * Copies the installed package's min/vs into public/monaco/<version>/vs and
 * removes copies of other versions. Skips the copy when the output already
 * holds the same set of files.
 */
export function copyMonacoAssets(root = PROJECT_ROOT) {
  const version = readPinnedVersion(root);
  const installed = readInstalledVersion(root);
  if (installed === null) {
    throw new Error(`${MONACO_PACKAGE} is not installed. Run \`npm ci\` first.`);
  }
  if (installed !== version) {
    throw new Error(
      `Installed ${MONACO_PACKAGE} ${installed} does not match the version pinned in package.json (${version}). Run \`npm ci\`.`,
    );
  }

  const sourceDir = join(root, "node_modules", MONACO_PACKAGE, "min", "vs");
  const missingFromSource = findMissingAssets(sourceDir);
  if (missingFromSource.length > 0) {
    throw new Error(
      `${MONACO_PACKAGE} ${version} has an unexpected layout; missing from min/vs:\n` +
        missingFromSource.map((file) => `  - ${file}`).join("\n"),
    );
  }

  const publicDir = join(root, "public", MONACO_PUBLIC_DIR);
  const outputDir = monacoOutputDir(root, version);

  // Everything below is deleted and rewritten, so it must really be inside
  // the project: refuse a public/ or public/monaco/ that links elsewhere.
  for (const dir of [join(root, "public"), publicDir]) {
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) {
      throw new Error(`Refusing to write Monaco assets through a link: ${relative(root, dir)} is a symlink or junction.`);
    }
  }

  // Only this version's directory belongs here; anything else is stale.
  if (existsSync(publicDir)) {
    for (const entry of readdirSync(publicDir)) {
      if (entry !== version) rmSync(join(publicDir, entry), { recursive: true, force: true });
    }
  }

  const sourceFiles = listFiles(sourceDir).sort();
  const upToDate =
    existsSync(outputDir) &&
    findMissingAssets(outputDir).length === 0 &&
    listFiles(outputDir).sort().join("\n") === sourceFiles.join("\n") &&
    sourceFiles.every((file) => statSync(join(outputDir, file)).size === statSync(join(sourceDir, file)).size);
  if (upToDate) return { version, outputDir, copied: false, files: sourceFiles.length };

  rmSync(join(publicDir, version), { recursive: true, force: true });
  cpSync(sourceDir, outputDir, { recursive: true });
  cpSync(join(root, "node_modules", MONACO_PACKAGE, "LICENSE"), join(publicDir, version, "LICENSE"));
  verifyMonacoAssets(root);
  return { version, outputDir, copied: true, files: sourceFiles.length };
}

function main(command) {
  if (command === "copy") {
    const { version, outputDir, copied, files } = copyMonacoAssets();
    const where = relative(process.cwd(), outputDir) || outputDir;
    console.log(copied ? `Copied Monaco ${version} (${files} files) to ${where}` : `Monaco ${version} assets are up to date in ${where}`);
  } else if (command === "verify") {
    const { version } = verifyMonacoAssets();
    console.log(`Monaco ${version} assets are in place.`);
  } else {
    throw new Error("Usage: node scripts/monaco-assets.mjs <copy|verify>");
  }
}

if (import.meta.main) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
