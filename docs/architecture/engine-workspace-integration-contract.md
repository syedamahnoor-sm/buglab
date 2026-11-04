# Engine–Workspace Integration Contract

**Challenge 001: Broken User Sessions**
Branch: `feature/engine-workspace-integration` · Written 2026-11-01 against the merge commit `1572bf3`, whose parents are our branch at `f4829e4` and Syeda's `48fad4a`. The response guard and the engine and workspace integration are committed in the two commits that follow that merge; this document is the third.

This document records how the Challenge Engine's session core connects to the existing investigation workspace and diagnosis API. It is written for the two owners of this boundary (the engine, and the workspace and diagnosis API) and for anyone reviewing the branch before it merges.

**How to read the status labels.** Every behaviour in this document carries one of three labels.

| Label | Meaning |
|---|---|
| **Implemented** | Present in the code as committed immediately before this document, and covered by the verification in section 9. |
| **Proposed** | Designed, not built. Needs a decision or approval first. |
| **Deferred** | Deliberately out of scope for this integration. |

**Provenance of the agreements.** The agreements in section 1.3 were relayed by the engine owner as the outcome of Syeda Mahnoor's review. They were not recorded in the repository before this document, so this file is now the written record. Everything under "Exact interfaces" is copied from the source files, not paraphrased.

---

## 1. Architectural overview and ownership

### 1.1 Layers

```
 Browser                                                        Server
┌──────────────────────────────────────────────────────┐   ┌─────────────────────────┐
│ page.tsx (server component)                          │   │ POST /api/challenges/   │
│  └ ChallengeSessionProvider  (engine, client)        │   │      :id/diagnosis      │
│      ├ SessionChallengeOverview ─ ChallengeOverview  │   │  validation             │
│      └ WorkspaceClient (workspace)                   │   │  evaluation (answer key)│
│          └ DiagnosisPanel                            │   │  attempt + rate limits  │
│              └ useDiagnosisSubmission ───────────────┼──▶│  returns DiagnosisResp. │
│                   │  onResponse(response)            │◀──┼─                        │
│                   ▼                                  │   └─────────────────────────┘
│         applyDiagnosisResponse  (engine, pure)       │
└──────────────────────────────────────────────────────┘
```

### 1.2 Ownership boundaries

| Concern | Owner | Notes |
|---|---|---|
| Diagnosis correctness, evidence validation, answer key | **Server / diagnosis API** | The answer key is `server-only`. It never enters client code or client-facing types. |
| Attempt limits and rate limiting | **Server / diagnosis API** | 3 wrong attempts per 10 minutes per cookie and challenge. The engine never counts or enforces attempts. |
| Request and response shapes | **Server / diagnosis API** | `src/types/diagnosis.ts` is unchanged by this integration. |
| Investigation UI, Monaco workspace, diagnosis form, feedback, retry and rate-limit display | **Workspace** | Unchanged in behaviour. The workspace does not validate diagnoses for the engine. |
| Static challenge metadata and public scenario data | **Shared types** (`src/types/workspace.ts`) | Reused by the engine. The engine defines no challenge types of its own. |
| The learner's session and completion state | **Engine** | Owned in memory by `ChallengeSessionProvider`. |
| The `DiagnosisResponse` → engine event mapping | **Engine** | A pure adapter that reads only `status`, and only of a structurally complete response (section 2.4). |
| Learner status (`InvestigationStatus`) | **Engine derives; workspace displays** | `ChallengeOverview` receives it as a plain prop and imports no engine code. |

### 1.3 Agreed decisions

The following were agreed in review with Syeda.

1. Reuse the existing shared challenge types.
2. `DIAGNOSIS_ACCEPTED` is used only for a server-confirmed correct diagnosis.
3. Learner status is derived from the engine session and workspace signals.
4. An optional `onResponse` callback is added, without changing the diagnosis API.
5. Invalid, rate-limited and error responses must not trigger engine transitions.
6. Answer keys stay server-only.
7. Scoring, persistence and Fix Mode are deferred.

Clarifications from Syeda:

- `submitted` means an actual incorrect diagnosis attempt.
- Validation errors, rate limits and network failures must not change learner status.
- `resolved` takes precedence after a successful diagnosis.

**Not part of the agreement above:** the sticky "investigation started" signal and its change to the investigation controller. That approval is outstanding (section 8).

### 1.4 Invariants

1. The engine performs no answer validation and keeps no wrong-attempt counter.
2. Only a server response with `status: "correct"` can produce `DIAGNOSIS_ACCEPTED`.
3. A `DiagnosisResponse` reaches the engine unchanged, and the engine never modifies it.
4. Static challenge metadata never holds learner progress.

---

## 2. Exact interfaces currently in use

Copied from the repository. File paths are given for each block.

### 2.1 Diagnosis API contract (unchanged) · `src/types/diagnosis.ts`

```ts
export interface DiagnosisSubmission {
  rootCauseId: string;
  explanation: string;
  evidence: EvidenceRef[];
}

export interface AttemptStatus {
  used: number;
  limit: number;
  remaining: number;
  /** ISO time the current attempt window ends, if one is active. */
  resetsAt?: string;
}

export interface DiagnosisFeedback {
  headline: string;
  hints: string[];
  evidenceSummary: { total: number; logs: number; network: number };
}

export type DiagnosisResponse =
  | {
      status: "correct";
      feedback: DiagnosisFeedback;
      resolution: { summary: string };
      attempts: AttemptStatus;
    }
  | { status: "incorrect"; feedback: DiagnosisFeedback; attempts: AttemptStatus }
  | { status: "invalid"; errors: DiagnosisFieldError[] }
  | { status: "rate-limited"; retryAfterSeconds: number; attempts?: AttemptStatus }
  | { status: "error"; message: string };

export type DiagnosisResponseStatus = DiagnosisResponse["status"];
```

### 2.2 Shared challenge types · `src/types/workspace.ts`

```ts
/**
 * How a challenge is completed. "diagnosis": an accepted diagnosis solves it.
 * "fix": reserved for Fix Mode, which no challenge, runner or UI implements yet.
 */
export type CompletionMode = "diagnosis" | "fix";

/**
 * A learner's progress through one challenge. Learner state, not challenge
 * metadata: it is derived at runtime and never stored on a ChallengeSummary.
 */
export type InvestigationStatus =
  | "not-started"
  | "in-progress"
  | "submitted"
  | "resolved";

/** Static, learner-independent challenge metadata. */
export interface ChallengeSummary {
  id: string;
  number: string;
  title: string;
  incident: string;
  difficulty: Difficulty;
  completion: CompletionMode;
  tags: string[];
  estimatedMinutes: number;
}

/** Everything the workspace needs to render one challenge. */
export interface WorkspaceScenario {
  /** Shape version of this contract; bump it when the shape changes. */
  contractVersion: 1;
  challenge: ChallengeSummary;
  files: ScenarioFile[];
  /** UTC date (YYYY-MM-DD) that log and network timestamps belong to. */
  incidentDate: string;
  logs: LogEntry[];
  network: NetworkRequest[];
  rootCauseOptions: RootCauseOption[];
  entryFilePath: string;
}
```

### 2.3 Engine session types · `src/engine/types.ts`

```ts
// Challenge data (metadata, files, root-cause options) lives in @/types/workspace.
// A session needs only the challenge's identity and how it is completed.
export type SessionConfig = { challengeId: string } & (
  | { completion: "diagnosis" }
  // Fix Mode is reserved: no challenge, runner or UI uses it yet.
  | {
      completion: "fix";
      editableFiles: Readonly<Record<string, string>>;
      hintLimit?: number;
    }
);

export type SessionStatus = "in_progress" | "solved" | "revealed";

export interface SessionState {
  version: 1;
  challengeId: string;
  completion: CompletionMode;
  // Current contents of the editable files only (empty in diagnosis mode).
  files: Readonly<Record<string, string>>;
  hintLimit: number;
  hintsUsed: number;
  // True once the server has accepted a diagnosis. The engine never counts
  // wrong attempts: the diagnosis API owns attempts and rate limits.
  diagnosed: boolean;
  runs: number;
  lastRun: RunReport | null;
  editedSinceRun: boolean;
  passedVisible: boolean;
  passedAll: boolean;
  status: SessionStatus;
}

export type SessionEvent =
  // The server confirmed a correct diagnosis. The only diagnosis event: other
  // outcomes (incorrect, invalid, rate-limited, error) leave the session as is.
  | { type: "DIAGNOSIS_ACCEPTED" }
  | { type: "FILE_EDITED"; path: string; contents: string }
  | { type: "RUN_COMPLETED"; report: RunReport }
  | { type: "HINT_REVEALED" }
  | { type: "REVEALED" };
```

`ScoringRules`, `RunReport`, `TestResult`, `Score` and related types also live in this file. They are exercised only by tests today (section 8).

### 2.4 Adapter · `src/engine/adapters/diagnosis.ts`

```ts
export function diagnosisResponseToEvent(
  response: DiagnosisResponse,
): SessionEvent | null {
  if (!isDiagnosisResponse(response)) return null;

  switch (response.status) {
    case "correct":
      return { type: "DIAGNOSIS_ACCEPTED" };
    case "incorrect":
    case "invalid":
    case "rate-limited":
    case "error":
      return null;
    default: {
      // A status added to DiagnosisResponse fails to compile here. At runtime
      // an unknown status fails closed: it never completes the session.
      const unreachable: never = response;
      void unreachable;
      return null;
    }
  }
}

export function isRejectedDiagnosis(response: DiagnosisResponse): boolean {
  if (!isDiagnosisResponse(response)) return false;

  switch (response.status) {
    case "incorrect":
      return true;
    case "correct":
    case "invalid":
    case "rate-limited":
    case "error":
      return false;
    default: {
      const unreachable: never = response;
      void unreachable;
      return false;
    }
  }
}
```

The static type is not a runtime guarantee, so both functions first check the value with `isDiagnosisResponse` and treat anything that is not a complete response as no response at all. This is a second layer: the client applies the same guard before a body ever becomes a `DiagnosisResponse` (below).

### 2.4a Response guard · `src/lib/diagnosis/response.ts`

```ts
export function isDiagnosisResponse(value: unknown): value is DiagnosisResponse;
```

Structure only. Correctness is the server's call. A value passes only if it is a non-array object with a known `status` and every field that status requires, with the right types:

| Status | Required |
|---|---|
| `correct` | `feedback`, `resolution.summary` (string), `attempts` |
| `incorrect` | `feedback`, `attempts` |
| `invalid` | `errors`: an array where each item has a string `message` and a `field` that is one of `rootCauseId`, `explanation`, `evidence`, `body` |
| `rate-limited` | `retryAfterSeconds` (finite number); `attempts` optional |
| `error` | `message` (string) |

Shared shapes: `feedback` is `{ headline: string, hints: string[], evidenceSummary: { total, logs, network: finite numbers } }`. `attempts` is `{ used, limit, remaining: finite numbers }` with `resetsAt` optional but, if present, a string. Optional means *absent*: `null` is rejected. Numbers must be finite. `status` is looked up with `Object.hasOwn`, so names like `"constructor"` or `"__proto__"` are unknown statuses. Extra properties are tolerated, so the server can add fields without breaking clients. The per-status table is typed `Record<DiagnosisResponseStatus, …>`, so a new status fails to compile until its shape is described.

### 2.5 Session reducer and config · `src/engine/session/reducer.ts`, `config.ts`

```ts
export function createSession(config: SessionConfig): SessionState;
export function sessionReducer(state: SessionState, event: SessionEvent): SessionState;

export function sessionConfigForChallenge(challenge: ChallengeSummary): SessionConfig;
// "diagnosis" → { challengeId, completion: "diagnosis" }
// "fix"       → throws `Challenge <id>: Fix Mode is not implemented`
```

The reducer's `DIAGNOSIS_ACCEPTED` branch:

```ts
if (state.status !== "in_progress") return state;

if (event.type === "DIAGNOSIS_ACCEPTED") {
  if (state.diagnosed) return state;
  // Only a diagnosis-mode session is completed by the diagnosis alone. In
  // Fix Mode the diagnosis is one part of the work, so it never solves.
  return state.completion === "diagnosis"
    ? { ...state, diagnosed: true, status: "solved" }
    : { ...state, diagnosed: true };
}

// A diagnosis-mode session has nothing to edit, run, hint or reveal.
if (state.completion === "diagnosis") return state;
```

### 2.6 Progress and status · `src/engine/session/progress.ts`, `status.ts`

```ts
export interface LearnerProgress {
  session: SessionState;
  /**
   * True once the server has rejected a diagnosis (`incorrect`). Latched: nothing
   * clears it, so revising the diagnosis form never erases it.
   */
  diagnosisSubmitted: boolean;
}

export function createProgress(config: SessionConfig): LearnerProgress;
export function applyDiagnosisResponse(
  progress: LearnerProgress,
  response: DiagnosisResponse,
): LearnerProgress;
export function progressStatus(
  progress: LearnerProgress,
  investigationStarted: boolean,
): InvestigationStatus;
```

```ts
export interface WorkspaceSignals {
  /** The learner has begun investigating. No reliable source for this exists yet. */
  investigationStarted: boolean;
  /** The server rejected a diagnosis (`isRejectedDiagnosis`: an `incorrect` response). */
  diagnosisSubmitted: boolean;
}

export function deriveInvestigationStatus(
  session: Pick<SessionState, "status" | "diagnosed">,
  signals: WorkspaceSignals,
): InvestigationStatus;
```

### 2.7 Provider and hook · `src/engine/client/`

```ts
export interface ChallengeSessionValue {
  session: SessionState;
  /** The learner's status, derived from the session and workspace signals. */
  status: InvestigationStatus;
  /** Reports a server diagnosis response, unchanged. Stable across renders. */
  recordDiagnosisResponse: (response: DiagnosisResponse) => void;
}

export function useChallengeSession(): ChallengeSessionValue; // throws outside the provider

interface ChallengeSessionProviderProps {
  config: SessionConfig;
  /**
   * Whether the learner has begun investigating. There is no approved source for
   * this yet, so the caller supplies it; the provider does not guess.
   */
  investigationStarted: boolean;
  children: ReactNode;
}
```

### 2.8 Workspace-side change · `useDiagnosisSubmission.ts`

```ts
export function useDiagnosisSubmission(
  challengeId: string,
  onResponse?: (response: DiagnosisResponse) => void,
);
```

`SubmissionState` is unchanged. `ChallengeOverview` takes `status: InvestigationStatus` as a separate prop from `challenge: ChallengeSummary`.

---

## 3. `DiagnosisResponse` → engine event mapping

**Implemented.** One table drives both the adapter and the status latch.

| Response `status` | HTTP | Engine event | Session changes? | `diagnosisSubmitted` latch |
|---|---|---|---|---|
| `correct` | 200 | `DIAGNOSIS_ACCEPTED` | Diagnosis mode: `diagnosed` and `solved`. Fix Mode: `diagnosed` only. | unchanged |
| `incorrect` | 200 | none | No | **latches true** |
| `invalid` | 400 | none | No | unchanged |
| `rate-limited` | 429 | none | No | unchanged |
| `error` (server failure, bad content type, wrong origin, oversize body, unknown challenge) | 403 / 404 / 413 / 415 / 500 | none | No | unchanged |
| `error` synthesized by the client (network failure, timeout, unparseable body) | n/a | none | No | unchanged |
| Request aborted (the panel unmounted) | n/a | `onResponse` is not called | No | unchanged |

Properties of the mapping:

- A repeat of the same accepted event returns the identical state object, so it is idempotent.
- A blocked correct answer is indistinguishable from a blocked wrong answer: the server returns `rate-limited` for both. The engine therefore cannot be completed by a correct answer that the server did not evaluate.
- An unknown future `status` fails closed at runtime, and fails to compile if a new status is added to the union.
- A response that is not structurally complete (for example a bare `{ status: "correct" }`) never reaches the engine as a response. The client turns it into a synthesized `error`, and the adapter independently treats it as no event and not a rejection, so it can neither complete the session nor latch `submitted`.

---

## 4. Learner status derivation and precedence

**Implemented.** `deriveInvestigationStatus` checks in this order, and the first match wins.

| Precedence | Condition | Status |
|---|---|---|
| 1 | `session.status === "solved"` and `session.diagnosed` | `resolved` |
| 2 | `signals.diagnosisSubmitted` | `submitted` |
| 3 | `signals.investigationStarted` | `in-progress` |
| 4 | otherwise | `not-started` |

Meanings, as clarified in review:

- **`resolved`:** a server-confirmed correct diagnosis has solved a diagnosis-mode session. It takes precedence over everything, so a learner who submitted incorrectly and then correctly is `resolved`.
- **`submitted`:** at least one `incorrect` response was received. Validation errors, rate limits and network failures do not count.
- **`in-progress`:** the investigation has begun and no diagnosis has been rejected or accepted.
- **`not-started`:** no investigation activity yet. **Currently unreachable in the running app** (section 7).

Fix Mode: a session needs both `solved` and `diagnosed` to be `resolved`. An accepted diagnosis alone leaves a Fix Mode session `in_progress`, so its status never becomes `resolved` from the diagnosis alone. This rule is provisional (section 8).

---

## 5. Session lifecycle and provider responsibilities

### 5.1 Lifecycle (Implemented)

1. **Create.** `page.tsx` calls `sessionConfigForChallenge(scenario.challenge)` and mounts `ChallengeSessionProvider` with the result. The provider's `useReducer` initialises `createProgress(config)` once, on mount.
2. **Run.** The provider holds one `LearnerProgress` in memory. The only input is `recordDiagnosisResponse`, which is the reducer's `dispatch`, so its identity is stable across renders.
3. **Derive.** On each change the provider memoises `{ session, status, recordDiagnosisResponse }` and exposes it through context. `status` comes from `progressStatus(progress, investigationStarted)`.
4. **Consume.** `SessionChallengeOverview` reads `status` and passes it to `ChallengeOverview`. `DiagnosisPanel` reads `recordDiagnosisResponse` and passes it to `useDiagnosisSubmission`.
5. **End.** Nothing ends a session explicitly. A solved session freezes: the reducer ignores every later event.
6. **Reset.** A page refresh creates a new session. There is no persistence (section 8).

### 5.2 What the provider does and does not do

| The provider does | The provider does not |
|---|---|
| Own the single in-memory `LearnerProgress` | Validate or evaluate any diagnosis |
| Expose the session, the derived status and the response recorder | Count attempts or apply rate limits |
| Pass `investigationStarted` through to the status derivation | Guess whether the learner has started investigating |
| Stay a thin wrapper: transitions are pure functions in `progress.ts` | Persist anything, or call the network |

### 5.3 Why `diagnosisSubmitted` lives beside the session

An `incorrect` response must not change the engine session, yet it must change the learner's status. The session therefore holds completion state only, and `LearnerProgress` carries the one extra latched fact. The latch lives in the provider, above `DiagnosisPanel`, so the panel's own Revise/reset (which only returns its submission state to `idle`) cannot clear it.

---

## 6. Data flow: diagnosis submission to session completion

**Implemented.**

1. The learner submits the form. `DiagnosisPanel` validates it client-side for input errors only, then calls `submit(validation.value)`.
2. `useDiagnosisSubmission.submit` calls `submitDiagnosis(challengeId, submission, signal)` in `src/lib/diagnosis/client.ts`.
3. The client `POST`s to `/api/challenges/:challengeId/diagnosis`. The server validates, applies the cookie-keyed attempt limits, evaluates against the server-only answer key, and returns a `DiagnosisResponse`.
4. The client returns that parsed body unchanged, but only if it passes `isDiagnosisResponse` (a complete response, not just a known `status`). If the network fails, the request times out or the body is not a complete response, it returns a synthesized `{ status: "error" }` instead. It never throws, except when aborted.
5. `submit` stores the response in its own state (so the existing feedback, retry and attempt-limit UI is unchanged), then calls `onResponse?.(response)` with the same object.
6. `onResponse` is `recordDiagnosisResponse`, which dispatches `applyDiagnosisResponse(progress, response)`.
7. `applyDiagnosisResponse` asks the adapter for an event. Only `correct` yields `DIAGNOSIS_ACCEPTED`, which `sessionReducer` applies. Separately, an `incorrect` response latches `diagnosisSubmitted`. Any other response returns the same progress object, so nothing re-renders.
8. The provider re-derives `status`. `SessionChallengeOverview` re-renders with the new badge.

The UI never dispatches `DIAGNOSIS_ACCEPTED` from form state or a guess. Searching `src/` finds it created in exactly one place, the adapter's `correct` branch.

---

## 7. Temporary value: `investigationStarted`

**This is the only temporary value in the integration.**

- **Where:** `src/app/page.tsx` passes `investigationStarted` (that is, `true`) to `ChallengeSessionProvider`, under a comment beginning `TEMPORARY:`.
- **Effect today:** the badge reads "Investigating" on load, exactly as it did when `status: "in-progress"` was hard-coded in the challenge data. `not-started` cannot occur.
- **Why it remains temporary:** no approved source for the signal exists. The page opens straight into the workspace, and evidence, hypotheses and observations live inside `WorkspaceClient` below the provider, where the overview cannot read them.
- **Why it was not replaced:** the proposed signal (below) changes `useInvestigationController`, which is Syeda's file, and her approval is not documented. No substitute signal was invented.

**Proposed (not implemented), pending Syeda's approval:**

- A one-way `started` flag in the investigation controller's state, set by the first *successful* `add-evidence`, `add-hypothesis` or `add-observation` and never cleared. Blank notes and duplicate evidence are already no-ops, so they do not count.
- Opening the challenge, switching tabs and reading logs do **not** count unless the contract changes.
- The flag has to be latched because each of the three has a matching remove action. Deriving it from list length would flip back to "not started".
- The provider would then need a small way for the workspace to report the flag upward. This is a provider API change to settle when the signal is approved.
- A fresh page would then read "Not started" instead of today's "Investigating". That visible change needs a product decision.

---

## 8. Remaining gaps and deferred decisions

| # | Item | Status | Detail |
|---|---|---|---|
| 1 | Sticky `investigationStarted` signal | **Proposed** | Needs Syeda's approval (section 7). |
| 2 | Persistence | **Deferred** | A refresh resets the session and badge. A solved learner can resubmit after reloading, because the server does not know the learner is "solved". `SessionState.version` stays `1` because state is never persisted. |
| 3 | Fix Mode and the code runner | **Deferred** | `"fix"` exists as a type and a reducer path, covered by tests, but no challenge, runner or UI uses it. `sessionConfigForChallenge` throws for it. |
| 4 | Scoring | **Deferred** | `computeScore(state, rules, wrongAttempts = 0)` exists and is tested, but no UI calls it. The source of `wrongAttempts` for Fix Mode is undecided. The server's `attempts.used` is a rolling-window count, not a lifetime count, and must not be used as one. |
| 5 | Fix Mode `resolved` | **Provisional** | Requires both `solved` and `diagnosed`. |
| 6 | `revealed` session status | **Deferred** | Unreachable in diagnosis mode, and not mapped to a learner status. |
| 7 | Evidence-coverage threshold | **Not planned for Challenge 001** | A correct root cause with no key observations is still `correct`, and a server test pins that. |
| 8 | Response guard hardening | **Implemented** | The guard used to check only the `status` string, so a malformed `{ status: "correct" }` body would have completed the session. It now validates the complete shape (section 2.4a), in the client and again in the adapter. |
| 9 | React-level test of the hook and provider | **Open** | No component test runner is installed. See section 9. |

---

## 9. Testing and verification

All results are from the code committed immediately before this document: the merge `1572bf3` plus the guard and integration commits. They were first obtained on identical working-tree content, before those commits were made. The guard commit (290 tests) and the integration commit (351 tests) were each also checked on their own in an isolated copy, and both pass `tsc` and lint. A Turbopack build cannot run through the junction used for those isolated copies, so their builds used webpack; the full tree was built with Turbopack in the real working tree.

### 9.1 Command results

| Command | Result |
|---|---|
| `npm test` | **351 passed**, 0 failed (334 from this integration, 17 from Syeda's `tests/ui/`) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |

### 9.2 Test inventory (Node's built-in runner)

| File | Tests | Covers |
|---|---|---|
| `tests/engine/reducer.test.ts` | 23 | Session creation in both modes, `DIAGNOSIS_ACCEPTED` in both modes, idempotence, frozen terminal states, purity |
| `tests/engine/scoring.test.ts` | 11 | Score arithmetic, explicit `wrongAttempts`, penalty floor |
| `tests/engine/diagnosis-adapter.test.ts` | 17 | All five statuses, an unknown status failing closed, malformed `correct` and `incorrect` responses, `isRejectedDiagnosis`, no mutation of the response |
| `tests/engine/investigation-status.test.ts` | 9 | Status precedence and Fix Mode edge cases |
| `tests/engine/progress.test.ts` | 14 | The progress transitions, the latch, and malformed responses leaving progress untouched |
| `tests/engine/session-config.test.ts` | 3 | Challenge 001 session creation, Fix Mode refused |
| `tests/engine/diagnosis-flow.test.ts` | 11 | Real client, real server handler and real limiters, ending in the engine transition; malformed server bodies; valid bodies unchanged |
| `tests/diagnosis/response.test.ts` | 187 | The response guard: complete responses, the server's real responses, and every required field missing, null or mistyped, per status |
| `tests/diagnosis/*` (the other 6 files) | 59 | The existing diagnosis API suite, unchanged |

Engine total: 88. Diagnosis total: 246 (187 guard + 59 existing). Syeda's `tests/ui/`: 17, arrived with her workspace commit `48fad4a`, which supersedes her original `211da9b` and is identical to it apart from a session log. Sum: 351.

### 9.3 Mandatory audits

| Audit | Result | Evidence |
|---|---|---|
| `onResponse` receives the exact original `DiagnosisResponse` | **Confirmed by inspection.** The same object `submitDiagnosis` returned is passed to both `setState` and `onResponse`, with no transformation. | `useDiagnosisSubmission.ts` lines 32–50. A test confirms the engine does not mutate it (`diagnosis-flow.test.ts`). The hook itself has no React-level test. |
| Only a *complete* `correct` response triggers `DIAGNOSIS_ACCEPTED` | **Confirmed.** | The event is created in one place only (`adapters/diagnosis.ts`, `correct` branch), behind `isDiagnosisResponse`. Adapter tests cover all five statuses and malformed `correct` responses. Mutations that let another status, or a bare `{ status: "correct" }`, through fail the tests. |
| Incorrect submissions stay sticky after Revise | **Confirmed.** | By construction, since `reset()` only sets the hook's own state to `idle`. Unit tests show no later response clears the latch, and a mutation that clears it fails 3 tests. The browser check shows the badge still reads "Diagnosis submitted" after clicking "Revise diagnosis". |
| Invalid, rate-limited and error responses do not alter progress | **Confirmed.** | `applyDiagnosisResponse` returns the same object for each. Tested in `progress.test.ts` and end to end in `diagnosis-flow.test.ts`, including a real 4th-attempt rate limit. |
| The temporary `investigationStarted` value | **Identified** in section 7. | `src/app/page.tsx`, marked `TEMPORARY:`. |

### 9.4 Behaviour checked in a real browser

A scripted check was run against the production build, with a real server and a real browser. The script lived outside the repository and is not committed, so it is not part of the test suite. 12 of 12 checks passed:

- A network failure leaves the badge at "Investigating", and the workspace error shows.
- An incorrect answer gives "Diagnosis submitted", with the server's attempt count shown.
- After Revise the badge is still "Diagnosis submitted".
- The 4th attempt is rate-limited by the server, and the badge is unchanged.
- A correct answer gives "Resolved", and the form locks.
- Incorrect followed by correct gives "Resolved".
- A refresh returns to "Investigating", confirming there is no persistence.

The only console errors were the deliberately aborted request and the server's 429 response.

After the response-guard hardening the same flow was re-run on a fresh production build (12 of 12 again), and a second script intercepted the API and returned malformed bodies (`{ "status": "correct" }`, a `correct` with null fields, an unknown status, and `null`). In all four cases the workspace showed its "unexpected response" error, the badge stayed "Investigating", and the form did not lock.

**After reconciliation with Syeda's `48fad4a`.** All three scripts were run again on a fresh production build of the reconciled working tree. That tree held her workspace changes as first reconciled from her original `211da9b`, whose content is identical to `48fad4a` outside a session log, with our changes on top:

| Check | Result |
|---|---|
| Original flow (offline, incorrect → Revise → still `submitted`, 4th attempt rate-limited, correct → `resolved`, incorrect then correct, refresh resets) | **12 of 12** |
| Malformed responses (the same four bodies as above) | **4 of 4** |
| Workspace interactions (skip links, expand/restore of the Diagnosis and console panels, the badge and server feedback surviving those layout changes, `resolved` after a layout round-trip, focus after removing evidence) | **12 of 12**, with no console errors |
| Client-bundle leakage scan (answer-key text, the correct root-cause id, the `answer-key` module name) | **zero hits** |

In the original-flow run the only console errors were the deliberately aborted request and the server's 429, as before. All of these scripts live outside the repository and are not committed.

### 9.5 Mutation checks

Eighteen deliberate breaks were applied across the rounds of work and then reverted, and each made the tests fail:

- Letting a wrong response produce an event.
- Letting Fix Mode solve on a diagnosis.
- Removing idempotence.
- Letting a diagnosis-mode session accept other events.
- Making status ignore the `diagnosed` flag when resolving.
- Counting `correct` as rejected.
- Ignoring the `wrongAttempts` penalty.
- Removing the zero floor on diagnosis points.
- Clearing the latch.
- Bypassing the adapter.
- Not latching `incorrect`.
- Accepting a Fix Mode config.
- Reducing the response guard to a status-only check (the old behaviour).
- Removing the guard from the adapter (the client guard still in place).
- Having the client stop using the guard (the adapter guard still in place).
- Dropping a required field (`attempts` on `correct`) from the guard.
- Accepting `null` for the optional `resetsAt`.
- Removing the guard from `isRejectedDiagnosis`.

### 9.6 Unchanged by this integration

Checked with Git against two baselines: `f4829e4`, our branch before the merge, which does not contain Syeda's work, and her `48fad4a`, which the merge `1572bf3` brought in (section 11, step 3). `48fad4a` supersedes her original `211da9b`, and the two trees are identical outside a session log, so the checks hold for either. Against `f4829e4`, anything that came from her commit shows up as a difference. Against `48fad4a`, only this integration's own changes do.

| Path | Against `f4829e4` (before the merge) | Against Syeda's `48fad4a` |
|---|---|---|
| `src/server/`, `src/app/api/`, `src/types/diagnosis.ts` | unchanged | unchanged |
| `answer-key.server.ts` and the scenario files other than `challenge.ts` and `index.ts` | unchanged | unchanged |
| `src/data/challenge-001/challenge.ts` and `index.ts` | two edits: `completion: "diagnosis"` and `contractVersion: 1` | the same two edits |
| The 6 existing test files in `tests/diagnosis/`, and `fixtures.ts` | unchanged | unchanged |
| `package.json` and the lockfile | unchanged | unchanged |
| `useInvestigationController.ts` | unchanged | unchanged |
| `src/lib/` | 6 files differ: `diagnosis/client.ts` (edited) and `diagnosis/response.ts` (new), which are ours, plus `file-tree.ts`, `monaco-setup.ts`, `focus.ts` and `scroll.ts`, which are hers | only `diagnosis/client.ts` and `diagnosis/response.ts`, as described in section 10.3 |
| Workspace UI (for example `WorkspaceClient.tsx`) | differs, because of her commit | unchanged, except the edits to her files listed in section 10.4 |

A scan of the production client bundle found neither the answer-key text nor the correct root-cause id.

---

## 10. Files changed

All of the following were made on top of `f4829e4` and are committed in the two commits that follow the merge `1572bf3`. The first contains only the response guard: `response.ts`, its use in `client.ts`, and `response.test.ts`. The second contains everything else listed in sections 10.1 to 10.3, including the adapter's use of the guard and the engine-side malformed-response tests, which depend on engine code that does not exist before it. Syeda's `48fad4a`, brought in by the merge (section 11, step 3), is her work and is not listed below. The engine foundation (`b7588e5`, ported to Node's test runner in `e9dfcf3` and `f4829e4`) was already committed.

### 10.1 Stage 1: shared contract and engine contract

**Syeda-owned files (additive or behaviour-neutral):**

| File | Change |
|---|---|
| `src/types/workspace.ts` | Adds `CompletionMode` and `contractVersion: 1`. `ChallengeSummary` gains `completion` and loses `status`. |
| `src/data/challenge-001/challenge.ts` | `status: "in-progress"` becomes `completion: "diagnosis"`. |
| `src/data/challenge-001/index.ts` | Adds `contractVersion: 1`. |
| `src/components/challenge/ChallengeOverview.tsx` | Takes `status` as a separate prop. |

**Engine files:**

| File | Change |
|---|---|
| `src/engine/types.ts` | Removes the duplicate challenge types and `wrongDiagnoses`. Adds `SessionConfig`, `completion` and `DIAGNOSIS_ACCEPTED`. |
| `src/engine/session/reducer.ts` | `createSession(config)`, with an idempotent accepted event and a diagnosis-mode guard. |
| `src/engine/session/scoring.ts` | The penalty uses an explicit `wrongAttempts = 0` input instead of a session counter. |
| `src/engine/adapters/diagnosis.ts` (new) | `diagnosisResponseToEvent` and `isRejectedDiagnosis`. |
| `src/engine/session/status.ts` (new) | `deriveInvestigationStatus` and `WorkspaceSignals`. |

**Tests:** `tests/engine/fixtures.ts`, `reducer.test.ts` and `scoring.test.ts` migrated. `diagnosis-adapter.test.ts` and `investigation-status.test.ts` added.

### 10.2 Stage 2: provider integration

**Engine files (new):** `src/engine/session/config.ts`, `src/engine/session/progress.ts`, `src/engine/client/ChallengeSessionProvider.tsx`, `src/engine/client/useChallengeSession.ts`.

**UI (new):** `src/components/challenge/SessionChallengeOverview.tsx`, a client connector.

**Syeda-owned files edited:**

| File | Change |
|---|---|
| `src/components/workspace/diagnosis/useDiagnosisSubmission.ts` | Optional second parameter `onResponse`, called with the original response after `setState`. The submit flow is reordered slightly so a throwing callback is not swallowed by the abort handler. The doc comment is updated. |
| `src/components/workspace/DiagnosisPanel.tsx` | Passes `recordDiagnosisResponse` from the context to the hook, plus one import. |
| `src/app/page.tsx` | Mounts the provider, uses `SessionChallengeOverview`, and carries the `TEMPORARY:` value. |

**Tests (new):** `progress.test.ts`, `session-config.test.ts`, `diagnosis-flow.test.ts`. `investigation-status.test.ts` was trimmed, and its response-path block moved into `progress.test.ts`.

### 10.3 Response-guard hardening

**New:** `src/lib/diagnosis/response.ts`, holding `isDiagnosisResponse`.

**Syeda-owned file edited:** `src/lib/diagnosis/client.ts`. Its local status-only `isDiagnosisResponse` and `KNOWN_STATUSES` are removed in favour of the import. `submitDiagnosis` is otherwise unchanged.

**Engine file edited:** `src/engine/adapters/diagnosis.ts` gains the guard in both functions and updated comments.

**Tests:** new `tests/diagnosis/response.test.ts`. Edited `tests/engine/diagnosis-adapter.test.ts`, `progress.test.ts` and `diagnosis-flow.test.ts`. One earlier adapter test asserted that a bare `{ status: "correct" }` produced `DIAGNOSIS_ACCEPTED`. It was replaced because it pinned the behaviour this change removes.

### 10.4 Total

Syeda-owned files touched: **8** (`workspace.ts`, `challenge.ts`, `index.ts`, `ChallengeOverview.tsx`, `useDiagnosisSubmission.ts`, `DiagnosisPanel.tsx`, `page.tsx`, `client.ts`). `useInvestigationController.ts`, `WorkspaceClient.tsx`, the diagnosis server code, the API route and `src/types/diagnosis.ts` are untouched.

---

## 11. Proposed next steps before merging

1. **Done: Syeda has reviewed and approved the integration contract.** This is as relayed by the engine owner; it is not otherwise recorded in the repository. The contract includes the eight Syeda-owned file edits listed in section 10.4.
2. **Done: the temporary `investigationStarted: true` is agreed.** Syeda agreed to keep it for this integration (section 7), so `not-started` stays unreachable for now. The sticky flag in the investigation controller has not been approved and is deferred. If it is wanted later it needs her explicit approval, plus a provider API and tests that the flag stays true after removals.
3. **Done: Syeda's clean commit is merged.** This branch was based on her earlier commit `b1eb3af`. Her original `211da9b` ("polish workspace layout, accessibility and long-text handling") also edited her own session log. `48fad4a` is the same workspace changes without that log edit, published for this integration according to its commit message. The two trees are identical outside that log. `48fad4a` was merged as the two-parent commit `1572bf3`, whose parents are `f4829e4` and `48fad4a`.
   - Only `page.tsx` and `DiagnosisPanel.tsx` had been changed on both sides. The merge had no conflicts, and her skip links and expand/restore toggle sit beside our provider and response callback.
   - Her panel collapse is CSS-only (`xl:hidden`), so it never unmounts `DiagnosisPanel`. Submission state and in-flight requests survive an expand or collapse.
   - `.claude-logs` was excluded from the merge: it changes no log path relative to its first parent, and the session-log content from `211da9b` is absent from the merged tree.
   - `211da9b` remains on `origin/feature/debugging-workspace` as the superseded original. Confirm with Syeda that this branch is retired, so that nobody merges both.
4. **Three commits follow the merge:** the response guard (`fix(diagnosis)`), the engine and workspace integration (`feat(engine)`), and this document (`docs(architecture)`). **Unresolved: the `.claude-logs` policy conflict.** `CLAUDE.md` requires `.claude-logs/` to be committed with the changes, while the engine owner has instructed that the hook-managed log must never be staged. The log is therefore left modified and uncommitted, and this has to be resolved before the PR.
5. **Decide how to test the React layer.** The hook and provider currently have only inspection, `tsc`, lint, build and the uncommitted browser script. Options:
   - Add a component test dependency, which is a deliberate dependency decision.
   - Commit the browser script as an end-to-end check.
   - Keep it as a manual release step.
6. **Open the PR** only after step 5 (steps 1 to 4 are settled, except for the open `.claude-logs` policy noted in step 4), on the engine owner's approval.
7. **After merge, in order:** persistence, Fix Mode with a runner, then scoring with a decided `wrongAttempts` source.
