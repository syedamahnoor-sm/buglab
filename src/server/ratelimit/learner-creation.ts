/*
 * Rate limiting for creating anonymous learners. Server-only.
 *
 * WHAT IS LIMITED. Creating a NEW learner (the one unauthenticated write that allocates durable state), per client
 * address. Resuming a learner who already has a valid cookie is never counted. This is NOT the learner attempt limit
 * (three incorrect attempts per ten minutes per challenge session, enforced by the attempt store) and shares no code or
 * counter with it.
 *
 * THE LIMITS. The approved provisional default is 30 new learners per client address per hour. It is a placeholder for
 * the product to confirm, not a measured requirement, and both numbers are configurable:
 *
 *   BUGLAB_LEARNER_CREATION_LIMIT           integer, 1 to 100000        (default 30)
 *   BUGLAB_LEARNER_CREATION_WINDOW_SECONDS  integer, 1 to 604800        (default 3600)
 *
 * A malformed value throws at startup instead of silently falling back, as BUGLAB_APP_ORIGIN does.
 *
 * WHO "THE CLIENT" IS, AND WHY THIS NEEDS HOSTING CONFIGURATION. The address comes from X-Forwarded-For, which a client
 * can write. It is trusted only as far as BUGLAB_TRUSTED_PROXY_HOPS says: exactly that many proxies are trusted, and the
 * address taken is the one the outermost trusted proxy saw (getTrustedClientIp), never an entry the client could have
 * supplied. That is only sound if BOTH hold in the deployment:
 *
 *   1. BUGLAB_TRUSTED_PROXY_HOPS equals the number of proxies that really sit in front of the app and append to the header
 *      (not fewer, which would key on the proxy's own address and put every user in one bucket, and not more, which
 *      would key on something the client wrote);
 *   2. the application is reachable ONLY through those proxies. If a client can connect to the origin directly, it
 *      writes the whole header and can choose any address it likes, and no per-address limit can hold.
 *
 * WHEN NO CLIENT ADDRESS CAN BE ESTABLISHED (no trusted proxy configured, the header is missing, it has fewer entries than
 * the configured hops, or the address is not a valid public identity) the guard FAILS SAFELY: all such requests share ONE
 * bucket with the same limit, so creation is still bounded and never silently unlimited. The consequence is deliberate and
 * loud: a deployment that forgot to configure the hops will throttle all new learners to the limit, and it will notice.
 * `BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS=allow` opts out, explicitly, for a deployment that has decided it wants no
 * limit without a trustworthy address (for example local development); the default is `shared-limit`.
 *
 * SHARED NETWORKS. One address can be many people: a school, an office or a household behind one NAT, or a mobile carrier
 * sharing an address between subscribers, all share one allowance, so the default can turn away legitimate learners on a
 * busy shared network, and an IPv6 /64 is treated as one client. That is the price of limiting an unauthenticated
 * endpoint by address. Raise BUGLAB_LEARNER_CREATION_LIMIT if that happens; a refused learner is told when to retry.
 *
 * WHAT IS STORED. Never the address: the key is the SHA-256 of a normalised form (see client-address.ts). That keeps raw
 * addresses out of the database, but an IPv4 address has so few possibilities that the hash can be reversed by trying
 * them all, so treat the table as personal data. Rows live for one window.
 */
import "server-only";
import { createHash } from "node:crypto";
import { getTrustedClientIp } from "@/server/diagnosis/client-ip";
import type { CreationAdmission } from "@/server/session/service";
import { clientKeyOf } from "./client-address";
import type { DistributedRateLimiter, RateLimitPolicy } from "./types";

/** The scope under which per-address learner-creation counters are kept. */
export const LEARNER_CREATION_SCOPE = "learner-creation:ip";
/** The scope of the single shared counter for requests whose client address cannot be established. */
export const LEARNER_CREATION_UNIDENTIFIED_SCOPE = "learner-creation:unidentified";
const UNIDENTIFIED_KEY = "unidentified";

const HOUR_MS = 60 * 60 * 1000;

/** The approved provisional default: 30 new learners per client address per hour. See the header. */
export const DEFAULT_LEARNER_CREATION_POLICY: RateLimitPolicy = Object.freeze({ limit: 30, windowMs: HOUR_MS });

const MAX_LIMIT = 100_000;
const MAX_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/** The environment, or any object shaped like it. Only the BUGLAB_LEARNER_CREATION_* variables are read. */
export type LearnerCreationEnv = Readonly<Record<string, string | undefined>>;

function integerInRange(raw: string | undefined, name: string, min: number, max: number): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const text = raw.trim();
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

/** The policy from the environment, with the approved default for anything not set. Throws on a malformed value. */
export function parseLearnerCreationPolicy(env: LearnerCreationEnv = process.env): RateLimitPolicy {
  const limit = integerInRange(env.BUGLAB_LEARNER_CREATION_LIMIT, "BUGLAB_LEARNER_CREATION_LIMIT", 1, MAX_LIMIT);
  const seconds = integerInRange(
    env.BUGLAB_LEARNER_CREATION_WINDOW_SECONDS,
    "BUGLAB_LEARNER_CREATION_WINDOW_SECONDS",
    1,
    MAX_WINDOW_SECONDS,
  );
  return Object.freeze({
    limit: limit ?? DEFAULT_LEARNER_CREATION_POLICY.limit,
    windowMs: seconds === undefined ? DEFAULT_LEARNER_CREATION_POLICY.windowMs : seconds * 1000,
  });
}

/** What to do with a request whose client address cannot be established. */
export type UnidentifiedClientMode = "shared-limit" | "allow";

/** The mode from BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS. Unset means `shared-limit`; anything unrecognised throws. */
export function parseUnidentifiedClientMode(env: LearnerCreationEnv = process.env): UnidentifiedClientMode {
  const raw = env.BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS?.trim().toLowerCase();
  if (raw === undefined || raw === "") return "shared-limit";
  if (raw === "shared-limit" || raw === "allow") return raw;
  throw new RangeError("BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS must be shared-limit or allow.");
}

/** What a handler calls, once, when a request would create a learner. */
export type LearnerCreationGuard = (request: Request) => Promise<CreationAdmission>;

export interface LearnerCreationGuardOptions {
  /** Where the counters live. Pass a shared (database-backed) limiter for a limit that holds across instances. */
  limiter: DistributedRateLimiter;
  /** BUGLAB_TRUSTED_PROXY_HOPS, parsed. 0 means no address is trusted: every request is then unidentified. */
  trustedProxyHops: number;
  /** Defaults to DEFAULT_LEARNER_CREATION_POLICY. */
  policy?: RateLimitPolicy;
  /** What to do when no client address can be established. Defaults to `shared-limit`. */
  unidentified?: UnidentifiedClientMode;
  /** Called, with no argument, each time a request's client could not be identified. For a deployment's own monitoring. There is no default logging. */
  onUnidentified?: () => void;
}

export function createLearnerCreationGuard({
  limiter,
  trustedProxyHops,
  policy = DEFAULT_LEARNER_CREATION_POLICY,
  unidentified = "shared-limit",
  onUnidentified,
}: LearnerCreationGuardOptions): LearnerCreationGuard {
  const decide = (result: Awaited<ReturnType<DistributedRateLimiter["consume"]>>): CreationAdmission =>
    result.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: result.retryAfterSeconds };

  return async (request) => {
    const normalised = clientKeyOf(getTrustedClientIp(request.headers, trustedProxyHops));

    if (normalised !== null) {
      const key = createHash("sha256").update(normalised).digest("hex");
      return decide(await limiter.consume(LEARNER_CREATION_SCOPE, key, policy));
    }

    onUnidentified?.();
    if (unidentified === "allow") return { allowed: true };
    return decide(await limiter.consume(LEARNER_CREATION_UNIDENTIFIED_SCOPE, UNIDENTIFIED_KEY, policy));
  };
}
