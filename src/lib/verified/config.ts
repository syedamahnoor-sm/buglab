/*
 * Which verified-completions source the app uses. Disabled by default.
 *
 * The HTTP source (http-source.ts, the proposed GET /api/learner/completions)
 * is used only when BOTH hold at build time:
 *   - NEXT_PUBLIC_BUGLAB_VERIFIED_COMPLETIONS is exactly "enabled"
 *   - the build is not a production build (NODE_ENV !== "production")
 * Everything else, including every production build whatever the flag says,
 * gets the not-connected source: no request is ever made. So the default
 * application never contacts the unmounted endpoint, and activation is only
 * possible on purpose, in development or test.
 *
 * To try it locally: NEXT_PUBLIC_BUGLAB_VERIFIED_COMPLETIONS=enabled npm run dev
 * (it needs a backend that serves the endpoint; see
 * docs/architecture/verified-completions-integration.md). Production activation is a
 * deliberate code change to this file, made with the backend.
 */
import { createHttpCompletionsSource } from "./http-source";
import { notConnectedSource, type VerifiedCompletionsSource } from "./source";

export const ACTIVATION_FLAG = "NEXT_PUBLIC_BUGLAB_VERIFIED_COMPLETIONS";

export type VerifiedSourceConfig =
  | { mode: "disconnected"; reason: "flag-off" | "production-build" }
  | { mode: "http" };

/** The source configuration for a flag value and build. Pure, so every case is testable. */
export function resolveVerifiedSourceConfig(env: { flag: string | undefined; nodeEnv: string | undefined }): VerifiedSourceConfig {
  if (env.flag !== "enabled") return { mode: "disconnected", reason: "flag-off" };
  if (env.nodeEnv === "production") return { mode: "disconnected", reason: "production-build" };
  return { mode: "http" };
}

/** The source for a configuration. Only the "http" mode ever makes a request. */
export function createVerifiedSource(
  config: VerifiedSourceConfig,
  options: { publishedIds: ReadonlySet<string>; fetch?: typeof fetch; timeoutMs?: number },
): VerifiedCompletionsSource {
  return config.mode === "http" ? createHttpCompletionsSource(options) : notConnectedSource;
}

/** This build's configuration (for display and tests). */
export const BUILD_CONFIG: VerifiedSourceConfig = resolveVerifiedSourceConfig({
  flag: process.env.NEXT_PUBLIC_BUGLAB_VERIFIED_COMPLETIONS,
  nodeEnv: process.env.NODE_ENV,
});

/**
 * Next.js inlines both values at build time, so in a production build this is
 * the literal `false`, and the HTTP source below is removed from the bundle
 * entirely: production cannot contact the endpoint, and does not even ship
 * the code that would. Kept in step with resolveVerifiedSourceConfig (tested).
 */
const BUILD_ALLOWS_HTTP = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_BUGLAB_VERIFIED_COMPLETIONS === "enabled";

/** The source this build uses. What the app calls; not connected unless enabled outside production. */
export function buildVerifiedSource(options: { publishedIds: ReadonlySet<string> }): VerifiedCompletionsSource {
  return BUILD_ALLOWS_HTTP ? createHttpCompletionsSource(options) : notConnectedSource;
}
