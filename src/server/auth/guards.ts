/*
 * Reusable server-side authorization guards. Server-only.
 *
 * Every protected route handler or server action calls one of these before
 * doing anything; hiding a button is never the protection. Writes also need
 * the application's own origin (the shared rule in src/server/diagnosis/origin.ts),
 * a JSON body and no prefetch, as the learner-session handlers already require.
 */
import "server-only";
import { isSameOriginRequest } from "@/server/diagnosis/origin";
import { can, type Permission } from "./permissions";
import type { AuthProvider } from "./provider";
import type { AuthenticatedUser } from "./types";

export type GuardResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; status: 401 | 403; code: "unauthenticated" | "forbidden" | "cross-origin"; response: Response };

function refuse(status: 401 | 403, code: "unauthenticated" | "forbidden" | "cross-origin", message: string): GuardResult {
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" });
  if (status === 401) headers.set("WWW-Authenticate", 'Session realm="buglab"');
  return { ok: false, status, code, response: Response.json({ status: "error", code, message }, { status, headers }) };
}

/** The signed-in user, or a 401 response. */
export async function requireUser(request: Request, provider: AuthProvider): Promise<GuardResult> {
  const session = await provider.getSession(request);
  if (!session) return refuse(401, "unauthenticated", "Sign in to continue.");
  return { ok: true, user: session.user };
}

/** A signed-in user holding `permission`, or a 401 (not signed in) or 403 (signed in, not allowed). */
export async function requirePermission(request: Request, permission: Permission, provider: AuthProvider): Promise<GuardResult> {
  const result = await requireUser(request, provider);
  if (!result.ok) return result;
  if (!can(result.user.role, permission)) return refuse(403, "forbidden", "You do not have access to this.");
  return result;
}

/**
 * For state-changing requests: same origin first (403 otherwise, before any
 * session lookup), then the permission. `appOrigin` is the parsed BUGLAB_APP_ORIGIN.
 */
export async function requirePermissionForWrite(
  request: Request,
  permission: Permission,
  provider: AuthProvider,
  appOrigin: string | null,
): Promise<GuardResult> {
  // A write must say where it came from: with no Origin, only Sec-Fetch-Site: same-origin counts.
  const origin = request.headers.get("origin");
  const sameOrigin = origin
    ? isSameOriginRequest(request, appOrigin ?? new URL(request.url).origin)
    : request.headers.get("sec-fetch-site") === "same-origin";
  if (!sameOrigin) return refuse(403, "cross-origin", "Cross-origin requests are not allowed.");
  return requirePermission(request, permission, provider);
}
