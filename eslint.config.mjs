import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-auth-test/**",
    ".buglab-dev-auth/**",
    ".buglab-dev-mail/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated copy of Monaco's prebuilt files (scripts/monaco-assets.mjs).
    "public/monaco/**",
  ]),
]);

export default eslintConfig;
