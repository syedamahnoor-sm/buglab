# Learner session and attempt foundation

| | |
|---|---|
| **Status** | **Implemented**, server side only, **not wired into any endpoint or page**. Wiring it needs Syeda's approval (section 11). |
| **Branch** | `feature/learner-session-foundation`, built on `feature/server-attested-session-foundation` (PR #2) |
| **Code** | `src/server/session/*`, and the challenge loader and registry in `src/server/challenges/*` (section 8) |
| **Tests** | `tests/session/*`, `tests/challenges/*` |
| **Storage** | In-memory development and test adapter only. **Data is lost on every process restart. This is not durable persistence.** |

This document says what exists. Anything labelled **Deferred** is not built, and nothing here is a commitment to build it.

## 1. What this is

A storage-independent backend foundation for three things, one inside the next:

| Concept | What it is | Identified by | Lives as long as |
|---|---|---|---|
| **Learner** | One anonymous identity for the whole product, across every challenge | A random 256-bit token in the `buglab_learner` cookie. The server stores only its SHA-256 hash. | Idle expiry (sliding) and absolute expiry (fixed), from `expiry.ts` |
| **Challenge session** | One learner's run at one challenge. At most one per learner and challenge. | No token. It is reached only through its learner. | Its learner |
| **Diagnosis attempt** | One evaluated submission inside a challenge session | A per-session sequence number and an idempotency key | Its session |

It reshapes the session foundation from PR #2. There the token was bound to a single challenge; here the token identifies the learner, and challenge sessions are child records. `token.ts` and `expiry.ts` are reused unchanged (one comment aside), so there is one identity lifecycle, not two.

### What was agreed with Syeda, and where it stands

Syeda reviewed the architecture and agreed to the points below. This table says which are implemented here, which are waiting, and where each is described.

| Agreed | State | Where |
|---|---|---|
| One anonymous learner identity (`buglab_learner`) across challenges, with independent challenge sessions and attempt history | Implemented | 2, 3, 4 |
| The session API lifecycle: create or resume the learner, start or resume a challenge session, read it, list attempts | Implemented as handler factories. **Not mounted.** | 7 |
| The existing diagnosis request and response contract is preserved | Implemented: the service answers in the existing `DiagnosisResponse` shapes | 4 |
| Duplicate submissions are handled safely | Implemented: `submissionId` is an idempotency key | 4 |
| The registry revision and public content hash are stored with each challenge session | Implemented | 3.1, 8.4, 8.6 |
| A completed result survives a change to the challenge, and an unfinished session from an older version is restarted | Implemented | 3.1, 3.2 |
| Strict path normalization, ISO 8601 UTC timestamps, conservative limits grounded in Challenge 001, multi-language support retained | Implemented in the loader and **approved**: the timestamp reading, the 31 limits, the NFC, look-alike, collision and file-versus-folder path rules, literal percent signs, the optional many-to-one request and log link, and the decisions on the deferred rules (section 8.7). **Two points still need Syeda's confirmation:** how percent-escapes are protected, because the editor decodes them, and padded or trailing-dot segments (section 8.7) | 8.3, 8.7 |
| Origin validation hardening of the diagnosis endpoint | Done on Syeda's own branch. **Not duplicated or touched here.** | 11 |
| Recording attempts and completion through the session service from the diagnosis endpoint | **Not done.** It needs changes to her handler and route. The exact proposal is written. | 11 |

## 2. Learner identity lifecycle (implemented)

- **Create or resume** (`LearnerSessionService.startLearner`). With a valid cookie the learner is resumed and its idle expiry refreshed. With no cookie, a malformed one, an unknown one or an expired one, a **new, empty** learner is created. This is the only method that creates a learner.
- **Check** (`checkLearner`). Read-only: reports `none`, `expired` or `active`. It never creates anything and refreshes the idle expiry at most once per touch interval.
- **Validation is server-side.** The cookie value is parsed (`parseSessionToken`: exact length, alphabet and canonical encoding), hashed, and looked up by hash. No method accepts a learner id, a session id or a completion flag from a caller.
- **Expiry.** A learner past its idle or absolute limit is `expired` for a grace period, then `none`. An expired learner is never revived: starting again makes a new learner, and the old progress is not inherited. A hash can never be reused to replace an identity.
- **Cookie** (`cookie.ts`): `buglab_learner=<token>; Path=/api; Max-Age=<remaining lifetime>; HttpOnly; SameSite=Strict`, plus `Secure` when the request came over HTTPS (as the diagnosis endpoint does for its own cookie). `Max-Age` never outlives the learner's own expiry.
- Internal learner ids and token hashes never appear in a response.

## 3. Challenge session lifecycle (implemented)

- **Start or resume** (`startChallenge`): requires an existing, unexpired learner. The first call creates the session (`created: true`). Later calls return the same one unchanged, **unless the challenge has changed since an unfinished session started**, in which case that session is replaced (section 3.1). The content version is recorded when the session starts, and the service must be given the version source (section 8.6).
- **Get** (`getChallengeSession`): read-only. Returns the learner's own session, or `null` if they have not started it. It never creates or restarts one. A session whose challenge has changed says so with `restartRequired: true`.
- **Ownership.** A session is looked up by *learner id and challenge id*, where the learner id comes from the verified cookie. Different learners never share a session. Every store method that takes a session id also checks that it belongs to the learner, and rejects with `not-owner` otherwise.
- **One learner, many challenges.** A learner's sessions for different challenges are independent. Completing one changes nothing in another, and a change to one challenge's version affects only that challenge's session.
- **Views** (`snapshots.ts`) are built field by field: challenge id, content version, status, start time, `restartRequired`, attempt totals and the attempt window, and, for a **completed** session only, the completion time and `completion` (section 3.2). No internal id, token, hash or answer-key structure.

### 3.1 Challenge versions: what happens when the content changes (implemented)

A session records the challenge's content version when it starts: `<registry revision>+<public content hash>` (section 8.4), taken from the challenge registry. Both halves are stored, in one string that can always be split at the `+`. The service compares versions by **exact equality** and never takes one apart. The policy is in the header of `service.ts` and is tested end to end, with real registries, in `tests/session/version-policy.test.ts`.

| What changed | Its version | A **completed** session | An **unfinished** session |
|---|---|---|---|
| Nothing | Same | Unchanged | Resumed, with its attempts and its window |
| The public content (anything a learner sees) | The hash changes | **Preserved** | Out of date: restart |
| The answer key only (revision bumped by hand, public content identical) | The revision changes, the hash does not | **Preserved** | Out of date: restart |
| Both | Both change | **Preserved** | Out of date: restart |

**Why an unfinished session restarts even when only the answer key changed.** The learner sees the same task, but the verdicts they were given were judged by a different key. A corrected key can turn a wrong attempt into a right one, and a learner should not be held to, or limited by, verdicts the key no longer supports. The test suite shows this: an answer judged wrong under the old key is judged right after the restart.

**What "preserved" means for a completed session.** Its status, completion time, stored result and winning submission do not change. `startChallenge` returns it as it is and never restarts it. Its `contentVersion` stays the version it was completed at. A replay of any submission answers from the result stored when it completed, never from the current answer key, so a corrected key cannot change what a learner was told they earned. (A learner who has completed a challenge cannot start the newer version of it. Whether to allow that is a product decision: deferred, section 9.)

**How a restart works.**

- **Only `startChallenge` restarts**, because it is the one explicit write. A read (`getChallengeSession`, `listAttempts`) never restarts anything however often it is made.
- An unfinished session whose version differs is **never repaired or migrated**. It is replaced by a fresh session at the current version, with zero attempts and its own empty attempt window. The old session and its attempts are **kept as history**, marked superseded: it is never returned by `find`, and it accepts no further attempts.
- Until the learner restarts, the stale session **records nothing**. `submitDiagnosis` answers `session-outdated` before it validates or evaluates anything (the handler mapping is HTTP 409), whatever the body says, so an answer that happens to be right for the new content cannot complete a session that belongs to the old one. The answer carries no hint of what changed.
- The replacement is a **compare-and-set** on the stale session's id (`ChallengeSessionStore.restart`). Eight racing requests that all noticed the same stale session produce exactly one new session: one request reports `restarted: true` and the rest see the new session with `restarted: false`. A submission that loses a race with a restart is also answered `session-outdated`, and nothing is recorded.
- The restart response carries `created: true` and `restarted: true`, so a client knows its earlier progress on the server is gone.
- **What a restart does not touch:** anything held in the browser (collected evidence, notes, hypotheses). That is not server state. A client should clear it when it sees `restarted: true` (section 11).

### 3.2 Restoring a completed challenge after a refresh (implemented)

A completed session's view carries `completion`, so the workspace can show the finished challenge again from the server's record alone. Every field comes from what the server stored when it evaluated the winning attempt. A client can neither supply nor alter any of it, and an unfinished session carries none of it. Tests send forged `completed`, `completion`, `completedAt`, `status`, `result` and `contentVersion` fields with both right and wrong answers, and none has any effect.

| Field | Meaning |
|---|---|
| `status` | `completed`, decided by the server from a correct attempt it evaluated |
| `completedAt` | When the server recorded that attempt (ISO 8601 UTC, from the store's clock) |
| `contentVersion` | The version it was completed at, kept for good |
| `restartRequired` | Always `false` for a completed session |
| `completion.resolution.summary` | The resolution text the learner was shown |
| `completion.feedback` | The feedback shown with it (headline, hints, evidence summary), exactly as given |
| `completion.submission.attempt` | Which attempt solved it (the first is 1) |
| `completion.submission.rootCauseId`, `.explanation` | The diagnosis that solved it, as the server validated and stored it (the explanation is the normalised text) |
| `completion.submission.evidence` | The evidence references the learner submitted, in order: `{ kind: "log", logId }` or `{ kind: "network", requestId }` |

The resolution text and the feedback are **stored with the session when it completes** (`CompletionResult` on the session record) and are not recomputed from the answer key when a view is built. That is what keeps a completed result stable after the key is corrected. The text was already given to this learner by the diagnosis response at that moment, so storing it releases nothing new, and it is returned only to the owning learner of a completed session. The attempt history (`listAttempts`) never carries it, and no response carries the key observations, the correct-answer field or any internal id or hash.

**What the client still has to do** (the UI is Syeda's): turn this into workspace state. The evidence a learner collected while working is held in the browser, so only the references they submitted with the winning diagnosis come back from the server. Section 11 lists the proposed client changes.

## 4. Attempt recording flow (implemented)

`submitDiagnosis(cookie, challengeId, body, { submissionId? })`:

1. Resolve the challenge in the injected registry, and the learner from the cookie (a write, which refreshes the idle expiry). The learner's session must already exist (`session-missing` otherwise: a submission never starts one). An **unfinished session from another version of the challenge is refused with `session-outdated`**, before anything is validated or recorded (section 3.1).
2. Validate the submission with the existing `validateDiagnosisSubmission`. Anything invalid is answered as `invalid` and **not recorded**.
3. Judge it with the existing `evaluateDiagnosis` and the challenge's answer key.
4. Record the attempt, its outcome and its idempotency key in **one atomic step** (`AttemptStore.record`), which checks in this order:
   1. **Same submission id already used in this session**: the same content is a `duplicate` (the stored attempt comes back, nothing new is recorded); different content is a `conflict`.
   2. **Session already completed**: nothing more is recorded; the stored correct attempt comes back, and the response is the result stored when the session completed (section 3.2).
   3. **Attempt window full**: `rate-limited`. By default three incorrect attempts inside a sliding ten minutes (`attempt-window.ts`). Blocked whatever the outcome would have been, as today's endpoint does.
   4. Otherwise the attempt is appended with the next sequence number. A correct outcome completes the session in the same step.
5. Answer in the **existing `DiagnosisResponse` contract** (`correct | incorrect | invalid | rate-limited`). A test compares the service's responses with the existing diagnosis endpoint's for the same submissions, field for field, and they match (apart from the clock-dependent `resetsAt`).

A retry (same `submissionId`, same content) therefore never counts twice. **Without a `submissionId`, the server assigns a random one and a retry cannot be recognized.**

**A replay never judges again.** A stored correct attempt is answered from the result stored on its session. A stored incorrect attempt is judged again, but against a key that nothing can match, so even if the answer key has changed since, it can only be answered as incorrect, with the same generic feedback it had. Tests change the key after completion, so that an answer that was wrong becomes the right one, and replay it.

History (`listAttempts`) returns the learner's own attempts in order: sequence, time, the root cause they chose, result and evidence count.

## 5. Who decides completion (implemented)

The backend, and only the backend.

- A session becomes `completed` only inside `AttemptStore.record`, from the outcome that `submitDiagnosis` computed with the server's evaluator. The store has no method that sets completion directly, and a test asserts the adapter exposes none.
- A request body is untrusted. Extra fields such as `completed`, `status` or `result`, and forged `correct` response bodies, have no effect. Tests cover each.
- Once completed, a session records nothing further and cannot be completed twice.
- When it completes, the store also keeps what the learner was shown (the resolution summary and the feedback), in the same atomic step. A correct attempt without it is refused as invalid input, and an incorrect attempt may not carry one. Once stored it is never overwritten (section 3.2).

## 6. Storage interfaces and the current adapter

Three ports, in `types.ts`, all asynchronous and storage-independent:

| Port | Operations |
|---|---|
| `LearnerStore` | `create`, `findByTokenHash`, `touch`, `purgeExpired` |
| `ChallengeSessionStore` | `start`, `find`, `restart` |
| `AttemptStore` | `record`, `list`, `windowStatus` |

`LearnerSessionService` (built with `createLearnerSessionService`, which takes every dependency as an argument) depends only on these interfaces and on the diagnosis registry. A durable store must satisfy the same three contract suites (`tests/session/store-contract.ts`, `challenge-session-contract.ts`, `attempt-contract.ts`) unchanged. They cover `restart` (compare-and-set, history kept, completed sessions never restarted, racing restarts) and the stored completion result (required for a correct attempt, refused otherwise, copied, never overwritten).

The only adapter is `MemoryStore` (`memory-store.ts`): one class implementing all three ports, so that recording an attempt and completing the session are one step, and so that purging a learner also deletes its sessions and attempts.

> **It is not durable.** State lives in one process's memory. It is lost on restart and is not shared across processes, instances or serverless invocations. It exists to build and test the flow. A durable adapter is **deferred** and its technology is **undecided**.

## 7. Handler factories (implemented, not mounted)

`handlers.ts` exports plain `Request`-to-`Response` factories: `createLearnerHandlers` (`POST` create or resume, `GET` status), `createChallengeSessionHandlers` (`GET`, `POST` start) and `createAttemptHistoryHandler` (`GET`). **There are no route files: this phase adds no public API**, and a guard test asserts nothing under `src/app` imports the module.

Every state-changing request needs a JSON content type, proof it came from this site, and not a prefetch. The proof is an `Origin` header that parses to the **same origin as the request's own URL (same scheme, host and port)**, or, with no `Origin`, `Sec-Fetch-Site: same-origin`. A malformed `Origin` and the opaque `null` origin are refused. The `Host` header is not consulted, so a client cannot vouch for its own `Origin`. Comparing hosts alone, as an earlier version did, would have accepted `http://example.com` for `https://example.com`. The request body is read up to a 1 KiB cap and no further, even when no length is declared. Responses are `no-store`, `Vary: Cookie`, grant no CORS access, and carry only allow-listed fields.

### How routes and the diagnosis endpoint would integrate (proposed, **not implemented**)

Nothing below exists. It shows the intended seam so the next step is small.

```ts
// Illustrative only. These files and the process-wide service do not exist.
// app/api/learner/route.ts
export const { GET, POST } = createLearnerHandlers({ service });
// app/api/challenges/[challengeId]/session/route.ts
export const { GET, POST } = createChallengeSessionHandlers({ service });
// app/api/challenges/[challengeId]/attempts/route.ts
export const { GET } = createAttemptHistoryHandler({ service });
```

- `service` would be built once per process with `createLearnerSessionService({ learners, sessions, attempts, registry, challengeVersion })`. **`challengeVersion` is required** (a service cannot be built without it, and a test proves that at compile time), so it can never silently give every challenge the same version. With the in-memory adapter that one instance must be shared by every route, which is only safe in a single long-lived process. This is a reason to wait for a durable store before mounting anything.
- The diagnosis endpoint (Syeda's) would stop using its own limiter and cookie and call `service.submitDiagnosis(...)`. **The exact proposed change, the status mapping and the client changes are in section 11.** This needs her approval and is not made here.

Responses the handlers add for versions and completion: a session `GET` carries `restartRequired` and, once completed, `completion` (section 3.2); a `POST` carries `created` and `restarted` (section 3.1); and a `session-outdated` rejection maps to HTTP 409 with a plain message. The 409 can only arise from `submitDiagnosis`, which no handler here exposes yet.

### Storage failures

The service does not catch storage errors. A failing store makes the call reject, and the handlers turn that into a plain `500 internal` with no detail and no cookie. The order of operations makes this safe: a diagnosis is judged first but **answered only after the store has recorded it**, so an answer, `correct` included, is never sent for an attempt that was not stored. A failed write leaves the session as it was and the learner can submit again. A learner is not handed a cookie, and a session is not reported as started, unless the store created them.

## 8. Challenge loader and registry (implemented, not mounted)

A storage-independent backend module that adapts the existing Challenge 001 implementation into one validated, read-only registry. **Code:** `src/server/challenges/*`. **Tests:** `tests/challenges/*`. Like the rest of this phase it adds no public API: no route or page imports it, and a guard test asserts nothing outside `src/server` can.

### 8.1 The pieces

| File | Role |
|---|---|
| `definition.ts` | `ChallengeDefinition` (public scenario + private evaluation + revision), the id and revision formats, `ChallengeDefinitionError` |
| `validate.ts` | Startup validation: snapshots every definition once, then checks the snapshot in three passes (section 8.3) |
| `structure.ts` | The shape pass: lists are lists, ids are strings, evidence references are valid |
| `fields.ts` | The field pass: primitive types, blank strings, closed sets and numeric ranges of fields the existing types define, and the calls to the three modules below (section 8.3, and section 8.7 for what is deferred) |
| `paths.ts` | The strict file-path policy and the collisions between paths |
| `timestamps.ts` | The UTC time-of-day rule. There are no rules between a request's time and its log line (section 8.7). |
| `limits.ts` | The size and count limits, grounded in Challenge 001 (`LIMITS`) |
| `plain-data.ts` | What counts as plain data, and the snapshot (a deep copy) that the checks, the registry and the public view are made from |
| `text.ts` | Safe text for error messages: one line, bounded, control characters escaped, never throws |
| `public-view.ts` | Builds the learner-visible view, field by field, then deep-copies it |
| `version.ts` | The content version (section 8.4) |
| `read-only.ts` | `ReadOnlyMap` and `ReadOnlySet`, the read-only views the registry hands out |
| `registry.ts` | `createChallengeRegistry(definitions)` |
| `loader.ts` | `ChallengeSource` and `loadChallengeRegistry(sources)`: all-or-nothing, errors name their source |
| `challenge-001.ts`, `default-registry.ts` | The adapter that wraps the existing Challenge 001 modules (nothing is copied); `defaultChallengeSources`, the one list of what the default registry loads; and `createDefaultChallengeRegistry()` |

```ts
interface ChallengeRegistry {
  list(): readonly ChallengeSummary[];                       // public summaries
  getPublic(id): WorkspaceScenario | undefined;              // learner-visible content only
  getDiagnosis(id): DiagnosisChallenge | undefined;          // the existing type: validation context + answer key
  contentVersion(id): string | undefined;                    // "<revision>+<fingerprint>"
  readonly diagnosisRegistry: DiagnosisRegistry;             // ReadonlyMap<string, DiagnosisChallenge>
}
```

`diagnosisRegistry` is what the diagnosis handler and the learner-session service already accept, so both work with it unchanged. The tests drive the existing handler and validator with it and compare the results with `createDefaultRegistry()`; the learner-session service is driven through a full flow with it, and that flow is checked on its own terms, not compared with another registry. **The diagnosis route still builds its own registry with `createDefaultRegistry()` and `page.tsx` still imports Challenge 001 directly.** Moving them onto this registry touches Syeda's files and needs her approval (section 9).

### 8.2 Public and private data

- A definition keeps two halves apart: `scenario`, which is the existing `WorkspaceScenario` unchanged, and `evaluation`, which holds the correct root cause, the resolution text and the key observations.
- **The public view is an allow-list.** `toPublicChallenge` copies every field by name and never spreads a definition, so a field added to a definition, however secret, stays out until someone adds it on purpose. The result is then deep-copied (`clonePlainData`) and the copy is frozen: it shares no object with the authored data, and freezing it never freezes anything the author owns. A test injects secret-looking fields at every level and none reach it, and another checks that no object in the view is an object of the source. Everything the view is built from is a snapshot of plain data taken once during validation (section 8.3), so a getter, a proxy, a class instance or any other non-plain value is refused at startup with a `ChallengeDefinitionError`, and nothing can show one value to the validator and another to the registry.
- **The private half is reachable only through `getDiagnosis()` and `diagnosisRegistry`**, both server-only. Every file in the module starts with `import "server-only"`, and guard tests check that, that nothing outside `src/server` imports the module, and that the public view does not know the evaluation exists. A scan of the production build for the answer-key text found none, but **no route or page imports this module yet, so that scan can only show that nothing leaks today.** It becomes a real check once the registry is mounted, and it only runs when a build exists.
- **The registry cannot be changed once built.** The registry object is frozen, so no method can be replaced. `diagnosisRegistry` is a `ReadOnlyMap`, and every Set in the answer key and the validation context is a `ReadOnlySet`, because `Object.freeze()` does not stop `Map.prototype.set` or `Set.prototype.add`. These views keep a private copy of their data in a `#private` field and have no mutating method, and `Map.prototype.set.call(view, ...)` fails too. The `DiagnosisChallenge`, its answer key and each key observation are frozen. The registry is built from the snapshot taken during validation, never from the original definition, so editing a definition afterwards cannot reach it. They implement `ReadonlyMap` and `ReadonlySet`, so existing consumers need no change. Because the data is in a private field, three things behave differently from a real `Map` or `Set`, and are known limits (also stated in `read-only.ts` and pinned by tests): `util.inspect` and `console.log` do show the contents (through a custom inspector that returns a string); `assert.deepStrictEqual` **cannot tell two views apart**, so two views with different contents compare equal, and tests should compare `[...view]`; and `structuredClone(view)` returns an empty object and `JSON.stringify(view)` is `"{}"` without any error, so convert first (`new Map(view)`, `[...view]`). No existing consumer does any of these. **This guards against a bug or a careless tool flipping grading for every learner. It is not a sandbox:** code running in the server process can already read the answer key.

### 8.3 Validation at startup

Building a registry validates every definition and throws one `ChallengeDefinitionError` listing **every** problem, each prefixed with the challenge id (or `definition #N` if it has no usable id) and, through the loader, the source. No registry is returned if there is any. Messages are for the server log and are never sent to a client. A message never contains the correct root cause or the resolution text (it says the correct root cause is not a public option, not which one it was). **It does name key-observation ids** when one is at fault, because an author needs that to fix it, and those ids describe what the answer is about. Every authored value a message repeats is quoted through `text.ts`: on one line, cut to 60 characters, with control characters (newlines, escape codes, the Unicode line separators) escaped, so a value cannot forge a log line or flood a log. The number of problems reported is bounded too: 20 per definition and 100 in all.

**Snapshot first.** Each definition (scenario, evaluation and revision) is copied once into a snapshot of plain data (`clonePlainData`), and every later step, the three passes below and the registry itself, uses only that snapshot. The original is never read a second time. The copy refuses, without calling or asking them anything: getters and setters (the property descriptor is inspected, not read), proxies, objects whose prototype is not `Object.prototype` or `null`, symbol-keyed and non-enumerable properties (a copy would silently drop them), lists with holes or extra properties, functions, symbols, BigInts, `NaN` and `Infinity`, cycles, and nesting deeper than 24 levels. The one exception to "nothing reads the original again" is naming: a definition that cannot be snapshotted is named in its messages by a challenge id found through property descriptors only, which calls nothing. Then:

1. **Shape** (`structure.ts`): the lists are lists, the items are objects, the ids and references the later checks look up are strings, every header entry has a string `name` and `value`, and every evidence reference is a valid discriminated union (`kind` is `"log"` with a `logId`, or `"network"` with a `requestId`). Whatever is passed in, including values whose `toString()` throws and objects with no prototype, the result is a `ChallengeDefinitionError`, not a raw `TypeError`.
2. **Fields** (`fields.ts`, which calls `paths.ts`, `timestamps.ts` and `limits.ts`), checked even when the shape has problems, so an author sees everything in one pass. The type rules restate types that already exist (`WorkspaceScenario`, `ChallengeSummary`, `LogEntry`, `NetworkRequest`, `RootCauseOption`) and change no contract. The path, timestamp and limit rules were agreed with Syeda (section 1). The closed sets are typed `Record<Union, true>`, so the compiler fails if a union gains a member and `fields.ts` is not updated.
   - **Manifest:** `number`, `title` and `incident` are non-blank strings; `difficulty` is `beginner`, `intermediate` or `advanced`; `estimatedMinutes` is a positive whole number; `tags` is a list of non-blank strings with **no repeats, ignoring case** (`Auth` and `auth` are one tag; an empty list is allowed). Only case is normalised: a tag with surrounding whitespace is a different tag.
   - **Scenario:** `incidentDate` is a real calendar date written `YYYY-MM-DD` (month 1 to 12, a day the month has, leap years honoured); every file `content` is a string (empty is allowed); `entryFilePath` and every file `path` pass the path policy below.
   - **Logs:** `id` and `source` are non-blank; `timestamp` is a UTC time of day (below); `level` is `DEBUG`, `INFO`, `WARN` or `ERROR`; `message` is a string (empty is allowed).
   - **Network requests:** `id`, `url` and `path` are non-blank strings; `serverLogId` is **optional**, and when present is a non-blank string that must name a log line (below); `timestamp` is a UTC time of day (below); `method` is `GET` or `POST`; `type` is `document`, `script`, `fetch` or `ping`; `status` is a whole number from 100 to 599; `statusText` is a string (empty is allowed, HTTP/2 has none); `durationMs` is finite and 0 or more; `initiator`, `requestBody` and `responseBody` are optional, and when present must be a non-blank string, a string and a string; a header `name` is a non-blank string and its `value` a string.
   - **Root-cause options:** there are **at least two**, and `id`, `label` and `description` are non-blank strings. Labels are **unique after trimming and lower-casing**, so two options cannot read the same to a learner. Nothing else is normalised: inner spacing and Unicode form make labels different. Zero key observations remain valid.
   - **Private evaluation:** `correctRootCauseId`, `resolutionSummary` and every key-observation `id` are non-blank strings.
   - **Path policy** (`paths.ts`). It is strict, and it **refuses rather than repairs**, so a path is published exactly as the author wrote it and there is no second, cleaned form to disagree about. A path is refused when it:
     - is blank, or contains a control, invisible or direction-changing character (zero-width characters, bidirectional overrides, line and paragraph separators);
     - contains a backslash;
     - is not in Unicode NFC, because the same visible name can be written in more than one way;
     - uses a look-alike for `/`, the backslash or `.` that a compatibility fold turns into the real thing (the fullwidth forms);
     - is absolute: it starts with `/` (an empty first segment) or with a drive letter such as `C:`;
     - has an empty segment (a trailing or doubled `/`), or a `.` or `..` segment;
     - has a segment with leading or trailing whitespace, or ending in a dot (a Windows file system silently strips both, so two names would become one);
     - is longer than 128 characters, nested more than 8 folders deep, or has a segment longer than 64 characters;
     - contains a percent-escape that **would decode to something refused**, below.

     **Percent signs are literal** (approved). A path is never URL-decoded by the loader, the registry or the file tree: `50%20off.md` is a file whose name contains a percent sign, it is published exactly as written, and it is valid, as are `100%.md`, `caf%C3%A9.md` and `a%zz.md`. There is one consumer that does decode: the workspace opens each file in Monaco under the model URI `file:///<path>` (`MonacoEditor.tsx`), and Monaco's URI parser percent-decodes it. Verified against `monaco-editor`'s own `uri.js`: `50%20off.md` and `50 off.md` open the **same editor buffer**, `a%2fb.md` opens the same buffer as `a/b.md`, `%2e%2e/x.md` becomes `../x.md`, and a path that decodes to begin with `//` makes Monaco throw. So the traversal, separator and collision protections are also applied to the decoded form:
       - a percent-escape is refused if decoding it, as Monaco does and repeatedly (to a bound of four levels), yields a path this policy refuses: a `/`, a backslash, a `.` or `..` segment, a control or invisible character, a drive letter, a non-NFC name, a look-alike, or a padded or trailing-dot segment. That covers `%2e`, `%2f`, `%5c`, `%00` and double-encoded forms such as `%252e`, and anything nested deeper than four levels. An escape that decodes to something harmless (a space, an accented letter) is accepted;
       - two paths whose decoded forms are the same path collide, because they would share an editor buffer: `50%20off.md` and `50 off.md`, or `%41.md` and `a.md`.

     The decoding is Monaco's own algorithm, copied exactly, and `tests/challenges/paths.test.ts` holds it equal to Monaco's parser on 8,000 generated strings, shows that every path the loader accepts opens in the editor with the same folders and no dot segment, backslash or control character, and shows that every path that makes the editor throw is refused.

     **Editor-side update (Syeda's `integration/v1-challenge-001`, commit `16c0170`; not yet on this branch).** The description of the editor above is of THIS branch's `MonacoEditor.tsx`, which builds the model URI as `file:///<path>` and so lets Monaco decode the path. On the integration branch `src/lib/monaco-models.ts` builds it from the challenge id and the path's segments with `encodeURIComponent` applied to each segment, and Syeda has confirmed that Monaco therefore receives each segment percent-encoded and that a literal file name such as `50%20off.md` round-trips as that exact name (its `%` is sent as `%25`), so it no longer opens the same buffer as `50 off.md`. What her own test checks (`tests/workspace/monaco-models.test.ts`) is the encoding of a space, `#` and `?` in `a b#1?.md` (`a%20b%231%3F.md`); it has no case for a name that already contains a percent-escape, which has not been verified by a test on either branch. **The decoded-path protections above are kept unchanged.** They are no longer what keeps a literal path safe in the editor once her change lands, but they still refuse paths that would be dangerous under any consumer that decodes, and removing them is a separate decision that is not made here.

     Across a challenge's files, two paths **collide** when they differ only in case, in a Unicode compatibility form or in percent-encoding, and when one is a file and another lives inside it as if it were a folder. An exact duplicate is reported once, by the meaning pass below. **No extension or language is checked**: `.ts`, `.py`, `.sql`, `.java` and no extension at all all pass, and a test builds one challenge from Java, SQL, Python, TypeScript, JavaScript, Go, Ruby, Rust and extensionless files and publishes it unchanged.
   - **Timestamps** (`timestamps.ts`). The contract is one UTC date on the scenario (`incidentDate`) and a UTC time of day on each log line and request. **ISO 8601 UTC applies to that pair**: `timestamp` must be a real time of day written `HH:mm:ss.SSS`, so `incidentDate` + `T` + `timestamp` + `Z` is always a valid ISO 8601 UTC instant, such as `2026-10-30T09:14:02.117Z`. A test proves this for every value in Challenge 001 with `Date`'s own parser. `24:00:00.000`, `23:59:60.000` (a leap second), a missing or extra fractional digit, a time zone suffix, a full instant and surrounding whitespace are all refused. **The public wire format is not changed to carry full instants** (section 8.7). There are **no rules between records** (approved): a request's timestamp need not equal its log line's, and log lines may be in any order.
   - **Limits** (`limits.ts`): see the table in section 8.7. Text lengths count UTF-16 code units. File and body limits count UTF-8 bytes, which is what is stored and sent. A message gives the size and never the content.
3. **Meaning** (`validate.ts`), only for a definition whose shape is sound:
   - the contract version is supported (`SUPPORTED_CONTRACT_VERSIONS`, frozen);
   - the challenge id matches `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 characters (it appears in URLs and storage keys, so no uppercase, dots, slashes, underscores or spaces; `challenge-001`, `sql-joins-2`);
   - the revision matches `^[0-9A-Za-z][0-9A-Za-z.-]*$`, at most 32 characters (no `+` or spaces, so a version can always be split back apart; `1`, `1.2`, `2026-11-03`);
   - `completion` is `"diagnosis"`, because this registry produces diagnosis challenges and nothing else can complete one;
   - challenge ids, file paths, log ids, request ids, root-cause option ids and key-observation ids are unique, and **challenge `number`s are unique across the registry** (compared exactly as written, so `001` and `1` are different numbers);
   - the entry file exists, every **supplied** `serverLogId` is a log line (the link is optional, and several requests may share one log line), and every supplied `initiator` is a scenario file;
   - the correct root cause is a public option;
   - every key-observation reference resolves, no group is empty, and no evidence id is in two groups or listed twice.

**This is still not validation of every field.** What is enforced is listed above. What is deliberately not, and what would be needed before external definitions are accepted, is in section 8.7.

### 8.4 Content version

`<revision>+<fingerprint>`, for example `1+cb30a3cc594b`. The fingerprint is the first 12 hex characters of a SHA-256 over a canonical JSON serialisation of the **public** content (object keys sorted, `undefined` dropped; array order is significant). Any edit to what a learner sees therefore changes the version without anyone remembering to bump it.

The private evaluation configuration is **deliberately not hashed.** The version is recorded on a learner's session and returned to them, and the rest of the content is public, so a hash that included the answer would let anyone test the few possible answers offline. The consequence is in the next section.

### 8.5 The manual revision bump rule

**When the private evaluation configuration changes, the revision must be bumped by hand.** That means a change to the correct root cause, the resolution text or the key observations: anything in the `evaluation` of a definition. Nothing in the version moves when it changes, so without a bump, sessions started before and after an answer-key fix carry the same version while being graded differently.

This is enforced by `tests/challenges/revision-pin.test.ts`. It pins, per challenge, the revision and a SHA-256 digest of the canonical private configuration. If the configuration changes and the revision does not, the test fails and says what to do:

1. Bump the challenge's revision (for Challenge 001, `CHALLENGE_001_REVISION` in `src/server/challenges/challenge-001.ts`).
2. Update its entry in `PINS` in the test file to the new revision and the digest the failure message prints.

**Which challenges are covered.** The test reads `defaultChallengeSources` (`default-registry.ts`), the same list `createDefaultChallengeRegistry()` loads, and a test asserts the registry's challenge ids equal the ids it checked. A challenge registered there fails the test until it has an entry in `PINS` with an explicit revision and digest, and the failure prints the entry to add (this is exercised by a test that registers a second challenge). A pin whose challenge has gone fails too. **A challenge that reaches a registry some other way (a source that is not in `defaultChallengeSources`) is not covered**: register challenges in that list.

The digest lives only in that test file: it is not exported and not part of any version or response, and a test checks it appears nowhere under `src/`. A second test scans the built client output (`.next/static`); it is reported as skipped when there is no build, so run the production build first to include it. It adds no exposure, since the answer key is in the repository.

**What the digest cannot see: grading code.** It covers the *data* that decides a diagnosis (the correct root cause, the resolution text, the key observations). It does not cover the code that applies it: the evaluator and its hints (`src/server/diagnosis/evaluate.ts`) and the validation limits (`src/lib/diagnosis/validate.ts`). Changing how an unchanged key is applied alters what learners are told without changing the digest, so the test stays green. When grading behaviour changes, bump the revision by hand as well, and update the pin.

### 8.6 How the learner-session service receives the version

The service takes the registry and a **required** version function, so a service cannot be built that gives every challenge the same version:

```ts
// Illustrative only. Nothing mounts this yet.
const challenges = createDefaultChallengeRegistry();   // validates at startup, throws if anything is inconsistent
const service = createLearnerSessionService({
  learners, sessions, attempts,
  registry: challenges.diagnosisRegistry,
  challengeVersion: (id) => {
    const version = challenges.contentVersion(id);
    if (version === undefined) throw new Error("The challenge registry has no content version for this challenge.");
    return version;
  },
});
```

The service only asks for a version after it has found the challenge in the registry, so the `throw` is there for the type, not for a real case. It throws instead of falling back to an invented version such as `"unknown"`: a failure is better than recording a session against a version that does not exist, and one invented value shared by every unknown challenge would hide a real change. `src/server/app-services.ts` builds the function this way (unmounted). The version is recorded when a session starts and is **compared on every request**: an unfinished session whose version differs is out of date and is restarted, and a completed one is preserved (section 3.1).

### 8.7 Field validation: what is enforced, what Syeda approved, what is still open

**Enforced** is section 8.3. A mistake in any rule there is a startup error with the field's path in the message.

**Approved by Syeda.** These decisions were relayed by the engine owner and are not otherwise recorded in the repository. Each is pinned by tests, and each is in one place so a change is small.

| Decision | The rule | Enforced in |
|---|---|---|
| Numerical limits | All 31 ceilings in the table below, exactly as documented. The Challenge 001 half-limit guard stays. | `limits.ts` (`LIMITS`, one frozen object) |
| Evidence timestamps | `incidentDate` plus a UTC time of day written `HH:mm:ss.SSS` is acceptable, because the pair gives one deterministic ISO 8601 UTC instant (`incidentDate` + `T` + `timestamp` + `Z`) | `timestamps.ts` |
| Session and attempt API timestamps | Full ISO 8601 UTC (`startedAt`, `completedAt`, `submittedAt`, `resetsAt`) | `snapshots.ts` |
| Request `url` and `path` | Current non-blank validation stays. They may represent simulated debugging evidence, so no format is required. | `fields.ts` |
| Unexpected properties | Ignored in the internal loader. They never reach the public view, the content version, the answer key or the validation context. A stricter schema is for external definitions, later. | `plain-data.ts`, `public-view.ts`, `registry.ts` |
| Root-cause options | At least two. Zero key observations stay allowed. | `fields.ts` |
| Challenge numbers | Unique across the registry | `validate.ts` |
| Option labels | Unique after trimming and lower-casing | `fields.ts` |
| Tags | Unique ignoring case | `fields.ts` |
| Log lines | May be in any time order | Not checked |
| Request durations | Not compared with the free-text log message | Not checked |
| Languages | A per-file language declaration remains deferred, and the current multi-language contract is unchanged: no extension, file type or language is checked anywhere | Not checked |
| Windows-reserved file names | `CON`, `NUL`, `COM1` and the like stay allowed for virtual files | Not checked |
| Path Unicode rules and collisions | NFC required; fullwidth look-alikes of `/`, the backslash and `.` refused; paths that differ only in case or Unicode form collide; a file may not also be a folder of another file | `paths.ts` |
| Percent signs in paths | Literal: never decoded by the loader, so `50%20off.md` is valid. Traversal and separator protections are kept (see "Awaiting confirmation" for how, because the editor decodes) | `paths.ts` |
| Request and log link | `serverLogId` is optional. Several requests may share one log line. Request and log timestamps need not match. A supplied `serverLogId` must name an existing log line. Several log lines per request wait for a schema revision. | `structure.ts`, `validate.ts`, `public-view.ts` |

**The limits, and the Challenge 001 values they are grounded in.** Syeda approved all 31 as documented. `tests/challenges/limits.test.ts` re-measures Challenge 001 independently and fails if it ever uses more than half of any limit, and fails if a limit is added without a measurement. Every limit has a test at the limit (accepted) and one past it (refused). The values are a **ceiling against runaway content**, not a content budget.

| Limit | Challenge 001 uses | Allowed |
|---|---|---|
| Files per challenge | 14 | 64 |
| One file's content (UTF-8 bytes) | 1,588 | 32,768 |
| All files together (bytes) | 11,865 | 262,144 |
| Path length / segment length / folders deep | 30 / 16 / 3 | 128 / 64 / 8 |
| Log lines | 23 | 500 |
| A log message / source (characters) | 49 / 4 | 1,000 / 64 |
| Network requests | 14 | 200 |
| Headers in one list | 13 | 64 |
| A header name / value (characters) | 25 / 186 | 128 / 4,096 |
| Request body / response body (bytes) | 63 / 1,307 | 32,768 / 65,536 |
| URL / request path / status text (characters) | 45 / 18 / 12 | 2,048 / 512 / 64 |
| Any id used in evidence or a root-cause choice (characters) | 30 | 64 |
| Tags / one tag (characters) | 3 / 14 | 16 / 32 |
| Title / incident / number (characters) | 20 / 74 / 3 | 100 / 500 / 8 |
| Root-cause options | 5 | 12 |
| An option label / description (characters) | 74 / 113 | 200 / 1,000 |
| Key observations / references in one | 4 / 4 | 20 / 20 |
| Resolution summary (characters) | 421 | 4,000 |
| The whole public scenario, serialized (bytes) | 39,494 | 1,048,576 |

The largest ratios are for code and bodies (so a verbose Java or SQL challenge fits). The tightest are the id length, the number of options and the number length, at a little over two times Challenge 001. The minimum of two options does not interact with the maximum of 12.

**Awaiting Syeda's confirmation.** Both are implemented as written, and both follow from her decisions rather than from a new policy:

| Point | What is enforced today | Why it needs her confirmation |
|---|---|---|
| Percent-escapes: literal in the loader, protected against the editor's decoding | The path is never decoded and `50%20off.md` is valid. A percent-escape is refused only if Monaco's decoding of it would give a `/`, backslash, dot segment, control or invisible character, drive letter, non-NFC or look-alike name, or a padded or trailing-dot segment. Paths that decode to the same path collide. | She asked for literal paths with traversal, separator and collision protections kept, and for the stricter rule if literal paths proved ambiguous. They are ambiguous **in the editor**, which decodes them (section 8.3), so the protections are applied to the decoded form. If she would rather have purely literal paths, the editor would need to encode each segment when it builds the model URI (`MonacoEditor.tsx`, hers). The decoded checks can then be removed. **Update:** Syeda's `integration/v1-challenge-001` (`16c0170`) does encode each segment (`src/lib/monaco-models.ts`) and she confirms literal names such as `50%20off.md` round-trip. The decoded checks are nevertheless **kept** and nothing is weakened: the removal is not requested, and no test yet covers a name that already contains a percent-escape. |
| Padded and trailing-dot segments | A segment with leading or trailing whitespace, or ending in a dot, is refused | Not named in the approvals. A Windows file system would strip them, but these files are virtual, and Windows-reserved names were approved as allowed. |

**Needs a change on Syeda's side before it can be used.** The loader accepts a request with no `serverLogId`, as approved. The shared type does not yet: `NetworkRequest.serverLogId` in `src/types/investigation.ts` is a required `string`, and two UI sites use it without a check (`RequestDetails.tsx` renders `View in Logs (<id>)` and calls `onShowLog` with it, and `InvestigationConsole.tsx` builds a `Map` keyed by it). A request without a log would show a broken link. Challenge 001 is unaffected: every one of its requests has a log. Until the type is made optional and those two places handle its absence, no challenge should omit a link. The public view omits the key and asserts the object back to the shared type, so this is the one place the loader's output is ahead of the typed contract.

Also deferred, by design:

| Item | State |
|---|---|
| Several log lines per request | Needs a schema change (the request has a single optional `serverLogId`). A future schema revision. |
| A declared language per file | Not a field in the contract. Add an `EditorLanguage` per file only when the contract adds it. |
| A stricter schema for unexpected properties | For external definitions, later (below) |
| Equivalence between challenge numbers (`001` and `1`) | Not judged. Numbers are compared exactly as written. |

**Restrictions that apply only to static TypeScript definitions.** Today's only source is Challenge 001, written in TypeScript and type-checked by `tsc`. So the compiler already guarantees most of the type rules for it, and the field checks are a second line of defence, not the first. Nothing in this module reads a file, a database or a request. The snapshot refuses getters and proxies because a source other than a TypeScript object literal could contain them.

**What would be required before accepting external challenge definitions** (JSON files, a database, an upload): a stricter schema, including a policy for unexpected properties; the open points above, decided; a schema version for the definition format, separate from `contractVersion`; a bound on the size of the raw input before it is parsed (the limits above apply after parsing); a policy for who may author a definition and where the private evaluation is stored (it must never travel with the public half); and a review of how the client renders each public field (the client has no `innerHTML` today, but that is not enforced here). Until then this module should be given only definitions from code that is in the repository.

## 9. Deliberately deferred

| Item | Why |
|---|---|
| **Wiring `submitDiagnosis` into the diagnosis endpoint** (`POST /api/challenges/:id/diagnosis`) | That endpoint belongs to Syeda; the change needs her approval. The exact proposal is in section 11. |
| Mounting the handlers as routes | Waits for the endpoint decision and a durable store |
| **A durable store** | Storage is undecided. No database, migrations or infrastructure were added. |
| Scoring | Out of scope. `computeScore` is untouched and unused. |
| Challenge unlocking, prerequisites, a catalog | A later phase |
| Frontend changes: restoring a completed workspace from `completion`, reacting to `restartRequired` and `restarted`, `applySessionSnapshot` in the engine | Later; the UI is Syeda's (section 11) |
| A way for a learner to retry a challenge they completed, or to move a completed session to a newer version | A product decision. Today a completed result is permanent (section 3.1). |
| Retention of superseded sessions | They are kept as history until their learner is purged. A durable store needs a retention policy. |
| **Mounting the challenge registry**: replacing the direct Challenge 001 imports in `page.tsx` and the diagnosis route, and `createDefaultRegistry()` | Those files are Syeda's. Needs her approval. Until then two sources of truth exist, and the route's registry does not have the protection in section 8.2. |
| Percent-escape protection against the editor's decoding, and padded or trailing-dot segments (section 8.7): implemented, **awaiting Syeda's confirmation** | Both follow from her decisions; see 8.7 for what each does and what the alternative is |
| Making `NetworkRequest.serverLogId` optional in the shared type, and handling its absence in the UI | The loader already accepts a request without a log, as approved. The type (`src/types/investigation.ts`) and two UI sites are Syeda's. Section 8.7. |
| Several log lines per request | A schema revision. The request has a single optional `serverLogId` today. |
| Working-state persistence (evidence, notes), hints, Fix and Verify, accounts | Later |

## 10. Known limits

- Attempt identity depends on the learner cookie. A learner who discards it starts over, and an anonymous identity cannot stop enumeration across many identities.
- Creating a learner is unauthenticated and, in this phase, **not rate-limited**. Creation limits belong with mounting the routes.
- **A replay never judges again** (section 4). A stored correct attempt is answered from the result stored on its session, and a stored incorrect one only ever as incorrect. The one thing a replay does recompute is the attempt window shown with it, which is the window now.
- **A restart resets the learner's attempt window.** The new session has its own empty window, so a version change gives a learner a fresh set of attempts. Only a deploy that changes the challenge can cause one, and the learner cannot trigger it.
- **Superseded sessions accumulate.** A restart keeps the old session and its attempts as history, so a challenge that changes often leaves more records per learner until that learner is purged. The memory store reclaims them with the learner. A durable store needs a retention policy (section 9).
- **A completed result is permanent.** A learner who completed an earlier version cannot start the newer one, and a corrected answer key does not reopen their session.
- **The 409 `session-outdated` is not reachable yet.** It comes from `submitDiagnosis`, which no mounted route calls. Until the diagnosis endpoint uses the service, nothing sends it (section 11).
- The memory store is atomic only within one process.
- Two decisions depend on the **scheme of the URL the server is given**: the Origin comparison and whether the cookie gets `Secure`. Behind a proxy that terminates TLS and rewrites the URL to `http`, a legitimate HTTPS request would be refused, and a cookie would be issued without `Secure`. The deployment topology is not known yet, so nothing here assumes one. Verify what `request.url` looks like in the real deployment before mounting routes; an explicit setting for it is the likely fix.
- **The challenge registry's protection is against accidents, not against code running in the process** (section 8.2). Challenge 001's own data modules are ordinary mutable data that is read when a registry is built, so a registry built later would see an edit made to them. The registry that the diagnosis route builds today with `createDefaultRegistry()` is not the protected one: it is plain Maps and Sets, as it always was, until the route moves onto the challenge registry.
- **The content version cannot see a change to the answer key** (section 8.4). The pinned-digest test and the manual revision bump (section 8.5) are the only safeguard, and they run in the test suite, not at startup. They cover the answer-key data of the challenges in `defaultChallengeSources`, not the grading code and not challenges loaded another way.
- **Field validation covers what is listed in section 8.3, not everything.** Not enforced, each by Syeda's decision: request URL and path formats, unexpected properties (ignored, never published or graded), log order, any relation between a request's time and its log line, durations against log text, per-file language, Windows-reserved names. Percent signs in paths are literal, with protection against the editor's decoding that awaits her confirmation, as do padded and trailing-dot segments (section 8.7). The loader's output is ahead of the typed contract in one place: a request may have no `serverLogId`, which the shared type does not yet allow (section 8.7). The module should only be given definitions from code in this repository.
- **`ReadOnlyMap` and `ReadOnlySet` equality and cloning** are not those of a real `Map` and `Set`: `deepStrictEqual` cannot distinguish two views and `structuredClone` returns an empty object (section 8.2).
- `ReadOnlySet`'s set-algebra methods (`union` and the rest) use the Set methods that arrived in Node 22. No existing consumer calls them, and `has`, `size` and iteration need nothing newer.

## 11. Integration requirements (not implemented: needs Syeda's approval)

Everything in sections 2 to 8 is built, tested and **not mounted**. This section is the work that remains to make it live. **None of it is done**, because each item changes a file that belongs to Syeda (`src/server/diagnosis`, `src/app`, `src/components`, `src/engine`, `src/lib`, `src/data`, `src/types`). The proposals are written so they can be reviewed without reading the implementation.

### 11.1 The diagnosis route and handler

Today the handler (`src/server/diagnosis/handler.ts`) keeps its own attempt cookie (`buglab_attempt`), counts wrong attempts in an in-memory limiter, and never records anything. **Proposed change:** after the request checks, call `service.submitDiagnosis` and map its result.

Keep, unchanged: the content-type check, the Origin check (Syeda's hardened version, which is on her branch), the 16 KiB body cap, JSON parsing (an unparsable body is still `400 invalid`) and the per-IP `ipSubmissions` limiter. That limiter is abuse protection across learners and is not replaced by the per-session window.

Remove: the `buglab_attempt` cookie, the `wrongAttempts` limiter, and the call to `evaluateDiagnosis` (the service does it). Add:

```ts
// Proposed. Illustrative only: none of this exists.
const cookieValue = readLearnerCookie(request.headers.get("cookie"));       // src/server/session/cookie.ts
const submissionId = request.headers.get("idempotency-key") ?? undefined;   // the request body does not change
const result = await service.submitDiagnosis(cookieValue, challengeId, body, { submissionId });
// then: map `result` as below, and set the learner cookie from result.cookie with serializeLearnerCookie
```

| Service result | HTTP | Body |
|---|---|---|
| `ok`, `response.status` is `correct` or `incorrect` | 200 | `response`, as it is |
| `ok`, `response.status` is `invalid` | 400 | `response`, as it is |
| `ok`, `response.status` is `rate-limited` | 429, with `Retry-After` | `response`, as it is |
| `rejected`: `learner-missing`, `learner-expired` | 401 | `{ status: "error", message }` |
| `rejected`: `unknown-challenge`, `session-missing` | 404 | `{ status: "error", message }` |
| `rejected`: `session-outdated`, `submission-id-conflict` | 409 | `{ status: "error", message }` |
| The call throws | 500 | The existing generic error |

**The `DiagnosisResponse` contract does not change**: every body above is an existing shape, and a client tells the new failures apart by the HTTP status. The route would be built from one process-wide registry and service (section 11.3).

An `Idempotency-Key` header is proposed so that the request body stays exactly as it is. The alternative is an optional `submissionId` field in the body, which the service already accepts as an option and the existing validator already ignores. Without either, a retry counts as a new attempt.

### 11.2 The workspace client

- **Before the first submission:** `POST /api/learner` (create or resume the identity), then `POST /api/challenges/:id/session` (start or resume the session). After the proposed change a diagnosis without a session is a `404 session-missing`, so the client must have both.
- **On load:** `GET /api/challenges/:id/session`. If `status` is `completed`, build the finished workspace from `completion`: the resolution, the feedback, the submitted diagnosis and its evidence references. If `restartRequired` is true, `POST` the session again.
- **On `restarted: true`:** clear the locally held working state (evidence, notes, hypotheses), because it belongs to a version of the challenge that no longer exists.
- **On submit:** send a fresh UUID in `Idempotency-Key`, and reuse it for a retry of the same click.
- **On a 409:** treat `session-outdated` as "start the challenge again", and `submission-id-conflict` as a client bug.
- **On a request with no linked log:** hide the `View in Logs` link and do not key anything on `serverLogId`. The loader accepts such a request, and the shared type and these two places do not yet (section 8.7).

### 11.3 Composition and storage

- **One registry, mounted:** `page.tsx` and the diagnosis route build the challenge registry (`createDefaultChallengeRegistry()`) once per process and read `getPublic` and `diagnosisRegistry` from it, instead of importing Challenge 001 directly and calling `createDefaultRegistry()`. Until then two sources of truth exist (section 8.1).
- **One service, with the version wired in:** `createLearnerSessionService({ learners, sessions, attempts, registry: challenges.diagnosisRegistry, challengeVersion })`, where `challengeVersion` returns `challenges.contentVersion(id)` and **throws** for a challenge the registry does not have. There is no `"unknown"` fallback (section 8.6). `src/server/app-services.ts` already composes it this way, unmounted.
- **A durable store first.** The memory store is correct only inside one long-lived process. It must not serve more than one instance or a serverless deployment. A durable adapter must pass the three contract suites (section 6) unchanged, which now include restarts and stored results.
- **Re-run the build scan** for the answer-key text once the registry is imported by a route. Until then it can only show that nothing leaks today (section 8.2).

### 11.4 Decisions for Syeda

**Approved** (section 8.7, section 3.1 and section 11.1; given in the project conversation and relayed to this document, not otherwise recorded in the repository):

1. The timestamp reading: evidence stays `incidentDate` plus a UTC time of day, and the session and attempt APIs use full ISO 8601 UTC.
2. The 31 limits, and the decisions on the deferred validation rules.
3. The path rules: NFC, rejection of fullwidth look-alikes, case and Unicode collisions, file-versus-folder conflicts, and percent signs as literal characters.
4. The request and log link: optional, many requests per log, timestamps independent, a supplied `serverLogId` must resolve, several per request deferred.
5. Restart semantics: an unfinished session restarts on any revision change, answer-key-only included, and a completed result is permanent with its original version, resolution and evidence.
6. The `Idempotency-Key` header. The same key and payload replays the original result, and a different payload under the same key is rejected.
7. Preserving the existing diagnosis request and response contract as far as possible.

**Still open:**

1. **Percent-escape protection** (section 8.7, "Awaiting Syeda's confirmation"): the loader keeps paths literal and refuses only escapes whose decoding, by the editor, would be a traversal, separator or other refused path. The alternative is purely literal paths with the editor encoding its model URIs.
2. **Padded and trailing-dot segments** (section 8.7): refused today, not named in the approvals.
3. **`NetworkRequest.serverLogId` optional** (section 8.7): the type and the two UI sites that use it.
4. **The diagnosis integration** (11.1) and the **client changes** (11.2): the status mapping, retiring the old `buglab_attempt` cookie and wrong-attempt limiter, and the client flow. These are described as the agreed proposal and are to be reviewed separately against the existing API contract. Nothing here implements them.
5. **Whether a learner may later retry a completed challenge** (section 3.1).
6. **Deployment:** a durable store, and the real deployment topology for the secure cookie and Origin check (section 11.3).
