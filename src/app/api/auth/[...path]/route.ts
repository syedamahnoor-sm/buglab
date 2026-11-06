import { getAccountRuntime } from "@/server/account/engine";
import { accountJson } from "@/server/account/handler";
import { providerHeaders } from "@/server/account/provider-headers";

/** Only OAuth's provider callback is public; all account operations use BugLab's boundary. */
export async function GET(request: Request) {
  try {
    const runtime = getAccountRuntime();
    if (!runtime?.settings.google) return accountJson({ code: "unavailable" }, 503);
    if (new URL(request.url).pathname !== "/api/auth/callback/google") return accountJson({ code: "not-found" }, 404);
    const response = await runtime.auth.handler(new Request(request, { headers: providerHeaders(request, runtime.settings) }));
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch { return accountJson({ code: "server" }, 503); }
}
