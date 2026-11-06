/*
 * Strict reading and validation of the trusted-proxy configuration, so a wrong or missing setting is DETECTABLE at startup
 * instead of silently weakening or breaking the learner-creation limit. Server-only.
 *
 * WHY THIS EXISTS. BUGLAB_TRUSTED_PROXY_HOPS decides whose word about a client's address is believed. The parser the live
 * diagnosis endpoint uses (src/server/diagnosis/client-ip.ts, not changed here) turns EVERY problem into 0: "abc", "11",
 * "-1", "1.5" and a forgotten variable all quietly become "trust nothing", and it cannot tell a deliberate 0 from an unset
 * variable. It also accepts spellings nobody means ("0x2" is 2, "1e1" is 10, "+1" is 1). That is the right fail-safe at
 * request time and the wrong thing to find out about in production. This module reads the SAME variable strictly and
 * agrees with that parser on every value it accepts, so the two never disagree about a good configuration.
 *
 * THE RULES.
 *   - The value is a whole number of proxies from 0 to 10, in plain decimal (surrounding space is ignored; no sign, no
 *     leading zeros, no hex, no exponent, no decimals). Anything else is INVALID, and invalid is always an error.
 *   - `0` means "I have decided that no proxy is trusted". It is a valid, explicit setting.
 *   - Unset or blank means "not decided". In development that is allowed (with a warning). In PRODUCTION it is an error:
 *     a production deployment must say how many proxies stand in front of it, even if the answer is none. It is never
 *     assumed from the hosting platform or from the request.
 *   - "Production" is NODE_ENV === "production", which `next build` and `next start` set. Nothing else is inferred.
 *
 * What this module does NOT do: it does not read any forwarded header, it does not look at a request, and it does not
 * guess a number. Which entry of X-Forwarded-For is believed is still decided only by getTrustedClientIp, and only when
 * this setting says to trust a proxy.
 */
import "server-only";
import { parseUnidentifiedClientMode, parseLearnerCreationPolicy } from "./learner-creation";

/** The most proxies that may be trusted. The same bound as the existing parser. */
export const MAX_TRUSTED_PROXY_HOPS = 10;

export type ProxyHopsState = "configured" | "unconfigured" | "invalid";

export interface ProxyHopsReading {
  readonly state: ProxyHopsState;
  /** The number of proxies to trust. 0 when unconfigured or invalid: nothing is trusted. */
  readonly hops: number;
  /** Why the value is invalid. Never contains the value itself. */
  readonly reason?: string;
}

/** Reads one raw setting strictly. Does not throw. */
export function readTrustedProxyHops(raw: string | undefined): ProxyHopsReading {
  const text = raw?.trim();
  if (text === undefined || text === "") return { state: "unconfigured", hops: 0 };
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    return { state: "invalid", hops: 0, reason: `must be a whole number of proxies from 0 to ${MAX_TRUSTED_PROXY_HOPS}, in plain decimal` };
  }
  const hops = Number(text);
  if (hops > MAX_TRUSTED_PROXY_HOPS) {
    return { state: "invalid", hops: 0, reason: `must be a whole number of proxies from 0 to ${MAX_TRUSTED_PROXY_HOPS}, in plain decimal` };
  }
  return { state: "configured", hops };
}

/** The environment, or any object shaped like it. */
export type ProxyConfigEnv = Readonly<Record<string, string | undefined>>;

export interface ProxyConfigurationReport {
  readonly production: boolean;
  readonly hops: ProxyHopsReading;
  /** Things that must be fixed before the deployment is allowed to serve. */
  readonly problems: readonly string[];
  /** Things that are allowed but weaken protection, so they are stated, never silent. */
  readonly warnings: readonly string[];
}

export interface InspectOptions {
  /** Defaults to NODE_ENV === "production". */
  readonly production?: boolean;
}

/**
 * Everything wrong or worth knowing about the proxy and creation-limit settings, without throwing. For a startup check or a
 * health endpoint that wants to report rather than stop. Messages name the variable and the rule, never a value.
 */
export function inspectProxyConfiguration(env: ProxyConfigEnv = process.env, options: InspectOptions = {}): ProxyConfigurationReport {
  const production = options.production ?? env.NODE_ENV === "production";
  const hops = readTrustedProxyHops(env.BUGLAB_TRUSTED_PROXY_HOPS);
  const problems: string[] = [];
  const warnings: string[] = [];

  if (hops.state === "invalid") {
    problems.push(`BUGLAB_TRUSTED_PROXY_HOPS ${hops.reason}. An invalid value is never guessed at.`);
  } else if (hops.state === "unconfigured") {
    if (production) {
      problems.push(
        "BUGLAB_TRUSTED_PROXY_HOPS is not set. A production deployment must say how many proxies stand in front of it " +
          "(use 0 to declare that none is trusted).",
      );
    } else {
      warnings.push("BUGLAB_TRUSTED_PROXY_HOPS is not set: no forwarded address is trusted, so every client counts as unidentified.");
    }
  } else if (hops.hops === 0) {
    warnings.push("BUGLAB_TRUSTED_PROXY_HOPS is 0: no forwarded address is trusted, so every client counts as unidentified.");
  }

  // The creation limit's own settings: a malformed value throws when read, so report it as a problem rather than a crash.
  for (const [read, name] of [
    [() => parseLearnerCreationPolicy(env), "BUGLAB_LEARNER_CREATION_LIMIT / BUGLAB_LEARNER_CREATION_WINDOW_SECONDS"],
    [() => parseUnidentifiedClientMode(env), "BUGLAB_LEARNER_CREATION_UNIDENTIFIED_CLIENTS"],
  ] as const) {
    try {
      const value = read();
      if (value === "allow") {
        warnings.push(`${name} is "allow": new learners from clients whose address cannot be established are NOT limited.`);
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : `${name} is invalid.`);
    }
  }

  return Object.freeze({ production, hops, problems: Object.freeze(problems), warnings: Object.freeze(warnings) });
}

export class ProxyConfigurationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid proxy or rate-limit configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ProxyConfigurationError";
    this.problems = problems;
  }
}

/** Throws ProxyConfigurationError if there is any problem. Returns the report (with its warnings) otherwise. */
export function assertProxyConfiguration(env: ProxyConfigEnv = process.env, options: InspectOptions = {}): ProxyConfigurationReport {
  const report = inspectProxyConfiguration(env, options);
  if (report.problems.length > 0) throw new ProxyConfigurationError(report.problems);
  return report;
}

/**
 * The number of proxies to trust, validated. Throws ProxyConfigurationError for anything invalid, and in production for an
 * unset variable.
 *
 * `explicit` is a number the caller already holds (for example the composition root's). It must AGREE with the environment
 * when the environment is set: the live diagnosis endpoint and the session handlers read the same variable, so two numbers
 * would mean two different ideas of who the client is.
 */
export function resolveTrustedProxyHops(
  env: ProxyConfigEnv = process.env,
  options: InspectOptions & { explicit?: number } = {},
): number {
  const report = assertProxyConfiguration(env, options);
  const { explicit } = options;
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit < 0 || explicit > MAX_TRUSTED_PROXY_HOPS) {
      throw new ProxyConfigurationError([`The trusted proxy count passed in must be a whole number from 0 to ${MAX_TRUSTED_PROXY_HOPS}.`]);
    }
    if (report.hops.state === "configured" && report.hops.hops !== explicit) {
      throw new ProxyConfigurationError([
        "The trusted proxy count passed in disagrees with BUGLAB_TRUSTED_PROXY_HOPS. Both the diagnosis endpoint and the " +
          "session handlers read that variable, so they must use one number.",
      ]);
    }
    return explicit;
  }
  return report.hops.hops;
}
