import "server-only";
import { isIP } from "node:net";
import { getTrustedClientIp } from "@/server/diagnosis/client-ip";
import type { AccountSettings } from "./settings";

/** Never trust a caller's internal-IP header or unsanitized forwarding chain. */
export function providerHeaders(request: Request, settings: AccountSettings): Headers {
  const headers = new Headers(request.headers);
  const ip = getTrustedClientIp(request.headers, settings.trustedProxyHops ?? 0);
  headers.delete("x-buglab-client-ip");
  headers.delete("content-length");
  headers.delete("host");
  if (ip && isIP(ip)) headers.set("x-buglab-client-ip", ip);
  return headers;
}
