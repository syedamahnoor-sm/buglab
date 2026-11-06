/*
 * Turns a client address into a rate-limit key, strictly. Server-only and pure.
 *
 * The address it is given has ALREADY been picked out of X-Forwarded-For by getTrustedClientIp, which counts trusted
 * proxies from the right. That function checks only that the text is made of address-like characters, so this one
 * validates it for real before it becomes a key:
 *
 *   - it must be a syntactically valid IPv4 or IPv6 address (node:net `isIP`). Garbage such as "1:2" or "....", an
 *     address with a zone id ("fe80::1%eth0") and the unspecified addresses ("0.0.0.0", "::") are NOT an identity;
 *   - an IPv4-mapped IPv6 address (::ffff:203.0.113.9) is the same client as the IPv4 address, so it gets the same key,
 *     and a client cannot get two allowances by being reachable both ways;
 *   - an IPv6 address is keyed by its /64 prefix. A single subscriber is normally given a whole /64, so keying on the full
 *     address would let one client rotate through 2^64 addresses and never be limited.
 *
 * Returns null when no usable identity can be established, and the caller must then fail safely (see learner-creation.ts).
 */
import "server-only";
import { isIP } from "node:net";

const hex4 = (group: number) => group.toString(16).padStart(4, "0");

/** The eight 16-bit groups of an IPv6 address, or null if it is not one. Handles `::` and an embedded IPv4 tail. */
function groupsOf(address: string): number[] | null {
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const [a, b, c, d] = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const all = halves.length === 1 ? head : [...head, ...Array<string>(missing).fill("0"), ...rest];
  const groups = all.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group)) ? groups : null;
}

/** A stable key for the client behind `address`, or null if `address` is not a usable client identity. */
export function clientKeyOf(address: string | null): string | null {
  if (address === null) return null;
  const text = address.trim();
  if (text === "" || text.includes("%")) return null;

  const family = isIP(text);
  if (family === 4) return text === "0.0.0.0" ? null : `v4:${text}`;
  if (family !== 6) return null;

  const groups = groupsOf(text);
  if (!groups || groups.every((group) => group === 0)) return null;
  const isMappedV4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isMappedV4) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
    return v4 === "0.0.0.0" ? null : `v4:${v4}`;
  }
  return `v6/64:${groups.slice(0, 4).map(hex4).join(":")}`;
}
