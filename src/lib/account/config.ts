/*
 * Legacy build-time selector, retained for callers that explicitly request
 * a disconnected client. Live UI uses the HTTP boundary and runtime capability
 * discovery; server activation requires complete configuration plus a separate
 * production verification gate. No public flag can enable the provider.
 *
 * The same rule as the verified-completions source (lib/verified/config.ts):
 * the HTTP account API is used only when BOTH hold at build time
 *   - NEXT_PUBLIC_BUGLAB_ACCOUNTS is exactly "enabled"
 *   - the build is not a production build (NODE_ENV !== "production")
 * Everything else, including every production build whatever the flag says,
 * gets the disconnected API: no request is made, the header offers no sign-in,
 * and the account pages say plainly that accounts are not available yet.
 *
 * This legacy selector cannot activate production authentication.
 */
import { createHttpAccountApi, disconnectedAccountApi, type AccountApi } from "./api";

export const ACCOUNTS_FLAG = "NEXT_PUBLIC_BUGLAB_ACCOUNTS";

export type AccountsConfig = { mode: "disconnected"; reason: "flag-off" | "production-build" } | { mode: "http" };

export function resolveAccountsConfig(env: { flag: string | undefined; nodeEnv: string | undefined }): AccountsConfig {
  if (env.flag !== "enabled") return { mode: "disconnected", reason: "flag-off" };
  if (env.nodeEnv === "production") return { mode: "disconnected", reason: "production-build" };
  return { mode: "http" };
}

export const ACCOUNTS_BUILD_CONFIG: AccountsConfig = resolveAccountsConfig({
  flag: process.env.NEXT_PUBLIC_BUGLAB_ACCOUNTS,
  nodeEnv: process.env.NODE_ENV,
});

/**
 * Inlined by Next.js at build time, so a production build sees the literal
 * `false` and drops the HTTP client from the bundle. Kept in step with
 * resolveAccountsConfig (tested).
 */
export const ACCOUNTS_CONNECTED: boolean = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_BUGLAB_ACCOUNTS === "enabled";

/** The account API this build uses. */
export function buildAccountApi(): AccountApi {
  return ACCOUNTS_CONNECTED ? createHttpAccountApi() : disconnectedAccountApi;
}
