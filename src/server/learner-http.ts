/*
 * Mounted learner HTTP composition. Server-only.
 *
 * Default: MemoryStore + MemoryLearningLoopStore (process-local) via getAppServices().
 * When BUGLAB_DATABASE_URL is set: PostgresStore, and the Learning Loop factory that
 * verifies migration 0004 and digest() before it returns a store. The first learner
 * or learning request also verifies core migrations through 0002. A failed check is
 * not cached as success, answers 500, and never falls back to the memory stores.
 * Operators apply 0001/0002/0004/0005 with BUGLAB_DATABASE_URL_DIRECT before enabling
 * the runtime URL. Migration 0003 (account_learner_links) stays unapplied; SharedLearner
 * linking is NOT wired into the account route until joint apply approval.
 */
import "server-only";
import { createAppServices, getAppServices, type AppServices, type SessionStore } from "@/server/app-services";
import { startPeriodicPurge, type PostgresPersistence } from "@/server/db/persistence";
import { resolveLearnerPersistence } from "@/server/learner-persistence";
import { createLearningLoopHandlers } from "@/server/learning-loop/handlers";
import { MemoryLearningLoopStore } from "@/server/learning-loop/memory-store";
import { createPostgresLearningLoopStore } from "@/server/learning-loop/postgres-store";
import { createLearningLoopService } from "@/server/learning-loop/service";
import type { LearningLoopStore } from "@/server/learning-loop/types";
import {
  createAttemptHistoryHandler,
  createChallengeSessionHandlers,
  createLearnerCompletionsHandler,
  createLearnerHandlers,
} from "@/server/session/handlers";
import {
  createLearnerCreationGuard,
  parseLearnerCreationPolicy,
  parseUnidentifiedClientMode,
  type LearnerCreationGuard,
} from "@/server/ratelimit/learner-creation";
import { MemoryRateLimiter } from "@/server/ratelimit/memory-rate-limiter";

const SHARED_HTTP_KEY = "__buglabSharedLearnerHttp";

/** Expired-row cleanup. Correctness does not depend on this interval; the timer does not keep the process alive. */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

type SharedLearnerHttp = {
  app: AppServices;
  learningLoopStore: LearningLoopStore;
  learnerCreation: LearnerCreationGuard;
  release?: () => Promise<void>;
};

type WithShared = typeof globalThis & {
  [SHARED_HTTP_KEY]?: SharedLearnerHttp;
  __buglabSharedLearnerCreationLimiter?: MemoryRateLimiter;
};

function getMemoryCreationLimiter(): MemoryRateLimiter {
  const scope = globalThis as WithShared;
  scope.__buglabSharedLearnerCreationLimiter ??= new MemoryRateLimiter();
  return scope.__buglabSharedLearnerCreationLimiter;
}

function getSharedLearnerHttp(): SharedLearnerHttp {
  const scope = globalThis as WithShared;
  if (scope[SHARED_HTTP_KEY]) return scope[SHARED_HTTP_KEY];

  const persistence = resolveLearnerPersistence();
  if (persistence) {
    const postgres = postgresLearnerHttp(persistence);
    scope[SHARED_HTTP_KEY] = postgres;
    return postgres;
  }

  const app = getAppServices();
  const { store } = app;
  scope[SHARED_HTTP_KEY] = {
    app,
    learningLoopStore: new MemoryLearningLoopStore({
      listCompletions: async (learnerId) => {
        const sessions = await store.listCurrentCompleted(learnerId);
        return sessions
          .filter((session) => typeof session.completedAt === "number")
          .map((session) => ({
            sessionId: session.id,
            challengeId: session.challengeId,
            completedAt: session.completedAt as number,
          }));
      },
    }),
    learnerCreation: createLearnerCreationGuard({
      limiter: getMemoryCreationLimiter(),
      trustedProxyHops: app.trustedProxyHops,
      policy: parseLearnerCreationPolicy(),
      unidentified: parseUnidentifiedClientMode(),
    }),
  };
  return scope[SHARED_HTTP_KEY];
}

export function getLearnerHttp() {
  const { app, learningLoopStore, learnerCreation } = getSharedLearnerHttp();
  const learner = createLearnerHandlers({
    service: app.service,
    appOrigin: app.appOrigin,
    learnerCreation,
  });
  const challengeSession = createChallengeSessionHandlers({
    service: app.service,
    appOrigin: app.appOrigin,
  });
  const completions = createLearnerCompletionsHandler({
    service: app.service,
    appOrigin: app.appOrigin,
  });
  const attempts = createAttemptHistoryHandler({
    service: app.service,
    appOrigin: app.appOrigin,
  });

  const learningLoopService = createLearningLoopService({
    learners: app.store,
    sessions: app.store,
    store: learningLoopStore,
    registry: {
      has: (challengeId) => app.challenges.getPublic(challengeId) !== undefined,
    },
  });
  const learning = createLearningLoopHandlers({
    service: learningLoopService,
    appOrigin: app.appOrigin,
  });

  return { learner, challengeSession, completions, attempts, learning, app };
}

/**
 * Drops the cached composition and closes its pool, when one was opened. Tests use this so a
 * failed Postgres configuration cannot leak into a later case. Production does not call it.
 */
export async function resetSharedLearnerHttpForTests(): Promise<void> {
  const scope = globalThis as WithShared;
  const shared = scope[SHARED_HTTP_KEY];
  delete scope[SHARED_HTTP_KEY];
  await shared?.release?.();
}

/**
 * Forwards every method call until `open` resolves. A rejection is the caller's rejection, so a
 * schema or connection failure stays on that request and is not replaced with the memory stores.
 */
function callAfter<T extends object>(open: () => Promise<T>): T {
  return new Proxy({} as T, {
    get(_target, property) {
      if (property === "then") return undefined;
      return (...args: unknown[]) =>
        open().then((target) => {
          const method = Reflect.get(target, property, target);
          if (typeof method !== "function") return method;
          return Reflect.apply(method, target, args);
        });
    },
  });
}

function postgresLearnerHttp(persistence: PostgresPersistence): SharedLearnerHttp {
  let opening: Promise<void> | null = null;
  let loopStore: LearningLoopStore | null = null;
  let stopPurge: (() => void) | undefined;

  const ready = (): Promise<void> => {
    if (!opening) {
      opening = (async () => {
        await persistence.verifySchema();
        loopStore = await createPostgresLearningLoopStore({ pool: persistence.pool });
        stopPurge ??= startPeriodicPurge(persistence, { intervalMs: PURGE_INTERVAL_MS });
      })().catch((error: unknown) => {
        opening = null;
        loopStore = null;
        throw error;
      });
    }
    return opening;
  };

  const app = createAppServices({
    store: callAfter<SessionStore>(async () => {
      await ready();
      return persistence.store;
    }),
  });
  const guard = persistence.learnerCreationGuard({ trustedProxyHops: app.trustedProxyHops });

  return {
    app,
    learningLoopStore: callAfter(async () => {
      await ready();
      if (!loopStore) throw new Error("BugLab learner persistence is not ready.");
      return loopStore;
    }),
    learnerCreation: async (request) => {
      await ready();
      return guard(request);
    },
    release: async () => {
      stopPurge?.();
      stopPurge = undefined;
      opening = null;
      loopStore = null;
      await persistence.close();
    },
  };
}
