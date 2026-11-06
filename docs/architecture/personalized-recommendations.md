# Personalized recommendations: deterministic V1

## Scope and ownership

This feature owns `/learning-path`, `/api/recommendations/v1`, and the new
recommendation namespace. It does not mount learner/session/Learning Loop APIs,
activate authentication, link accounts, introduce a database, or call a model.
Claude owns account/authentication UI and Progress/Journal integration. Habin
owns authoritative identity, sessions, verified completions and persistence.

Existing Journal and Progress files are unchanged. Their hooks and schedule
functions are consumed read-only; no `LearningActions` are called. Shared header,
navigation, routes, Next configuration, package manifests and lockfiles remain
unchanged. A feature-local header makes the new page usable at its direct URL.
Adding it to shared navigation and mounting a compact Progress widget remain
Claude-owned integration tasks.

## Inputs and trust

- `server/catalog.ts` reads only `listPublishedChallenges()` and projects an
  explicit public field allow-list. No scenario, answer key, grading registry,
  hidden test, or reflection text enters the engine or API response.
- `server/history.ts` is the trusted per-request integration port. Its default
  reports `not-connected`; it makes no shared learner request and creates no
  cookie. A failed provider stays `unavailable`, not ready with zero completions.
- Browser data is a separate, unverified source. `adapters/browser.ts` projects
  valid published challenge IDs, observed-solve dates, existing due-review dates,
  and the IDs of reflections last marked `need-practice`. Private writing,
  raw recall attempts and practice-history bodies never leave the adapter.
- The page uses the existing `useLearning` and `useToday` read interfaces. It
  keeps no recommendation-specific progress store and never changes Journal
  records. Preferences live in component memory only.
- The public request schema cannot supply verified completions, catalog content,
  learner/account IDs, credentials, or reflection writing. Overposting is an
  error, not a way to influence authority.

The initial client sends requests with `credentials: omit`. Its suggestions are
anonymous catalog/browser guidance, even if an unrelated account cookie exists.
The local-activity checkbox can disable all local signal transmission. Browser
records are never associated with an account by this feature.

## Eligibility and scoring

Eligibility precedes ranking: published, available, valid public metadata,
implemented `diagnosis` completion mode, and unambiguous ID. Drafts, archived
entries, unavailable work, unsupported Fix Mode, unknown IDs and ambiguous
catalog duplicates are excluded. The current catalog has 30 published cases.

Known verified completions are excluded regardless of content version and local
opt-out. Local observed solves independently suppress new work when enabled;
they never create verified completions. Missing history does not prove a case
is unsolved elsewhere, and the UI says so.

Initial bounded integer weights:

| Factor | Maximum | Basis |
|---|---:|---|
| Difficulty fit | 30 | Preferred/current tier 30; gentler practice 15; optional next tier 5 |
| Goal match | 20 | Explicit selected category |
| Practice request | 20 | Category of an actual local `need-practice` recall |
| Coverage opportunity | 15 | Floor of `15 * (available - represented) / available` |
| Continuity | 10 | Shared public category/topic with an actual recent completion/observation |
| Time fit | 5 | Catalog estimate within the selected budget |

The total is a ranking value, not a probability or proficiency score. Missing
factors contribute zero; the total is not renormalized. Coverage uses complete
verified history when available, otherwise a ready browser record. Partial data
never becomes proof that a category was not practiced. Recency uses verified
facts first, then local observations; future-dated observations do not establish
recency. No attempt count, success rate, time-to-solve or skill mastery is invented.

Focus and time are preferences, not hard filters. Difficulty is a preferred tier
and upper bound, with gentler cases allowed. Stretch explicitly permits one
higher tier. Static estimates are never presented as actual completion times.

Ties use score descending, numeric challenge number, then ASCII ID. Candidate,
completion, recall, and evidence permutations are deterministic. Duplicate
completion versions have a stable tie-break; conflicting difficulty evidence is
ignored rather than allowing input order to decide.

## Paths, coverage and difficulty

A cold start prefers beginner investigations; featured metadata cannot override
fit. Greedy path selection adds a bounded diversity penalty of 10 per already
selected case in a category (maximum 20), unless a focus is explicit. A reason
explains when a new area adds variety. Path selection never simulates progress
or completion.

There are at most **five distinct new-work challenge IDs overall**. `next` is the
first path item; up to three practice highlights reference other steps already
in that same path, not three extra challenges. Recall is a separate review action.
Fewer cases are returned if the eligible pool is exhausted.

The six catalog categories are practice-coverage areas, not measured skills.
Tags explain relatedness. No weakness/mastery percentages are inferred.

Default difficulty is beginner. An explicit preference wins. An opt-in stretch
may advance the default target one tier only after three distinct trusted,
version-matched difficulty-at-completion facts. Current completion DTOs do not
provide those historical facts, so production does not synthesize them from
current catalog labels. An evidence-based promotion cannot stack with another
extra tier in the same plan. Repeated solves, local flags, missing attempts, and
self-reported recall do not trigger a proficiency assessment or automatic demotion.

## Recall

The read-only browser adapter calls the existing `dueReflections` selector, which
owns the established 1/3/7 local-calendar-day schedule. The engine validates dates
again and orders due/overdue items by due date then catalog order. Leap days and
DST boundaries use existing calendar arithmetic. Upcoming or unknown/withdrawn
cases are not exposed. Verified completion alone creates no reflection or recall.
Completed cases may appear as recall, never as new work.

Recall cards link to `/journal#recall`; this feature neither copies the Journal's
recall UI nor changes its scheduling. A Journal consumer can still show the
learner's own withdrawn-case history; it is not recommended here.

## UI and states

The dedicated page includes a next investigation, numbered path, practice
highlights, existing due recalls, preference controls and typed factual reasons.
It uses existing surfaces, typography, theme tokens, difficulty badges, icons,
footer and theme toggle. Both themes, 390px mobile and 1440px desktop, keyboard
skip navigation, labels, unique IDs and primary-action contrast are verified.

Loading does not briefly label all challenges unsolved. Changing preferences
aborts obsolete requests and hides stale results; a 15-second timeout is retryable.
Blocked storage retains catalog suggestions. Partial/unavailable/expired history
is disclosed without fabricated counts. Empty ranges can be adjusted or opened
in the library. API errors never display raw server text. Reduced-motion loading
states are supported. Existing browser records remain byte-for-byte unchanged.

## Integration gates

Before authenticated personalization is enabled, Claude and Habin must agree:

1. The mounted, authorized verified-completion contract and coverage semantics.
2. A durable identity/persistence source; no development MemoryStore activation.
3. Explicit consent/ownership rules for associating browser-local observations.
4. Identity-change invalidation: abort old requests, clear displayed plans, use
   a subject-generation key, and never retain another subject's previous history.
5. How same-origin credentials, origin policy and cache controls apply. The
   initial client deliberately omits credentials and must be changed explicitly.
6. Version-matched historical difficulty evidence, if progression is enabled.

Implement `VerifiedHistoryProvider` per request only after those gates. Never
resolve identity from a body field or arbitrary caller-supplied header. The
injected test provider's `x-test-subject` header is a fixture, not an identity
implementation. Do not add a module-global learner or personalized result cache.
All API responses are private/no-store, including errors. Private reflections,
feedback and completion submissions remain outside this contract.

A future Progress widget can consume `next`, `recalls`, `target`, `evidence` and
`notices` from this same plan. It must preserve provenance and leave Journal and
Progress selectors as their owners' responsibility. `RecommendationEngine` is
an explicit strategy interface; a future model strategy would require a version
review and the same hard eligibility/privacy constraints. No model service is
introduced in V1.

## Verification and worktree setup

```powershell
npm run lint
npm run typecheck
npm run build
npm test
npm run start -- --port 3107
node scripts/verify-recommendations-browser.mjs
```

The browser script uses installed Microsoft Edge, an isolated profile under
`.next/`, and localhost only. It installs nothing, changes no real browser data,
and closes its own browser. Screenshots and reports are ignored build artifacts.
It covers preferences, recall, local solve suppression, opt-out, private-writing
exclusion, unchanged storage, both themes, mobile overflow, keyboard navigation,
contrast, blocked requests/retry and unavailable storage.

The initial worktree dependency junction pointed outside Turbopack's inferred
root and caused `next/package.json` resolution to fail. Inspecting the actual
junction/root confirmed the cause. Replacing only that new junction with a
physical copy of the already-installed packages resolved it; no install, shared
Next config, package manifest, lockfile or original dependency tree was changed.

Two authorized legacy route-inventory assertions now admit the public read-only
recommendation endpoint as well as diagnosis. All authentication, session,
account-linking, origin and privacy assertions remain in force. One public
catalog consumer allow-list also admits the new **server-only** metadata
projection; its ban on client catalog imports and answer leakage remains intact.

All agent assessment conversations remain in `.claude-logs/`. This task began
in the original checkout; its Codex-owned conversation is reconciled there and
copied into this worktree for the feature commit. Existing Claude logs and the
other worktrees/stashes are not rewritten or staged.

## Exact feature file manifest

```text
src/app/learning-path/page.tsx
src/app/api/recommendations/v1/route.ts
src/components/recommendations/LearningPathHeader.tsx
src/components/recommendations/LearningPathScreen.tsx
src/components/recommendations/LearningPathView.tsx
src/lib/recommendations/types.ts
src/lib/recommendations/validation.ts
src/lib/recommendations/engine.ts
src/lib/recommendations/reasons.ts
src/lib/recommendations/client.ts
src/lib/recommendations/adapters/browser.ts
src/lib/recommendations/server/catalog.ts
src/lib/recommendations/server/history.ts
src/lib/recommendations/server/handler.ts
scripts/verify-recommendations-browser.mjs
tests/recommendations/fixtures.ts
tests/recommendations/engine.test.ts
tests/recommendations/api.test.ts
tests/recommendations/ui.test.ts
tests/auth/identity.test.ts
tests/session/source-guards.test.ts
tests/catalog/catalog.test.ts
docs/architecture/personalized-recommendations.md
docs/architecture/recommendations-api-v1.md
.claude-logs/2026-11-06_04-39-22_01a1af27-7a4a-7670-b8f6-c5c40333f003.md
```
The final feature checkout is `C:\Users\Laptop Zone by JK\buglab-recommendations`
on `feature/personalized-recommendations`. A read-only ESLint environment check
showed that a nested worktree would also be scanned by the original checkout,
including its generated `.next` output. Only this newly created feature worktree
was moved to the sibling path, preserving all files and its branch; the temporary
parent Git exclusion was restored. The original, auth, and Learning Loop worktrees
were not moved. Shared lint/Next settings and the original dependency tree were
not modified. Open a new Codex session in this checkout and review its logging
hooks through `/hooks` when prompted, as trust is specific to each hook source.

## Final validation (2026-11-06)

- `npm run lint`: passed.
- `npm run typecheck`: passed, including Next route generation.
- `npm run build`: passed with Turbopack in the final sibling worktree; the page
  is static and the recommendation API is request-time dynamic.
- `npm test`: **2,829 passed, zero failed, zero skipped**, including 30 focused
  recommendation tests and the unchanged security/privacy behavior of the
  authorized route-inventory and catalog-consumer guards.
- Installed-Edge production checks passed: desktop and mobile/light layout,
  no horizontal overflow, five distinct suggestions, live preferences, local
  opt-out, due recall, solve suppression, no private writing in requests,
  unchanged browser record, labelled controls, unique IDs, keyboard skip link,
  primary-action contrast >= 4.5:1 in both themes, blocked request/retry, and
  unavailable-storage fallback. No unhandled browser errors were observed.
- Recency handles real UTC instants with optional fractional seconds; it does
  not rely on lexicographic timestamp formatting. This has a dedicated regression.
- Screenshots/reports/isolated browser profiles remain ignored under `.next/`;
  node_modules, caches, native transcripts and private settings are not committed.
- No deployment, push, merge, database activation or shared learner integration
  was performed. Authenticated personalization remains behind the documented port.
