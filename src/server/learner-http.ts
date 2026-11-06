/*
 * Mounted learner HTTP composition. Server-only.
 *
 * Default: MemoryStore + MemoryLearningLoopStore (process-local) via getAppServices().
 * When BUGLAB_DATABASE_URL is set: PostgresStore + PostgresLearningLoopStore via
 * resolveLearnerPersistence() / createAppServices({ store }). Operators must apply
 * migrations 0001/0002/0004/0005 with BUGLAB_DATABASE_URL_DIRECT before enabling the
 * runtime URL. Migration 0003 (account_learner_links) stays unapplied; SharedLearner
 * linking is NOT wired into the account route until joint apply approval.
 */
import "server-only";
import { createAppServices, getAppServices, type AppServices } from "@/server/app-services";
import { resolveLearnerPersistence } from "@/server/learner-persistence";
import { createLearningLoopHandlers } from "@/server/learning-loop/handlers";
import { MemoryLearningLoopStore } from "@/server/learning-loop/memory-store";
import { PostgresLearningLoopStore } from "@/server/learning-loop/postgres-store";
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

type SharedLearnerHttp = {
  app: AppServices;
  learningLoopStore: LearningLoopStore;
  learnerCreation: LearnerCreationGuard;
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
    const app = createAppServices({ store: persistence.store });
    scope[SHARED_HTTP_KEY] = {
      app,
      learningLoopStore: new PostgresLearningLoopStore({ pool: persistence.pool }),
      learnerCreation: persistence.learnerCreationGuard({ trustedProxyHops: app.trustedProxyHops }),
    };
    return scope[SHARED_HTTP_KEY];
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
