# BugLab

BugLab is a library of debugging investigations. Each challenge is a production incident in a small,
realistic codebase. The learner reads the code, follows the server logs and the browser's network
traffic, collects evidence, and submits a diagnosis of the root cause. The server checks it and, when
it is right, explains what happened.

There are **30 published challenges**, five in each of six categories: Authentication & Authorization,
APIs & Backend, Frontend & React, Databases & Data Integrity, Security & Vulnerabilities, and
Performance & Production.

## Learning objectives

- Reading unfamiliar code to find where behaviour is decided.
- Correlating server logs with browser requests on one timeline.
- Forming hypotheses and ruling them out with evidence.
- Distinguishing a root cause from its symptoms and from plausible distractions.

## Learner workflow

1. Open the landing page at `/` and choose **Browse the challenges**, or open Challenge 001 directly.
2. In the Challenge Library (`/challenges`), search or filter by category, difficulty or technology.
3. Open a challenge (`/challenges/challenge-NNN`): the incident brief opens in the editor.
4. Browse the files in the read-only editor, and inspect the logs and network requests in the
   Investigation Console.
5. Add logs and requests as evidence, and record hypotheses and observations in Notes.
6. Choose a root cause, explain it, and submit. A wrong diagnosis gets the challenge's investigation
   hints; a correct one shows the resolution, with links to the next challenge and the library.

The status in the challenge header follows what the learner does: **Not started**, then
**Investigating** once anything is recorded, **Diagnosis submitted** after a wrong answer, and
**Resolved** after a correct one. Nothing is saved yet: evidence, notes and status reset on refresh.

## Technology stack

Next.js 16 (App Router, `cacheComponents`), React 19, TypeScript, Tailwind CSS 4, and Monaco Editor
0.57, self-hosted from `public/` (see `docs/architecture/monaco-self-hosting.md`). Tests use Node's
built-in test runner. There is no database in the running application.

## Repository structure

```
src/app/                 Routes: / (landing), /challenges, /challenges/[challengeId], the diagnosis API
src/components/          React components: landing, library, challenge overview, workspace, UI
src/data/                Public challenge content (challenge-001 ... challenge-030) and the catalog
src/lib/                 Client-safe logic: catalog and discovery, authoring helpers, validation
src/engine/              The learner's in-memory challenge session (status, progress, scoring)
src/server/diagnosis/    Live diagnosis grading: registry, evaluator, handler, origin and rate limits
src/server/content/      Server-only answer-key registration and authoring helper
src/server/challenges/   Challenge registry with content versions (used by learner sessions)
src/server/session/      Learner-session service and in-memory store (not mounted)
src/server/auth, admin/  Authentication, RBAC and admin data access foundations (not mounted)
src/proxy.ts             Rejects unknown challenge URLs before routing
docs/                    Architecture notes and the challenge authoring guide
tests/                   Unit, contract, guard and integration tests
```

## Architecture overview

```
 Browser                               Server
 ───────                               ──────
 Landing, Library, Workspace  ──GET──▶  Static pages built from the public catalog (src/data)
 (public scenario only)
 Diagnosis form ─POST /api/challenges/:id/diagnosis─▶  route.ts
                                         ├─ origin and content-type checks, per-IP and
                                         │  per-attempt rate limits
                                         ├─ registry restricted to published challenges
                                         └─ evaluator: answer key (server-only) → feedback
```

Every page is prerendered from public data. The only request-time endpoint is the diagnosis API.

### Public content and server-only answer keys

- Each challenge has two parts: `src/data/challenge-NNN/index.ts` (public: files, logs, requests,
  options) and `answer-key.server.ts` (private: the correct root cause, resolution, key evidence and
  hints).
- Answer keys import `server-only`, so importing one from client code fails the build. They are
  registered only in `src/server/content/index.ts`.
- `tests/content/authored-challenges.test.ts` checks that no public content contains a challenge's
  correct option or resolution, and `tests/challenges/revision-pin.test.ts` checks the built client
  bundle for the private configuration's digests.

### Diagnosis evaluation flow

1. `src/app/api/challenges/[challengeId]/diagnosis/route.ts` builds the handler.
2. `src/server/diagnosis/handler.ts` checks the request's origin and content type, applies the rate
   limits and validates the submission against the challenge's public IDs.
3. `src/server/diagnosis/evaluate.ts` compares the submission with the answer key. A wrong answer gets
   the same feedback whichever option was chosen, so it never narrows down the answer. A correct one
   gets the resolution and the evidence coverage.
4. `src/server/diagnosis/published.ts` limits the registry to published challenges, so an unpublished
   ID is a 404.

## Challenge authoring and publication

See `docs/authoring/challenges.md`. In short:

1. Write the public scenario with `defineChallenge` (`src/lib/authoring/define-challenge.ts`).
2. Write the answer key with `defineAnswerKey` (`src/server/content/define-answer-key.ts`).
3. Register the scenario in `src/data/catalog/index.ts` and the answer key in
   `src/server/content/index.ts`.
4. Add the revision pin that `tests/challenges/revision-pin.test.ts` prints.

A challenge appears in the library, gets its route and becomes submittable once its listing is
`published`. `tests/content/authored-challenges.test.ts` checks every challenge for consistent
registration, logs that agree with requests, answer privacy and working grading.

## Development

Requires Node.js (developed with Node 24) and npm.

```bash
npm ci
npm run dev          # http://localhost:3000
npm run build        # production build
npm start            # serve the production build
```

The Monaco assets are copied into `public/` automatically before `dev`, `build` and `typegen`.

Environment variables read by the running application:

| Variable | Used by | Effect |
|---|---|---|
| `BUGLAB_APP_ORIGIN` | diagnosis API | The app's canonical origin, required in deployments. Unset only for local development, where same-origin requests are accepted. |
| `BUGLAB_TRUSTED_PROXY_HOPS` | diagnosis API | How many proxy hops to trust when reading the client IP for rate limiting. Defaults to 0. |

## Testing and validation

```bash
npm test             # all tests (node:test)
npm run typecheck    # route type generation + tsc
npm run lint         # ESLint
```

The build-output check in `tests/challenges/revision-pin.test.ts` needs a production build; without
one it is reported as skipped, so run `npm run build` first to include it.

## What works today

- 30 published challenges in six categories, each with code, logs, network captures and evidence.
- The landing page, and the Challenge Library with search, category, difficulty and technology filters,
  sorting, and URL-based filter state.
- The investigation workspace: file explorer, read-only Monaco editor with tabs, log search and level
  filters, network inspector, evidence collection, hypotheses and observations.
- Server-side grading with challenge-specific hints, resolutions, attempt limits and a publication gate.
- A status that follows learner activity, and links to the next challenge and the library once a
  challenge is solved.

## Built but not active

These have code and tests, but no route mounts them, and the application does not depend on them:

- **Learner sessions** (`src/server/session`, `src/server/app-services.ts`, `src/lib/learner-session`):
  a learner cookie, per-challenge sessions and attempt history. The only store is in memory.
- **Accounts and roles** (`src/server/auth`, see `docs/architecture/accounts-and-rbac.md`): no
  authentication provider is configured, so every check fails closed.
- **Admin challenge inventory and review** (`src/server/admin`, `src/components/admin`): read-only, no
  route.

## Known limitations

- Progress, evidence and status are kept in the browser's memory and reset on refresh. There are no
  accounts and no saved progress.
- The diagnosis rate limits are kept in each server process's memory, so they reset on restart and are
  not shared between instances.
- Learner sessions, once mounted, grade with the generic hints until the session service passes each
  challenge's own hints (see `docs/authoring/challenges.md`).
- On small screens the workspace panels stack vertically.

## Contributors

From the repository history:

- **Syeda Mahnoor**: product and frontend: the landing page, Challenge Library, investigation
  workspace and Monaco integration; the live diagnosis API, its security controls and publication
  gate; the public catalog and authoring helpers; the 30 challenges; the client for learner sessions;
  and the authentication, RBAC and admin foundations.
- **Habin Abdul Rahman**: backend foundations: the challenge registry with content versions
  (`src/server/challenges`), the learner-session service and store (`src/server/session`,
  `src/server/app-services.ts`), the engine's session model (`src/engine`), and submission validation
  (`src/lib/diagnosis`).
- **Joint**: integration between the workspace and the engine session, and between the challenge
  registry and the published catalog.

Claude Code session logs for this work are committed in `.claude-logs/`.
