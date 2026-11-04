/*
 * The server's composition root: the one place the challenge registry, the session store, the
 * learner session service and the diagnosis submission handler are wired together. Server-only.
 *
 * NOTHING MOUNTS THIS. No route, page or component imports it, so it adds no public API and the
 * live diagnosis endpoint (which still has its own registry, cookie and limiter) is unchanged. A
 * route would call `getAppServices()` and export `.diagnosis`, in a later, separately approved step.
 *
 * WHAT IS WIRED.
 *
 *   challenges        the default challenge registry (Challenge 001, validated at construction)
 *   store             one object that is the learner, challenge-session and attempt store
 *   service           LearnerSessionService over those, the registry's diagnosis half, and the clock
 *   challengeVersion  the registry's content version for a challenge. It throws for an unknown
 *                     challenge instead of inventing a version, so a session can never be recorded
 *                     against a version that does not exist. The service checks that a challenge
 *                     exists before it asks, so in practice it is never called with an unknown one.
 *   ipSubmissions     the per-IP abuse limiter: 10 valid submissions per 10 minutes per client IP and
 *                     challenge, the live endpoint's numbers. It applies only when
 *                     BUGLAB_TRUSTED_PROXY_HOPS says how many proxies to trust. Best effort.
 *   diagnosis         the diagnosis submission handler (diagnosis-handler.ts) over all of the above
 *
 * There are two ways in.
 *
 *   createAppServices(options)  builds a fresh set from its options. Every collaborator can be
 *                               injected (a fake clock, a store, a registry, a limiter), and anything not
 *                               injected gets the default. It reads no global state. Tests use this.
 *   getAppServices()            the process-local instance that server code shares. It is built on first
 *                               use, not at import, so importing this module never validates a
 *                               definition or allocates a store. A definition error therefore shows up
 *                               on the first request as a 500, not as a failed build.
 *
 * WHAT SURVIVES A RELOAD. In development a module can be evaluated again (hot reload) while the
 * process keeps running. The session store and the IP limiter are kept on `globalThis`, so a reload
 * does not log every learner out or reset the limit. The registry, the service and the handler are
 * rebuilt with the module, so an edited challenge is picked up: sessions started at the old content
 * version then follow the version policy in service.ts (an unfinished one restarts).
 *
 * THE STORE IS DEVELOPMENT AND TEST ONLY. The default store is MemoryStore: state lives in this one
 * process. It is lost on restart. It is NOT durable, NOT shared between processes, and NOT safe for a
 * production, serverless or multi-instance deployment: a learner created in one instance does not exist
 * in another, so every request that reaches a different instance is answered "no learner". It also
 * grows without bound, because nothing calls purgeExpired(). It is here so the whole flow can be built,
 * reviewed and tested. A durable adapter that passes the same three contract suites must replace it
 * before this is deployed anywhere real. The IP limiter is in-memory and best effort for the same reasons.
 */
import "server-only";
import { createDefaultChallengeRegistry } from "@/server/challenges/default-registry";
import type { ChallengeRegistry } from "@/server/challenges/registry";
import { FixedWindowLimiter } from "@/server/diagnosis/attempt-limiter";
import { parseTrustedProxyHops } from "@/server/diagnosis/client-ip";
import { createDiagnosisSubmissionHandler, type IpSubmissionLimiter } from "./session/diagnosis-handler";
import { MemoryStore } from "./session/memory-store";
import { createLearnerSessionService, type LearnerSessionService } from "./session/service";
import type { AttemptStore, AttemptWindow, ChallengeSessionStore, LearnerStore } from "./session/types";

/** The three ports as one object, which is how the session service uses them (and how MemoryStore provides them). */
export type SessionStore = LearnerStore & ChallengeSessionStore & AttemptStore;

/** The per-IP abuse limit, the live endpoint's own numbers. */
const IP_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 } as const;

export interface AppServicesOptions {
  /** Defaults to the default challenge registry. */
  challenges?: ChallengeRegistry;
  /** Defaults to a new MemoryStore, which is for development and tests only. */
  store?: SessionStore;
  /** Defaults to the 10-per-10-minutes limiter. */
  ipSubmissions?: IpSubmissionLimiter;
  /** Defaults to BUGLAB_TRUSTED_PROXY_HOPS, read now. 0 trusts no client IP. */
  trustedProxyHops?: number;
  /**
   * The clock for the service and for whatever default store and limiter are built here. A store or
   * limiter passed in keeps its own clock, so share one with it in tests.
   */
  now?: () => number;
  /** Defaults to the service's own window (three incorrect attempts per ten minutes). */
  attemptWindow?: AttemptWindow;
  /** Source of ids for submissions that arrive without an Idempotency-Key. */
  newSubmissionId?: () => string;
}

export interface AppServices {
  readonly challenges: ChallengeRegistry;
  readonly store: SessionStore;
  readonly service: LearnerSessionService;
  readonly ipSubmissions: IpSubmissionLimiter;
  readonly trustedProxyHops: number;
  /** The challenge's current content version. Throws for a challenge the registry does not have. */
  readonly challengeVersion: (challengeId: string) => string;
  /** POST /api/challenges/:challengeId/diagnosis. Not mounted. */
  readonly diagnosis: ReturnType<typeof createDiagnosisSubmissionHandler>;
}

export function createAppServices(options: AppServicesOptions = {}): AppServices {
  const challenges = options.challenges ?? createDefaultChallengeRegistry();
  const store: SessionStore = options.store ?? new MemoryStore({ now: options.now });
  const ipSubmissions = options.ipSubmissions ?? new FixedWindowLimiter({ ...IP_LIMIT, now: options.now });
  const trustedProxyHops = options.trustedProxyHops ?? parseTrustedProxyHops(process.env.BUGLAB_TRUSTED_PROXY_HOPS);

  const challengeVersion = (challengeId: string): string => {
    const version = challenges.contentVersion(challengeId);
    if (version === undefined) throw new Error("The challenge registry has no content version for this challenge.");
    return version;
  };

  const service = createLearnerSessionService({
    learners: store,
    sessions: store,
    attempts: store,
    registry: challenges.diagnosisRegistry,
    challengeVersion,
    now: options.now,
    attemptWindow: options.attemptWindow,
    newSubmissionId: options.newSubmissionId,
  });

  return Object.freeze({
    challenges,
    store,
    service,
    ipSubmissions,
    trustedProxyHops,
    challengeVersion,
    diagnosis: createDiagnosisSubmissionHandler({
      service,
      registry: challenges.diagnosisRegistry,
      ipSubmissions,
      trustedProxyHops,
    }),
  });
}

/** What outlives a module reload. The registry, service and handler are deliberately not part of it. */
interface SharedState {
  store: SessionStore;
  ipSubmissions: IpSubmissionLimiter;
}

/** The `globalThis` property that holds the shared state. Exported so a test can inspect or clear it. */
export const SHARED_STATE_KEY = "__buglabSharedServerState";

type WithSharedState = typeof globalThis & { [SHARED_STATE_KEY]?: SharedState };

/** The process-wide store and IP limiter, created on first use. */
export function getSharedState(): SharedState {
  const scope = globalThis as WithSharedState;
  scope[SHARED_STATE_KEY] ??= {
    store: new MemoryStore(),
    ipSubmissions: new FixedWindowLimiter(IP_LIMIT),
  };
  return scope[SHARED_STATE_KEY];
}

let current: AppServices | undefined;

/**
 * The process-local services, built on first use and then reused. The store and IP limiter come
 * from the shared state, so they survive a reload of this module; see the header.
 */
export function getAppServices(): AppServices {
  current ??= createAppServices(getSharedState());
  return current;
}
