import { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { parseTrustedProxyHops } from "@/server/diagnosis/client-ip";
import { createDiagnosisHandler } from "@/server/diagnosis/handler";
import { parseAppOrigin } from "@/server/diagnosis/origin";
import { restrictToPublished } from "@/server/diagnosis/published";
import { createDefaultRegistry } from "@/server/diagnosis/registry";

const TEN_MINUTES = 10 * 60 * 1000;

// Keep limiter state on globalThis so dev-mode module reloads don't reset it.
// In-memory and best-effort only; see attempt-limiter.ts.
const store = globalThis as typeof globalThis & {
  __buglabDiagnosisLimiters?: { wrongAttempts: FixedWindowLimiter; ipSubmissions: FixedWindowLimiter };
};
store.__buglabDiagnosisLimiters ??= {
  wrongAttempts: new FixedWindowLimiter({ limit: 3, windowMs: TEN_MINUTES }),
  ipSubmissions: new FixedWindowLimiter({ limit: 10, windowMs: TEN_MINUTES }),
};

export const POST = createDiagnosisHandler({
  // Only published challenges accept submissions; see published.ts.
  registry: restrictToPublished(createDefaultRegistry()),
  ...store.__buglabDiagnosisLimiters,
  trustedProxyHops: parseTrustedProxyHops(process.env.BUGLAB_TRUSTED_PROXY_HOPS),
  // Required in deployments; unset only for local development. See origin.ts.
  appOrigin: parseAppOrigin(process.env.BUGLAB_APP_ORIGIN),
});
