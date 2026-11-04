/*
 * Gets a learner a ready session for one challenge, with as few calls as possible.
 *
 *   1. Read the session.                     Active and current: ready, nothing created.
 *   2. No learner, or it expired (401):      create the learner, then start the session.
 *   3. No session, or restartRequired:       start it (the server restarts an outdated one).
 *
 * Concurrent ensure() calls share one run, and a ready result is kept, so the
 * same initialization never runs twice. A failure is not kept: the next ensure()
 * tries again. invalidate() drops the kept result, e.g. after a submission was
 * answered 401 (learner gone) or 409 session-outdated, so the next ensure() reads
 * the server again and reports a version change.
 *
 * Restoring a completed session into the workspace is Phase 2: a ready result
 * carries the session view, completion included, and does nothing with it.
 */
import type { ApiError, ChallengeSession } from "@/types/learner-session";
import type { LearnerSessionApi } from "./api";

export type SessionInit =
  | {
      kind: "ready";
      session: ChallengeSession;
      /** A learner was created during this run. */
      learnerCreated: boolean;
      /** A new session was started (first visit, or after a restart). */
      sessionCreated: boolean;
      /** The server replaced an outdated unfinished session: clear local working state. */
      restarted: boolean;
      /** The content version differs from the last ready session this coordinator saw. */
      versionChanged: boolean;
    }
  | { kind: "failed"; error: ApiError };

type Api = Pick<LearnerSessionApi, "getSession" | "startLearner" | "startSession">;

export function createSessionCoordinator(api: Api, challengeId: string) {
  let pending: Promise<SessionInit> | null = null;
  let ready: Extract<SessionInit, { kind: "ready" }> | null = null;
  let lastVersion: string | null = null;

  function done(
    session: ChallengeSession,
    flags: { learnerCreated: boolean; sessionCreated: boolean; restarted: boolean },
  ): SessionInit {
    const versionChanged = lastVersion !== null && lastVersion !== session.contentVersion;
    lastVersion = session.contentVersion;
    ready = { kind: "ready", session, ...flags, versionChanged };
    return ready;
  }

  async function start(learnerCreated: boolean): Promise<SessionInit> {
    const started = await api.startSession(challengeId);
    if (started.ok) {
      return done(started.data.session, {
        learnerCreated,
        sessionCreated: started.data.created,
        restarted: started.data.restarted,
      });
    }
    // The learner can expire between the read and the start: recreate it once.
    if (started.error.kind === "unauthorized" && !learnerCreated) return createLearnerThenStart();
    return { kind: "failed", error: started.error };
  }

  async function createLearnerThenStart(): Promise<SessionInit> {
    const learner = await api.startLearner();
    if (!learner.ok) return { kind: "failed", error: learner.error };
    return start(true);
  }

  async function run(): Promise<SessionInit> {
    const current = await api.getSession(challengeId);
    if (!current.ok) {
      return current.error.kind === "unauthorized" ? createLearnerThenStart() : { kind: "failed", error: current.error };
    }
    const view = current.data;
    if (view.state === "active" && !view.session.restartRequired) {
      return done(view.session, { learnerCreated: false, sessionCreated: false, restarted: false });
    }
    return start(false);
  }

  return {
    /** A ready session, or why there is none. Safe to call any number of times. */
    ensure(): Promise<SessionInit> {
      if (ready) return Promise.resolve(ready);
      pending ??= run().finally(() => {
        pending = null;
      });
      return pending;
    },
    /** Forget the ready session so the next ensure() asks the server again. */
    invalidate(): void {
      ready = null;
    },
  };
}

export type SessionCoordinator = ReturnType<typeof createSessionCoordinator>;
