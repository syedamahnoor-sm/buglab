import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";
import {
  MONACO_PUBLIC_DIR,
  monacoVsPath,
  readPinnedVersion,
  verifyMonacoAssets,
} from "./scripts/monaco-assets.mjs";

export default function nextConfig(phase: string): NextConfig {
  // Monaco is served from public/monaco/<version>/vs. Fail early and clearly
  // if those files weren't generated, rather than shipping a broken editor.
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER) {
    verifyMonacoAssets();
  }

  return {
    /* config options here */
    cacheComponents: true,
    partialPrefetching: true,
    env: {
      // Read by MonacoEditor; derived from the same pin as the copied files.
      MONACO_VS_PATH: monacoVsPath(readPinnedVersion()),
    },
    async headers() {
      return [
        {
          // Each directory is named after an exact package version, so the
          // file at a given URL never changes.
          source: `/${MONACO_PUBLIC_DIR}/:path*`,
          headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
        },
      ];
    },
    turbopack: {
      rules: {
        "*.css": {
          loaders: ["@tailwindcss/turbopack"],
          as: "*.css",
        },
      },
    },
  };
}
