/*
 * The learner session service. Server-only.
 *
 * The one place that ties the three ports to the diagnosis logic that already
 * exists. It owns four rules:
 *
 *  1. Identity comes only from the learner cookie, parsed and hashed here. No
 *     method accepts a learner id, a session id or a completion flag from a caller.
 *  2. A learner is created only by startLearner. Nothing else, reads and diagnosis
 *     submissions included, ever creates one, so an expired identity is reported
 *     and never silently replaced.
 *  3. Completion is decided here, by the existing server-side evaluation. A
 *     session becomes `completed` only through the attempt store, recording an
 *     outcome this service computed. Nothing in a submission can set it.
 *  4. Nothing returned to a caller contains an internal id or a token hash, and no answer-key
 *     data except the result a COMPLETED session stored when it was completed. Views come from
 *     snapshots.ts.
 *
 * THE VERSION POLICY. Every session records the challenge's content version when it starts
 * (`<registry revision>+<public content hash>`). When the challenge's current version differs:
 *
 *   - a COMPLETED session is left exactly as it is. Its result, completion time and winning
 *     submission are preserved, and replays of it use the result stored at completion, never the
 *     current answer key. Completion is never undone and never restarted by a version change.
 *   - an UNFINISHED session is out of date, whatever changed: the public content (the learner's
 *     evidence and options may no longer exist) or only the revision (a corrected answer key,
 *     which would make earlier verdicts wrong). It is not repaired or migrated. It records nothing
 *     more (submitDiagnosis answers "session-outdated"), a read reports `restartRequired`, and
 *     startChallenge, the one explicit write, replaces it with a fresh session at the new version.
 *     The old session and its attempts are kept as history.
 *
 * The comparison is exact equality of the version strings. The service does not take the version
 * apart, so it cannot be fooled by a format it does not control.
 *
 * It does not touch the diagnosis endpoint. Wiring submitDiagnosis into that
 * endpoint is a separate step that needs its owner's approval.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { validateDiagnosisSubmission } from "@/lib/diagnosis/validate";
import { incorrectDiagnosisFeedback, type EvaluationResult } from "@/server/diagnosis/evaluate";
import {
  deterministicDiagnosisEvaluator,
  type DiagnosisEvaluator,
} from "@/server/diagnosis/evaluator";
import type { DiagnosisChallenge, DiagnosisRegistry } from "@/server/diagnosis/registry";
import type { AttemptStatus, DiagnosisResponse, DiagnosisSubmission } from "@/types/diagnosis";
import type { WorkspaceScenario } from "@/types/workspace";
import { decodeCompletionCursor, encodeCompletionCursor, type CompletionCursor } from "@/server/learning-loop/cursors";
import { compareText, readPageRequest, takePage, type PageOptions } from "@/server/learning-loop/derive";
import { DEFAULT_ATTEMPT_WINDOW } from "./attempt-window";
import type { IssuedCookie } from "./cookie";
import { cookieMaxAgeSeconds } from "./expiry";
import { hashSubmission } from "./request-hash";
import {
  toAttemptStatus,
  toAttemptView,
  toSessionView,
  type AttemptView,
  type ChallengeSessionView,
} from "./snapshots";
import { hashSessionToken, issueSessionToken, parseSessionToken } from "./token";

/** How long a waiter polls a live claim. One second past the default lease, so an expired claim can be taken. */
const CLAIM_WAIT_MS = 31_000;
import {
  StoreError,
  type AttemptStore,
  type AttemptWindow,
  type ChallengeSessionRecord,
  type ChallengeSessionStore,
  type DiagnosisAttemptRecord,
  type LearnerActivity,
  type LearnerRecord,
  type LearnerStore,
  type SessionToken,
} from "./types";

/**
 * A challenge's own investigation hints for incorrect diagnoses, or undefined for the evaluator's generic ones. The same
 * shape the live diagnosis endpoint takes (`investigationHints` in its handler options), so one function serves both.
 */
export type InvestigationHints = (challengeId: string) => readonly string[] | undefined;

export interface LearnerSessionServiceDeps {
  learners: LearnerStore;
  sessions: ChallengeSessionStore;
  attempts: AttemptStore;
  /** The challenges that exist, with their validation context and answer key. Never serialized. */
  registry: DiagnosisRegistry;
  /** Share the store's clock in tests, so cookie lifetimes agree with expiry. Defaults to the real clock. */
  now?: () => number;
  /** Defaults to DEFAULT_ATTEMPT_WINDOW. */
  attemptWindow?: AttemptWindow;
  /**
   * The challenge's CURRENT content version, `<registry revision>+<public content hash>`: pass the
   * challenge registry's contentVersion. It is recorded when a session starts and compared on every
   * request to apply the version policy above. Required, so a session service can never be built
   * that silently gives every challenge the same version and so never notices a change.
   */
  challengeVersion: (challengeId: string) => string;
  /** Source of ids for submissions that arrive without one. */
  newSubmissionId?: () => string;
  /**
   * OPTIONAL. The challenge-specific investigation hints shown after an incorrect diagnosis: the same ones, selected the same
   * way, as the live diagnosis endpoint. Without it every incorrect diagnosis gets the evaluator's generic hints, which is
   * what a service built before hints existed did, so existing construction is unchanged.
   *
   * Hints are never stored. They are static, public-safe content, a function of the challenge and the submission only, so a
   * replay of an incorrect attempt recomputes them from the stored submission and gets exactly what the original response
   * had (for as long as the hint text itself is unchanged, which is a code change and so a deploy).
   */
  investigationHints?: InvestigationHints;
  /** Defaults to the deterministic evaluator. Same contract the live diagnosis handler uses. */
  evaluator?: DiagnosisEvaluator;
  /**
   * Wall-clock limit for one evaluation. When it fires, the claim is released and the error
   * propagates. A later retry may evaluate again. Unset means no service-level timeout.
   */
  evaluationTimeoutMs?: number;
  /**
   * Public scenario lookup for the optional reasoning path. Defaults to none (deterministic only).
   * Must not return answer-key modules. The live cookie route does not use this.
   */
  getPublicScenario?: (challengeId: string) => WorkspaceScenario | undefined;
}

/** Why a request was refused. None of these records anything or creates anything. */
export type RejectionCode =
  | "learner-missing"
  | "learner-expired"
  | "unknown-challenge"
  | "session-missing"
  | "session-outdated"
  | "submission-id-conflict"
  | "validation-failed"
  | "invalid-cursor";

export interface Rejection {
  readonly status: "rejected";
  readonly code: RejectionCode;
}

export type StartLearnerResult = { readonly created: boolean; readonly cookie: IssuedCookie };

/** Whether a new learner may be created now. Decided by a creation limit, which this module does not implement. */
export type CreationAdmission =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

/** A new learner was refused by the creation limit. Nothing was created. */
export type CreationRefused = { readonly status: "rate-limited"; readonly retryAfterSeconds: number };

export type LearnerStatusResult =
  | { readonly state: "none" }
  | { readonly state: "expired" }
  | { readonly state: "active"; readonly cookie?: IssuedCookie };

export type StartChallengeResult =
  | Rejection
  | {
      readonly status: "ok";
      /** A new session was created: the first one, or the replacement of an out-of-date one. */
      readonly created: boolean;
      /** The new session replaced an unfinished one from an earlier version of the challenge. Implies `created`. */
      readonly restarted: boolean;
      readonly session: ChallengeSessionView;
      readonly cookie: IssuedCookie;
    };

export type GetChallengeSessionResult =
  | Rejection
  | { readonly status: "ok"; readonly session: ChallengeSessionView | null; readonly cookie?: IssuedCookie };

export type SubmitDiagnosisResult =
  | Rejection
  | {
      readonly status: "ok";
      /** The existing diagnosis response contract. Never contains internal ids. */
      readonly response: DiagnosisResponse;
      /** True when this was a retry or a submission to an already completed session: nothing new was recorded. */
      readonly replayed: boolean;
      readonly cookie: IssuedCookie;
    };

export type ListAttemptsResult =
  | Rejection
  | { readonly status: "ok"; readonly attempts: readonly AttemptView[]; readonly cookie?: IssuedCookie };

/** One verified completion a learner may see. No session id, learner id, or diagnosis text. */
export interface LearnerCompletion {
  readonly challengeId: string;
  readonly completedAt: string;
  readonly contentVersion: string;
}

export type ListCompletionsResult =
  | Rejection
  | {
      readonly status: "ok";
      readonly completions: readonly LearnerCompletion[];
      readonly nextCursor: string | null;
      readonly cookie?: IssuedCookie;
    };

type Authenticated =
  | { readonly state: "active"; readonly learner: LearnerRecord; readonly token: SessionToken; readonly refreshed: boolean }
  | { readonly state: "missing" }
  | { readonly state: "expired" };

const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rejected = (code: RejectionCode): Rejection => ({ status: "rejected", code });

/** True when a completion sorts strictly after the cursor (completedAt DESC, session id ASC). */
function completionAfter(
  record: { completedAt: number; id: string },
  cursor: CompletionCursor,
): boolean {
  if (record.completedAt !== cursor.completedAt) return record.completedAt < cursor.completedAt;
  return compareText(record.id, cursor.sessionId) > 0;
}

export class LearnerSessionService {
  private readonly learners: LearnerStore;
  private readonly sessions: ChallengeSessionStore;
  private readonly attempts: AttemptStore;
  private readonly registry: DiagnosisRegistry;
  private readonly now: () => number;
  private readonly window: AttemptWindow;
  private readonly challengeVersion: (challengeId: string) => string;
  private readonly newSubmissionId: () => string;
  private readonly investigationHints: InvestigationHints | undefined;
  private readonly evaluator: DiagnosisEvaluator;
  private readonly evaluationTimeoutMs: number | undefined;
  private readonly getPublicScenario: ((challengeId: string) => WorkspaceScenario | undefined) | undefined;

  constructor(deps: LearnerSessionServiceDeps) {
    this.learners = deps.learners;
    this.sessions = deps.sessions;
    this.attempts = deps.attempts;
    this.registry = deps.registry;
    this.now = deps.now ?? Date.now;
    this.window = deps.attemptWindow ?? DEFAULT_ATTEMPT_WINDOW;
    this.challengeVersion = deps.challengeVersion;
    this.newSubmissionId = deps.newSubmissionId ?? randomUUID;
    this.investigationHints = deps.investigationHints;
    this.evaluator = deps.evaluator ?? deterministicDiagnosisEvaluator;
    this.evaluationTimeoutMs = deps.evaluationTimeoutMs;
    this.getPublicScenario = deps.getPublicScenario;
  }

  /* ------------------------------- Identity -------------------------------- */

  /**
   * Creates an anonymous learner, or resumes the one the cookie identifies. The
   * only method that creates a learner. An unknown or expired cookie gets a new,
   * empty identity: the old one is never revived.
   */
  async startLearner(cookieValue: unknown): Promise<StartLearnerResult> {
    return this.beginLearner(cookieValue);
  }

  /**
   * Like startLearner, but a NEW learner is created only if `admit` says so. `admit` is asked at most
   * once, and only when the cookie does not identify a live learner, so resuming an existing learner
   * is never subject to it (a creation limit must not lock out someone who already has an identity).
   * When it refuses, nothing is created and the refusal is returned for the caller to answer.
   */
  async startLearnerAdmitted(
    cookieValue: unknown,
    admit: () => Promise<CreationAdmission>,
  ): Promise<StartLearnerResult | CreationRefused> {
    return this.beginLearner(cookieValue, admit);
  }

  private beginLearner(cookieValue: unknown): Promise<StartLearnerResult>;
  private beginLearner(cookieValue: unknown, admit: () => Promise<CreationAdmission>): Promise<StartLearnerResult | CreationRefused>;
  private async beginLearner(
    cookieValue: unknown,
    admit?: () => Promise<CreationAdmission>,
  ): Promise<StartLearnerResult | CreationRefused> {
    const auth = await this.authenticate(cookieValue, "write");
    if (auth.state === "active") return { created: false, cookie: this.cookieFor(auth.token, auth.learner) };

    if (admit) {
      const admission = await admit();
      if (!admission.allowed) return { status: "rate-limited", retryAfterSeconds: admission.retryAfterSeconds };
    }
    const issued = issueSessionToken();
    const learner = await this.learners.create({ tokenHash: issued.tokenHash });
    return { created: true, cookie: this.cookieFor(issued.token, learner) };
  }

  /** Whether the cookie identifies a live learner. Read-only: never creates anything. */
  async checkLearner(cookieValue: unknown): Promise<LearnerStatusResult> {
    const auth = await this.authenticate(cookieValue, "read");
    if (auth.state === "missing") return { state: "none" };
    if (auth.state === "expired") return { state: "expired" };
    return auth.refreshed
      ? { state: "active", cookie: this.cookieFor(auth.token, auth.learner) }
      : { state: "active" };
  }

  /* --------------------------- Challenge sessions -------------------------- */

  /**
   * Starts the learner's session for a challenge, or resumes it. The learner must already exist.
   * The one place a stale session is replaced: an UNFINISHED session from an earlier version of
   * the challenge is restarted at the current version (see the version policy above). A completed
   * session is returned as it is.
   */
  async startChallenge(cookieValue: unknown, challengeId: string): Promise<StartChallengeResult> {
    if (!this.registry.has(challengeId)) return rejected("unknown-challenge");
    const auth = await this.authenticate(cookieValue, "write");
    if (auth.state !== "active") return rejected(auth.state === "expired" ? "learner-expired" : "learner-missing");

    const version = this.challengeVersion(challengeId);
    const owner = { learnerId: auth.learner.id, challengeId };
    let { session, created } = await this.sessions.start({ ...owner, challengeVersion: version });

    let restarted = false;
    if (!created && session.status === "active" && session.challengeVersion !== version) {
      // Compare-and-set on the stale session, so a concurrent request cannot make two replacements.
      const outcome = await this.sessions.restart({ ...owner, challengeVersion: version, supersedes: session.id });
      session = outcome.session;
      restarted = outcome.restarted;
      created = outcome.restarted;
    }
    return {
      status: "ok",
      created,
      restarted,
      session: await this.viewOf(auth.learner, session, version),
      cookie: this.cookieFor(auth.token, auth.learner),
    };
  }

  /** The learner's own session for a challenge, or null if they have not started it. Never creates one. */
  async getChallengeSession(cookieValue: unknown, challengeId: string): Promise<GetChallengeSessionResult> {
    if (!this.registry.has(challengeId)) return rejected("unknown-challenge");
    const auth = await this.authenticate(cookieValue, "read");
    if (auth.state !== "active") return rejected(auth.state === "expired" ? "learner-expired" : "learner-missing");

    const session = await this.sessions.find({ learnerId: auth.learner.id, challengeId });
    return {
      status: "ok",
      session: session ? await this.viewOf(auth.learner, session, this.challengeVersion(challengeId)) : null,
      ...this.refreshedCookie(auth),
    };
  }

  /* ------------------------------- Attempts -------------------------------- */

  /**
   * Judges and records one diagnosis in the learner's session.
   *
   * The submission is validated, then claimed. Only the claimant evaluates. A duplicate,
   * a conflict, a completed session and a full window return before any evaluation.
   * Finalizing the claim writes the attempt and, when the outcome is correct, the
   * completion, in one store step. The response is the existing DiagnosisResponse.
   *
   * Guarantee: one logical submission is evaluated at most once while its claim is
   * live. A crash, a timeout, or a lease expiry after the evaluator has already
   * responded can cause one later call. That is not exactly-once provider execution.
   *
   * `body` is untrusted and only its diagnosis fields are read: a `completed`
   * flag, a `status` or anything else a client adds has no effect. `submissionId`
   * is the idempotency key. Without one a retry counts as a new attempt.
   */
  async submitDiagnosis(
    cookieValue: unknown,
    challengeId: string,
    body: unknown,
    options: { submissionId?: string } = {},
  ): Promise<SubmitDiagnosisResult> {
    const challenge = this.registry.get(challengeId);
    if (!challenge) return rejected("unknown-challenge");
    const auth = await this.authenticate(cookieValue, "write");
    if (auth.state !== "active") return rejected(auth.state === "expired" ? "learner-expired" : "learner-missing");
    const session = await this.sessions.find({ learnerId: auth.learner.id, challengeId });
    if (!session) return rejected("session-missing");
    // An unfinished session from another version of the challenge records nothing: see the version policy.
    if (session.status === "active" && session.challengeVersion !== this.challengeVersion(challengeId)) {
      return rejected("session-outdated");
    }
    const cookie = this.cookieFor(auth.token, auth.learner);

    if (options.submissionId !== undefined && !SUBMISSION_ID.test(options.submissionId)) {
      return {
        status: "ok",
        replayed: false,
        cookie,
        response: { status: "invalid", errors: [{ field: "body", message: "submissionId must be a UUID." }] },
      };
    }
    const validation = validateDiagnosisSubmission(body, challenge.validation);
    if (!validation.ok) {
      return { status: "ok", replayed: false, cookie, response: { status: "invalid", errors: validation.errors } };
    }

    const submission = validation.value;
    const submissionId = options.submissionId ?? this.newSubmissionId();
    const request = {
      learnerId: auth.learner.id,
      sessionId: session.id,
      submissionId,
      requestHash: hashSubmission(submission),
      rootCauseId: submission.rootCauseId,
      explanation: submission.explanation,
      evidence: submission.evidence,
      window: this.window,
    };
    const hints = this.investigationHints?.(challengeId);

    // A stolen claim is retried as a fresh reserve. The lost evaluation is not repeated here.
    for (let stolen = 0; stolen < 3; stolen += 1) {
      let gate;
      try {
        gate = await this.reserveSettled(request);
      } catch (error) {
        if (error instanceof StoreError && error.code === "superseded") return rejected("session-outdated");
        throw error;
      }
      if (gate.kind === "duplicate" || gate.kind === "already-completed") {
        return {
          status: "ok",
          replayed: true,
          cookie,
          response: replayResponse(gate.attempt, gate.session, toAttemptStatus(gate.window), hints),
        };
      }
      if (gate.kind === "conflict") return rejected("submission-id-conflict");
      if (gate.kind === "rate-limited") {
        return {
          status: "ok",
          replayed: false,
          cookie,
          response: {
            status: "rate-limited",
            retryAfterSeconds: Math.ceil(gate.retryAfterMs / 1000),
            attempts: toAttemptStatus(gate.window),
          },
        };
      }

      let evaluation;
      try {
        evaluation = await this.evaluateClaim(challengeId, submission, challenge.answerKey, hints);
      } catch (error) {
        await this.attempts.releaseClaim({ sessionId: session.id, claimToken: gate.claim.token });
        throw error;
      }
      let finalized;
      try {
        finalized = await this.attempts.finalize({
          ...request,
          claimToken: gate.claim.token,
          outcome: evaluation.status,
          ...(evaluation.status === "correct"
            ? { result: { resolutionSummary: evaluation.resolution.summary, feedback: evaluation.feedback } }
            : {}),
        });
      } catch (error) {
        if (error instanceof StoreError && error.code === "superseded") {
          await this.attempts.releaseClaim({ sessionId: session.id, claimToken: gate.claim.token });
          return rejected("session-outdated");
        }
        // The finalize transaction rolled back, so the claim is still ours. Drop it. A retry may evaluate again.
        await this.attempts.releaseClaim({ sessionId: session.id, claimToken: gate.claim.token });
        throw error;
      }
      if (finalized.kind === "claim-lost") continue;
      if (finalized.kind === "recorded") {
        return { status: "ok", replayed: false, cookie, response: respond(evaluation, toAttemptStatus(finalized.window)) };
      }
      if (finalized.kind === "duplicate" || finalized.kind === "already-completed") {
        return {
          status: "ok",
          replayed: true,
          cookie,
          response: replayResponse(finalized.attempt, finalized.session, toAttemptStatus(finalized.window), hints),
        };
      }
      if (finalized.kind === "conflict") return rejected("submission-id-conflict");
      return {
        status: "ok",
        replayed: false,
        cookie,
        response: {
          status: "rate-limited",
          retryAfterSeconds: Math.ceil(finalized.retryAfterMs / 1000),
          attempts: toAttemptStatus(finalized.window),
        },
      };
    }
    throw new Error("The submission claim was lost and could not be settled.");
  }

  /** Reserves, waiting out a live claim for the same content instead of evaluating beside it. */
  private async reserveSettled(
    request: Parameters<AttemptStore["reserve"]>[0],
  ): Promise<Exclude<Awaited<ReturnType<AttemptStore["reserve"]>>, { kind: "in-progress" }>> {
    const deadline = Date.now() + CLAIM_WAIT_MS;
    for (;;) {
      const gate = await this.attempts.reserve(request);
      if (gate.kind !== "in-progress") return gate;
      if (Date.now() >= deadline) {
        const last = await this.attempts.reserve(request);
        if (last.kind !== "in-progress") return last;
        throw new Error("The submission claim did not settle.");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private async evaluateClaim(
    challengeId: string,
    submission: DiagnosisSubmission,
    answerKey: DiagnosisChallenge["answerKey"],
    investigationHints: readonly string[] | undefined,
  ): Promise<EvaluationResult> {
    const scenario = this.getPublicScenario?.(challengeId);
    const run = this.evaluator.evaluate({
      submission,
      answerKey,
      investigationHints,
      ...(scenario === undefined ? {} : { scenario }),
    });
    const limit = this.evaluationTimeoutMs;
    if (limit === undefined) return run;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("evaluation timed out")), limit);
    });
    try {
      return await Promise.race([run, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** The learner's own attempts at a challenge, oldest first. */
  async listAttempts(cookieValue: unknown, challengeId: string): Promise<ListAttemptsResult> {
    if (!this.registry.has(challengeId)) return rejected("unknown-challenge");
    const auth = await this.authenticate(cookieValue, "read");
    if (auth.state !== "active") return rejected(auth.state === "expired" ? "learner-expired" : "learner-missing");
    const session = await this.sessions.find({ learnerId: auth.learner.id, challengeId });
    if (!session) return rejected("session-missing");

    const attempts = await this.attempts.list({ learnerId: auth.learner.id, sessionId: session.id });
    return { status: "ok", attempts: attempts.map(toAttemptView), ...this.refreshedCookie(auth) };
  }

  /**
   * The learner's current verified completions, completedAt DESC then session id ASC.
   * Identity is the cookie. `options` may set a page size and an opaque cursor; it cannot name a learner.
   * Incorrect attempts and superseded sessions are not completions. The stored content version is returned as-is.
   */
  async listCompletions(cookieValue: unknown, options: PageOptions = {}): Promise<ListCompletionsResult> {
    const request = readPageRequest(options, decodeCompletionCursor);
    if ("refused" in request) return rejected(request.refused);
    const auth = await this.authenticate(cookieValue, "read");
    if (auth.state !== "active") return rejected(auth.state === "expired" ? "learner-expired" : "learner-missing");

    const ownerId = auth.learner.id;
    const verified = (await this.sessions.listCurrentCompleted(ownerId)).filter(
      (record): record is ChallengeSessionRecord & { completedAt: number } =>
        record.learnerId === ownerId &&
        record.status === "completed" &&
        record.supersededAt === undefined &&
        typeof record.completedAt === "number",
    );
    const after = request.after;
    const pending = after ? verified.filter((record) => completionAfter(record, after)) : verified;
    const { page, last } = takePage(pending.slice(0, request.limit + 1), request.limit);
    return {
      status: "ok",
      completions: page.map((record) => ({
        challengeId: record.challengeId,
        completedAt: new Date(record.completedAt).toISOString(),
        contentVersion: record.challengeVersion,
      })),
      nextCursor: last ? encodeCompletionCursor({ completedAt: last.completedAt, sessionId: last.id }) : null,
      ...this.refreshedCookie(auth),
    };
  }

  /* -------------------------------- Helpers -------------------------------- */

  /** Parses and hashes the cookie, then records activity. The raw token never goes further than this. */
  private async authenticate(cookieValue: unknown, activity: LearnerActivity): Promise<Authenticated> {
    const token = parseSessionToken(cookieValue);
    if (!token) return { state: "missing" };
    const touch = await this.learners.touch(hashSessionToken(token), activity);
    if (touch.state === "none") return { state: "missing" };
    if (touch.state === "expired") return { state: "expired" };
    return { state: "active", learner: touch.learner, token, refreshed: touch.refreshed };
  }

  private cookieFor(token: SessionToken, learner: LearnerRecord): IssuedCookie {
    return { value: token, maxAgeSeconds: cookieMaxAgeSeconds(learner, this.now()) };
  }

  /** A read only sets the cookie again when it actually refreshed the idle expiry. */
  private refreshedCookie(auth: Extract<Authenticated, { state: "active" }>): { cookie?: IssuedCookie } {
    return auth.refreshed ? { cookie: this.cookieFor(auth.token, auth.learner) } : {};
  }

  /** The learner's view of a session. `currentVersion` decides `restartRequired`; a completed session also loads its winning attempt. */
  private async viewOf(learner: LearnerRecord, session: ChallengeSessionRecord, currentVersion: string): Promise<ChallengeSessionView> {
    const owner = { learnerId: learner.id, sessionId: session.id };
    const window = await this.attempts.windowStatus(owner, this.window);
    const correctAttempt =
      session.status === "completed" ? (await this.attempts.list(owner)).find((attempt) => attempt.outcome === "correct") : undefined;
    return toSessionView(session, window, {
      restartRequired: session.status === "active" && session.challengeVersion !== currentVersion,
      correctAttempt,
    });
  }
}

/**
 * Builds the service from its dependencies. Everything it needs is passed in: the
 * three store ports, the challenge registry (and so the evaluator and answer key),
 * the clock and the attempt window. Nothing is read from a global, so a test or a
 * future route builds exactly the service it wants, on any store.
 */
export function createLearnerSessionService(deps: LearnerSessionServiceDeps): LearnerSessionService {
  return new LearnerSessionService(deps);
}

/**
 * The response for a stored attempt. It does not evaluate.
 *
 *  - a stored CORRECT attempt is answered from the result stored when its session completed;
 *  - a stored INCORRECT attempt stays incorrect. Its feedback is rebuilt from the stored submission
 *    and the current public hints, which do not include the answer key. A later key change cannot
 *    flip the verdict, and the deployed hint text still follows the challenge content.
 */
function replayResponse(
  attempt: DiagnosisAttemptRecord,
  session: ChallengeSessionRecord,
  attempts: AttemptStatus,
  investigationHints?: readonly string[],
): DiagnosisResponse {
  if (attempt.outcome === "correct") {
    if (!session.result) throw new Error("A completed session has no stored result.");
    const { feedback } = session.result;
    return {
      status: "correct",
      feedback: { headline: feedback.headline, hints: [...feedback.hints], evidenceSummary: { ...feedback.evidenceSummary } },
      resolution: { summary: session.result.resolutionSummary },
      attempts,
    };
  }
  return {
    status: "incorrect",
    feedback: incorrectDiagnosisFeedback(submissionOf(attempt), investigationHints),
    attempts,
  };
}

function submissionOf(attempt: DiagnosisAttemptRecord): DiagnosisSubmission {
  return { rootCauseId: attempt.rootCauseId, explanation: attempt.explanation, evidence: [...attempt.evidence] };
}

/** The existing response shapes: the evaluation, plus the attempt window the endpoint reports today. */
function respond(evaluation: EvaluationResult, attempts: AttemptStatus): DiagnosisResponse {
  return evaluation.status === "correct"
    ? { status: "correct", feedback: evaluation.feedback, resolution: evaluation.resolution, attempts }
    : { status: "incorrect", feedback: evaluation.feedback, attempts };
}
