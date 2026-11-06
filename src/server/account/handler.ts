import "server-only";
import { getAccountRuntime, type AccountRuntime } from "./engine";
import { readAccountSession } from "./session";
import type { SharedLearnerIntegration } from "./shared-learner";
import { checkDisplayName, checkEmail, checkNewPassword, normaliseEmail } from "@/lib/account/validation";
import { safeReturnPath } from "@/lib/account/routes";
import { providerHeaders } from "./provider-headers";
import { verifyAccount } from "@/server/auth/verified-account";

const errorCodes: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "invalid-credentials", INVALID_PASSWORD: "invalid-credentials", EMAIL_NOT_VERIFIED: "email-unverified",
  INVALID_TOKEN: "token-invalid", TOKEN_EXPIRED: "token-expired", SESSION_EXPIRED: "unauthenticated", UNAUTHORIZED: "unauthenticated",
  PASSWORD_TOO_SHORT: "invalid", PASSWORD_TOO_LONG: "invalid", SESSION_NOT_FRESH: "reauthentication-required",
};
export function accountJson(body: unknown, status = 200, cookies?: Headers): Response {
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  for (const cookie of cookies?.getSetCookie() ?? []) headers.append("Set-Cookie", cookie);
  if (status === 401) headers.set("WWW-Authenticate", 'Session realm="buglab"');
  return Response.json(body, { status, headers });
}
const fail = (code: string, status: number, fields?: Record<string, string>) => accountJson({ status: "error", code, ...(fields ? { fields } : {}) }, status);

export function createAccountHandler(options: { runtime?: () => AccountRuntime | null; learner?: SharedLearnerIntegration } = {}) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const runtime = (options.runtime ?? getAccountRuntime)();
      const path = new URL(request.url).pathname.replace(/^\/api\/account\/?/, "");
      if (!runtime) return fail("unavailable", 503);
      const { auth, settings } = runtime;
      const write = !["GET", "HEAD"].includes(request.method);
      if (write) {
        const origin = request.headers.get("origin");
        if (origin ? origin !== settings.origin : request.headers.get("sec-fetch-site") !== "same-origin") return fail("cross-origin", 403);
        if (request.headers.get("sec-purpose")?.includes("prefetch") || request.headers.get("purpose") === "prefetch") return fail("forbidden", 403);
        if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return fail("invalid", 415);
      }
      if (path === "capabilities" && request.method === "GET") {
        await runtime.pool.query('SELECT "id" FROM "buglab_auth_user" LIMIT 0');
        return accountJson({ available: true, google: Boolean(settings.google), linking: Boolean(options.learner) });
      }
      let body: Record<string, unknown> = {};
      if (write) {
        // Bound even chunked requests, before parsing JSON or password hashing.
        const reader = request.body?.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 16_384) { await reader.cancel(); return fail("invalid", 413); } chunks.push(chunk.value); }
        try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); if (!value || typeof value !== "object" || Array.isArray(value)) return fail("invalid", 400); body = value as Record<string, unknown>; } catch { return fail("invalid", 400); }
      }
      // These requests are dispatched through the provider handler, preserving
      // its rate limits, CSRF checks and every Set-Cookie header.
      const invoke = async (endpoint: string, payload?: Record<string, unknown>, method = "POST") => {
        const url = `${settings.origin}/api/auth/${endpoint}`;
        const headers = providerHeaders(request, settings);
        headers.set("content-type", "application/json");
        if (method === "GET") headers.delete("content-type");
        return auth.handler(new Request(url, { method, headers, body: method === "GET" ? undefined : JSON.stringify(payload ?? {}) }));
      };
      const translate = async (response: Response, success: unknown) => {
        if (response.ok) return accountJson(success, 200, response.headers);
        let data: { code?: string } = {}; try { data = await response.json(); } catch { /* generic response */ }
        const result = fail(response.status === 429 ? "rate-limited" : errorCodes[data.code ?? ""] ?? (response.status >= 500 ? "server" : response.status === 401 ? "unauthenticated" : "invalid"), response.status);
        const retry = response.headers.get("retry-after") ?? response.headers.get("x-retry-after"); if (retry) result.headers.set("Retry-After", retry);
        return result;
      };
      if (path === "session" && request.method === "GET") {
        const response = await invoke("get-session?disableCookieCache=true", undefined, "GET");
        if (!response.ok) return translate(response, null);
        return accountJson({ session: await readAccountSession(runtime, request.headers) }, 200, response.headers);
      }
      const publicPost = request.method === "POST";
      if (["sign-up", "sign-in", "verify-email/resend", "password/forgot"].includes(path) && publicPost) {
        if (typeof body.email !== "string" || checkEmail(body.email)) return fail("invalid", 400, { email: "Enter a valid email address." });
        body.email = normaliseEmail(body.email);
      }
      if ((path === "sign-up" || path === "password/reset") && publicPost) {
        if (typeof body.password !== "string" || checkNewPassword(body.password)) return fail("invalid", 400, { password: "Use 12–128 characters for your password." });
      }
      if (path === "sign-up" && publicPost) {
        if (body.displayName !== null && body.displayName !== undefined && (typeof body.displayName !== "string" || checkDisplayName(body.displayName))) return fail("invalid", 400);
        // Explicit allowlist: role and other provider fields never reach Better Auth.
        return translate(await invoke("sign-up/email", { email: body.email, password: body.password, name: typeof body.displayName === "string" ? body.displayName.trim() : "", callbackURL: `${settings.origin}/login?verified=1` }), { status: "verification-required" });
      }
      if (path === "sign-in" && publicPost) {
        if (typeof body.password !== "string" || !body.password || body.password.length > 256) return fail("invalid-credentials", 401);
        const response = await invoke("sign-in/email", { email: body.email, password: body.password });
        if (!response.ok) return translate(response, null);
        const headers = new Headers(request.headers);
        headers.set("cookie", response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; "));
        const session = await readAccountSession(runtime, headers);
        return session ? accountJson({ session }, 200, response.headers) : fail("unauthenticated", 401);
      }
      if (path === "sign-out" && publicPost) return translate(await invoke("sign-out"), null);
      if (path === "verify-email" && publicPost) {
        if (typeof body.token !== "string" || !/^[A-Za-z0-9._~-]{16,4096}$/.test(body.token)) return fail("token-invalid", 400);
        return translate(await invoke(`verify-email?token=${encodeURIComponent(body.token)}`, undefined, "GET"), null);
      }
      if (path === "verify-email/resend" && publicPost) return translate(await invoke("send-verification-email", { email: body.email, callbackURL: `${settings.origin}/login?verified=1` }), null);
      if (path === "password/forgot" && publicPost) return translate(await invoke("request-password-reset", { email: body.email, redirectTo: `${settings.origin}/reset-password` }), null);
      if (path === "password/reset" && publicPost) {
        if (typeof body.token !== "string" || !/^[A-Za-z0-9._~-]{16,4096}$/.test(body.token)) return fail("token-invalid", 400);
        return translate(await invoke("reset-password", { token: body.token, newPassword: body.password }), null);
      }
      if (path === "oauth/google" && publicPost) {
        if (!settings.google) return fail("unavailable", 503);
        const next = safeReturnPath(typeof body.next === "string" ? body.next : null) ?? "/account";
        const response = await invoke("sign-in/social", { provider: "google", callbackURL: `${settings.origin}${next}`, errorCallbackURL: `${settings.origin}/login?error=oauth-failed`, disableRedirect: true });
        if (!response.ok) return translate(response, null);
        const data = await response.json();
        return accountJson({ url: data.url }, 200, response.headers);
      }
      const session = await readAccountSession(runtime, request.headers);
      if (!session) return fail("unauthenticated", 401);
      if (path === "profile" && request.method === "PATCH") {
        if (body.displayName !== null && (typeof body.displayName !== "string" || checkDisplayName(body.displayName))) return fail("invalid", 400);
        const displayName = typeof body.displayName === "string" ? body.displayName.trim() || null : null;
        const response = await invoke("update-user", { name: displayName ?? "" });
        return translate(response, { user: { ...session.user, displayName } });
      }
      if (path === "password/change" && publicPost) {
        if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string" || checkNewPassword(body.newPassword)) return fail("invalid", 400);
        return translate(await invoke("change-password", { currentPassword: body.currentPassword, newPassword: body.newPassword, revokeOtherSessions: true }), null);
      }
      if (path === "sessions" && request.method === "GET") {
        const [sessions, current] = await Promise.all([auth.api.listSessions({ headers: request.headers }), auth.api.getSession({ headers: request.headers })]);
        return accountJson({ sessions: sessions.map((item) => ({ id: item.id, current: item.id === current?.session.id, createdAt: item.createdAt.toISOString(), lastActiveAt: item.updatedAt.toISOString(), device: null })) });
      }
      if (path === "sessions/revoke-others" && publicPost) return translate(await invoke("revoke-other-sessions"), null);
      if (path.startsWith("sessions/") && request.method === "DELETE") {
        const id = decodeURIComponent(path.slice("sessions/".length));
        const sessions = await auth.api.listSessions({ headers: request.headers });
        const own = sessions.find((item) => item.id === id);
        if (!own) return fail("forbidden", 403);
        return translate(await invoke("revoke-session", { token: own.token }), null);
      }
      if (path === "link" && (request.method === "GET" || publicPost)) {
        if (!options.learner) return fail("unavailable", 503);
        const account = await verifyAccount(request, { name: "better-auth", configured: true, getSession: (incoming) => readAccountSession(runtime, incoming.headers) });
        if (!account) return fail("unauthenticated", 401);
        if (!publicPost) return accountJson(await options.learner.status(request, account));
        if (body.consent !== true) return accountJson({ outcome: "consent-required" });
        const result = await options.learner.link(request, account, true);
        const response = accountJson({ outcome: result.outcome });
        if (result.outcome === "linked" && result.clearAnonymousCookie) response.headers.append("Set-Cookie", `buglab_learner=; Path=/api; Max-Age=0; HttpOnly; SameSite=Strict${settings.origin.startsWith("https:") ? "; Secure" : ""}`);
        return response;
      }
      return fail("not-found", 404);
    } catch {
      // Do not serialize provider/SQL/email errors; they may contain secrets.
      return fail("server", 503);
    }
  };
}
