/*
 * Client IP resolution for rate limiting. Server-only.
 *
 * X-Forwarded-For is client-controlled unless the app sits behind proxies
 * that append to it. We only trust it when BUGLAB_TRUSTED_PROXY_HOPS says
 * exactly how many trusted proxies are in front of the app, and then take
 * the address that the outermost trusted proxy saw. Otherwise: no IP.
 */
import "server-only";

export function parseTrustedProxyHops(value: string | undefined): number {
  const hops = Number(value);
  return Number.isInteger(hops) && hops > 0 && hops <= 10 ? hops : 0;
}

export function getTrustedClientIp(headers: Headers, trustedProxyHops: number): string | null {
  if (trustedProxyHops <= 0) return null;

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;

  const addresses = forwarded
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // Each trusted proxy appends the address it received from, so the client
  // address is `hops` entries from the right. Anything further left is
  // whatever the client claimed and is ignored.
  const candidate = addresses[addresses.length - trustedProxyHops];
  return candidate && /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : null;
}
