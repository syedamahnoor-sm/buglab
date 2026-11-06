import type { NextConfig } from "next";
import {
  MONACO_PUBLIC_DIR,
  MONACO_VERIFY_PHASES,
  monacoVsPath,
  readPinnedVersion,
  verifyMonacoAssets,
} from "./scripts/monaco-assets.mjs";

export default function nextConfig(phase: string): NextConfig {
  // Monaco is served from public/monaco/<version>/vs. In the production-build
  // and dev-server phases, fail early and clearly if those files weren't
  // generated, rather than shipping a broken editor.
  if (MONACO_VERIFY_PHASES.includes(phase)) {
    verifyMonacoAssets();
  }

  return {
    // Browser fixtures must not lock or overwrite the developer's preview.
    distDir: process.env.BUGLAB_AUTH_BROWSER_FIXTURE === "1" ? ".next-auth-test" : ".next",
    /* config options here */
    cacheComponents: true,
    partialPrefetching: true,
    env: {
      // Read by MonacoEditor; derived from the same pin as the copied files.
      MONACO_VS_PATH: monacoVsPath(readPinnedVersion()),
    },
    async redirects() {
      // The landing page moved from /welcome to /; keep old links working.
      return [{ source: "/welcome", destination: "/", permanent: true }];
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
