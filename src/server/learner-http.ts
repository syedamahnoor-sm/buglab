/*
 * Mounted learner HTTP composition. Server-only.
 *
 * Wires Habin session and Learning Loop handlers to getAppServices()' MemoryStore by default.
 * PostgreSQL selection remains opt-in via deployment configuration (BUGLAB_DATABASE_URL).
 * Account linking is NOT wired into the account route — migration 0003 stays inactive until joint apply approval.
 */
import "server-only";
import { getAppServices } from "@/server/app-services";
import { createLearningLoopHandlers } from "@/server/learning-loop/handlers";
import { MemoryLearningLoopStore } from "@/server/learning-loop/memory-store";
import { createLearningLoopService } from "@/server/learning-loop/service";
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
} from "@/server/ratelimit/learner-creation";
import { MemoryRateLimiter } from "@/server/ratelimit/memory-rate-limiter";

const SHARED_LOOP_KEY = "__buglabSharedLearningLoopStore";
const SHARED_CREATION_LIMITER_KEY = "__buglabSharedLearnerCreationLimiter";

type WithShared = typeof globalThis & {
  [SHARED_LOOP_KEY]?: MemoryLearningLoopStore;
  [SHARED_CREATION_LIMITER_KEY]?: MemoryRateLimiter;
};

function getLearningLoopStore(): MemoryLearningLoopStore {
  const scope = globalThis as WithShared;
  if (!scope[SHARED_LOOP_KEY]) {
    const { store } = getAppServices();
    scope[SHARED_LOOP_KEY] = new MemoryLearningLoopStore({
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
    });
  }
  return scope[SHARED_LOOP_KEY];
}

function getCreationLimiter(): MemoryRateLimiter {
  const scope = globalThis as WithShared;
  scope[SHARED_CREATION_LIMITER_KEY] ??= new MemoryRateLimiter();
  return scope[SHARED_CREATION_LIMITER_KEY];
}

export function getLearnerHttp() {
  const app = getAppServices();
  const learnerCreation = createLearnerCreationGuard({
    limiter: getCreationLimiter(),
    trustedProxyHops: app.trustedProxyHops,
    policy: parseLearnerCreationPolicy(),
    unidentified: parseUnidentifiedClientMode(),
  });
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
    store: getLearningLoopStore(),
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
