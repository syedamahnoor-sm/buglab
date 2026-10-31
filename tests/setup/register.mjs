/*
 * Lets Node's built-in test runner load the app's TypeScript modules
 * (Node 24 strips types natively). Only module resolution is customised:
 * - "@/..." maps to src/ (tsconfig paths)
 * - extensionless relative imports resolve to .ts / .tsx / index.ts
 * - "server-only" resolves to an empty module (Next handles it in builds)
 */
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../../src/", import.meta.url));
const EMPTY_MODULE = "data:text/javascript,export {};";

function resolveFile(basePath) {
  for (const candidate of [basePath, `${basePath}.ts`, `${basePath}.tsx`, `${basePath}/index.ts`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: EMPTY_MODULE, shortCircuit: true };

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
});
