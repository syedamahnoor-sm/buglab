/*
 * Lets Node's built-in test runner load the app's TypeScript modules
 * (Node 24 strips types natively). Module resolution is customised:
 * - "@/..." maps to src/ (tsconfig paths)
 * - extensionless relative imports resolve to .ts / .tsx / index.ts
 * - "server-only" resolves to an empty module (Next handles it in builds)
 * - "next/<name>" resolves to next/<name>.js: Next has no exports map, so Node
 *   ESM needs the extension that bundlers add for it (e.g. next/dynamic)
 *
 * .tsx modules contain JSX, which type stripping cannot parse, so they are
 * compiled with the project's own TypeScript compiler. It is loaded the first
 * time a .tsx file is imported, so test files that never import one pay nothing.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../../src/", import.meta.url));
const EMPTY_MODULE = "data:text/javascript,export {};";
const nodeRequire = createRequire(import.meta.url);
let typescript;

function compileTsx(url) {
  typescript ??= nodeRequire("typescript");
  const fileName = fileURLToPath(url);
  const { outputText } = typescript.transpileModule(readFileSync(fileName, "utf8"), {
    fileName,
    compilerOptions: {
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
  });
  return outputText;
}

function resolveFile(basePath) {
  for (const candidate of [basePath, `${basePath}.ts`, `${basePath}.tsx`, `${basePath}/index.ts`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: EMPTY_MODULE, shortCircuit: true };
    if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);

    let basePath = null;
    if (specifier.startsWith("@/")) {
      basePath = SRC_DIR + specifier.slice(2);
    } else if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith("file:")) {
      basePath = fileURLToPath(new URL(specifier, context.parentURL));
    }

    const file = basePath && resolveFile(basePath);
    if (file) {
      return {
        url: pathToFileURL(file).href,
        format: file.endsWith(".ts") ? "module-typescript" : undefined,
        shortCircuit: true,
      };
    }
    const resolved = nextResolve(specifier, context);
    // Test entry files: treat .ts as ES modules without a package "type".
    return resolved.url.endsWith(".ts") && !resolved.format
      ? { ...resolved, format: "module-typescript" }
      : resolved;
  },

  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".tsx")) {
      return { format: "module", source: compileTsx(url), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
