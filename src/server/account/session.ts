import "server-only";
import type { AccountRuntime } from "./engine";
import type { AccountSession } from "@/lib/account/model";

/** Narrow response: never expose session tokens, hashes, provider credentials or IPs. */
export async function readAccountSession(runtime: AccountRuntime, headers: Headers): Promise<AccountSession | null> {
  const session = await runtime.auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
  if (!session || session.session.expiresAt.getTime() <= Date.now()) return null;
  const user = session.user;
  if (!user.emailVerified || (user.role !== "learner" && user.role !== "admin")) return null;
  const methods = await runtime.auth.api.listUserAccounts({ headers });
  return { user: { id: user.id, email: user.email, displayName: user.name || null, emailVerified: user.emailVerified, role: user.role, createdAt: user.createdAt.toISOString(), signInMethods: [...new Set(methods.flatMap((method) => method.providerId === "credential" ? ["password" as const] : method.providerId === "google" ? ["google" as const] : []))] }, expiresAt: session.session.expiresAt.toISOString() };
}
