# Release integration preparation

This branch starts at origin/main `2238f91`, the PR #9 recommendation merge.
The isolated worktree is `buglab-release-integration`, on
`feature/release-integration-polish`. Authentication PR #10 and Habin's
unpublished backend are not included or modified.

## Frontend changes and journey audit

Learning Path is a fifth entry in the existing primary navigation. Its page
now uses the shared header, theme control, mobile disclosure and current-page
semantics. Progress provides a contextual link to the path. No recommendation
engine, challenge, grading, storage schema or feature gate is changed.

| Stage | Current behavior and ownership |
| --- | --- |
| Challenge | Published investigations open through the existing catalog routes. Unknown challenge URLs remain 404. |
| Solve | The real mounted diagnosis endpoint confirms correctness. The resulting solve is recorded as browser-observed, never server-verified progress. |
| Reflect | The optional workspace reflection writes only to the existing browser learning record. |
| Journal | Saved reflections and existing recall schedules remain local. Loading/unavailable states announce themselves and unavailable storage has a working catalog escape. |
| Progress | Existing selectors read the same learning record. Its verified-completion gate remains unchanged. Loading is announced; storage failure links to available catalog/path exploration. |
| Learning Path | Existing read-only recommendation flow consumes permitted signals. Private reflection writing remains excluded. The path does not create solves, completions, accounts or links. |

The existing empty, recovery, recall and recommendation retry behavior is retained.
The browser audit checks navigation, fixed Journal anchors, real solve/reflection,
read-only storage preservation, theme control, keyboard disclosure/Escape and
skip navigation. Tests account for Next.js preserving visited pages in hidden
Activity trees: assertions target the visible page and wait for client navigation.

## Running the checks

Use Node 24 and the lockfile in this worktree:

```powershell
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npm run test:smoke
```

The build needs access to the existing Google Fonts dependencies. Run the unit
suite after the build to include its production-bundle confidentiality scan.

The smoke command starts its own production server at localhost:3188. It
refuses to reuse an existing server on that port. Windows uses installed
Microsoft Edge; CI on other platforms should install Playwright Chromium.
`BUGLAB_SMOKE_BROWSER_CHANNEL` can select a compatible installed browser.
Each test receives an isolated browser context. Screenshots of the public
Learning Path stay under ignored `.next/integration-smoke/`; generated reports
are ignored. Traces, video and automatic failure screenshots are disabled.

Four frontend workflows run at 1440px/dark, 834px/light, 390px/dark and
320px/light. The keyboard/layout test also checks navigation at 768px.

- The solve/reflection journey uses the real existing diagnosis endpoint.
- The preservation test uses a synthetic, valid browser-local record in the
  isolated profile and confirms its exact bytes survive read-only navigation.
- Network-failure testing aborts the actual request, then retries the real API.
  No response, backend account, learner or completion is fabricated.
- Blocked storage is scoped to a test browser context; catalog suggestions
  remain available without inventing local or verified progress.
- The default release UI is checked for unexpected account/learner API calls.

## Opt-in smoke checks after real backend integration

Two API tests are deliberately skipped until explicitly enabled. A skipped test
is not evidence of authentication or learner integration readiness.

For a running staging/preview application, set the exact origin in
`BUGLAB_SMOKE_BASE_URL` (no trailing slash). This bypasses local server startup.

Authentication checks require:

- `BUGLAB_SMOKE_AUTH=enabled`
- `BUGLAB_SMOKE_EMAIL` and `BUGLAB_SMOKE_PASSWORD` for a dedicated,
  already verified test account.

They exercise anonymous refusal, real login, session restoration/private caching,
cross-origin logout refusal and real logout. They do not register accounts,
change passwords/profile data, assign roles, apply migrations or invoke linking.

Learner checks require:

- `BUGLAB_SMOKE_LEARNER=enabled`
- `BUGLAB_SMOKE_LEARNER_COOKIE`, a dedicated active test learner's complete
  Cookie header supplied through private CI/environment configuration.

They read the canonical `GET /api/learner/completions` endpoint and assert its
agreed active-learner/completion shape and no-store caching. They do not mint
identities or send caller-selected learner IDs or completion declarations.
Confirm the mounted contract with Habin before enabling this check; an absent,
expired or incompatible backend fails rather than producing a mock success.

Run `npm run test:smoke:api` against that configured target. Keep credentials
out of command arguments, public environment variables, screenshots and logs.

## Remaining release dependencies

Obtain and review Habin's actual published implementation commit, integrate
authentication PR #10 with the real learner identity boundary, jointly review
migration 0003, and validate deployed database/email/session/linking behavior.
These changes do not enable production authentication, authenticated
personalization, learner persistence or account linking.

When PR #10 is integrated, retain the fifth navigation entry while combining
its account navigation and AppSection changes. The same small shared files are
expected to need review; no authentication implementation is copied here.

Assessment logging follows AGENTS.md. Existing logs and worktrees are preserved;
only a reviewed prompt/final export related to this release session is included.

## Validation evidence (November 6, 2026)

- Lint, route/type generation, typecheck and production build passed.
- All 2,830 regression tests passed after the build, with zero skips/failures.
- All 16 frontend production smoke cases passed across four viewport/theme projects.
- The four keyboard/theme cases were rerun after restoring project themes for screenshots; all passed.
- The two real API checks remain explicitly skipped until actual backend configuration is supplied.
- Screenshots were reviewed; existing learning data and verified-completion gates are unchanged.

The release log is a scoped export of the actual native response_item user prompt,
with its original timestamp. The older extractor does not select this newer native
record shape; its code and all existing exports are left untouched. The current
final response remains pending until the turn completes; no response is invented.
